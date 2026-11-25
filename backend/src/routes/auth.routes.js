import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../config/db.js';
import { env } from '../config/env.js';
import { security } from '../config/security.js';
import { badRequest, unauthorized, tooMany } from '../utils/httpError.js';
import { text } from '../utils/validate.js';
import { audit } from '../utils/audit.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import { requireAuth, readSession } from '../middleware/auth.js';

const router = Router();

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: env.isProduction,
  path: '/',
};

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', security.bcryptCost);

function issueSessionCookie(res, userId, sessionVersion) {
  const token = jwt.sign({ sv: sessionVersion }, env.jwtSecret, {
    algorithm: 'HS256',
    subject: String(userId),
    expiresIn: security.sessionHours * 3600,
  });
  res.cookie(security.cookieName, token, {
    ...cookieOptions,
    maxAge: security.sessionHours * 3600 * 1000,
  });
}

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    throw badRequest('Enter your username and password.');
  }
  const name = username.trim();
  if (!name || name.length > 50 || !password || Buffer.byteLength(password) > security.maxPasswordBytes) {
    throw badRequest('Enter your username and password.');
  }
  const ip = req.ip;

  const { rows } = await query(
    `SELECT id, username, full_name, role, password_hash, is_active,
            must_change_password, session_version, locked_until,
            (locked_until IS NOT NULL AND locked_until > now()) AS is_locked,
            CEIL(GREATEST(EXTRACT(EPOCH FROM (locked_until - now())), 0) / 60)::int AS minutes_left
       FROM users
      WHERE lower(username) = lower($1) AND deleted_at IS NULL`,
    [name]
  );
  const user = rows[0];

  if (user?.is_locked) {
    await audit({
      userId: user.id, username: user.username, action: 'login.blocked',
      details: { reason: 'account_locked' }, ip,
    });
    throw tooMany(`Too many failed attempts. Try again in ${user.minutes_left} minute(s).`);
  }
  if (user && user.locked_until) {
    await query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [user.id]);
  }

  const matches = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);

  if (!user || !user.is_active || !matches) {
    const reason = !user ? 'unknown_user' : !user.is_active ? 'inactive' : 'bad_password';
    let lockedNow = false;

    if (user && user.is_active) {
      const result = await query(
        `UPDATE users
            SET failed_logins = failed_logins + 1,
                locked_until = CASE WHEN failed_logins + 1 >= $2
                                    THEN now() + make_interval(mins => $3)
                                    ELSE locked_until END
          WHERE id = $1
          RETURNING (locked_until IS NOT NULL AND locked_until > now()) AS locked`,
        [user.id, security.maxFailedLogins, security.lockMinutes]
      );
      lockedNow = result.rows[0].locked;
    }

    await audit({
      userId: user?.id ?? null, username: name, action: 'login.failed', details: { reason }, ip,
    });

    if (lockedNow) {
      await audit({
        userId: user.id, username: user.username, action: 'account.locked',
        details: { minutes: security.lockMinutes }, ip,
      });
      throw tooMany(`Too many failed attempts. Try again in ${security.lockMinutes} minutes.`);
    }
    throw unauthorized('Incorrect username or password.');
  }

  await query(
    'UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1',
    [user.id]
  );

  issueSessionCookie(res, user.id, user.session_version);

  await audit({ userId: user.id, username: user.username, action: 'login.success', ip });

  res.json({
    user: {
      id: user.id,
      username: user.username,
      name: user.full_name,
      role: user.role,
      mustChangePassword: Boolean(user.must_change_password),
    },
  });
});

// My account: change own password (also completes forced temporary-password change)
router.post('/change-password', requireAuth, async (req, res) => {
  const currentPassword = text(req.body?.currentPassword, 'Current password', { min: 1, max: 100 });
  const newPassword = text(req.body?.newPassword, 'New password', { min: 6, max: 100 });
  if (Buffer.byteLength(newPassword) > security.maxPasswordBytes) {
    throw badRequest(`New password must be at most ${security.maxPasswordBytes} bytes.`);
  }
  if (currentPassword === newPassword) {
    throw badRequest('New password must be different from your current password.');
  }

  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  const valid = rows[0] && (await bcrypt.compare(currentPassword, rows[0].password_hash));
  if (!valid) throw unauthorized('Current password is incorrect.');

  const newHash = await bcrypt.hash(newPassword, security.bcryptCost);
  const updated = await query(
    `UPDATE users
        SET password_hash = $2,
            must_change_password = FALSE,
            session_version = session_version + 1
      WHERE id = $1
      RETURNING id, username, full_name, role, session_version`,
    [req.user.id, newHash]
  );
  const u = updated.rows[0];

  // Re-issue cookie for this browser; all other sessions of this user end immediately
  issueSessionCookie(res, u.id, u.session_version);

  await audit({
    userId: u.id,
    username: u.username,
    action: 'account.password_changed',
    entity: 'user',
    entityId: u.id,
    ip: req.ip,
  });

  res.json({
    user: {
      id: u.id,
      username: u.username,
      name: u.full_name,
      role: u.role,
      mustChangePassword: false,
    },
  });
});

router.post('/logout', async (req, res) => {
  const session = readSession(req);
  res.clearCookie(security.cookieName, cookieOptions);
  if (session?.userId) await audit({ userId: session.userId, action: 'logout', ip: req.ip });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;