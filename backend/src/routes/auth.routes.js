import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../config/db.js';
import { env } from '../config/env.js';
import { security } from '../config/security.js';
import { badRequest, unauthorized, tooMany } from '../utils/httpError.js';
import { audit } from '../utils/audit.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import { requireAuth, readSession } from '../middleware/auth.js';

const router = Router();

const cookieOptions = {
  httpOnly: true, // JavaScript on the page cannot read it
  sameSite: 'lax', // not sent with requests started by other websites
  secure: env.isProduction, // HTTPS only in production
  path: '/',
};

// Checked when the username does not exist, so a wrong username takes as long as
// a wrong password and cannot be told apart by timing.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', security.bcryptCost);

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
    `SELECT id, username, full_name, role, password_hash, is_active, locked_until,
            (locked_until IS NOT NULL AND locked_until > now()) AS is_locked,
            CEIL(GREATEST(EXTRACT(EPOCH FROM (locked_until - now())), 0) / 60)::int AS minutes_left
     FROM users
     WHERE lower(username) = lower($1)`,
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
    // the lock has expired: start counting from zero again
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
    // the same message for a wrong username and a wrong password
    throw unauthorized('Incorrect username or password.');
  }

  await query(
    'UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1',
    [user.id]
  );

  const token = jwt.sign({}, env.jwtSecret, {
    algorithm: 'HS256',
    subject: String(user.id),
    expiresIn: security.sessionHours * 3600,
  });
  res.cookie(security.cookieName, token, {
    ...cookieOptions,
    maxAge: security.sessionHours * 3600 * 1000,
  });

  await audit({ userId: user.id, username: user.username, action: 'login.success', ip });

  res.json({
    user: { id: user.id, username: user.username, name: user.full_name, role: user.role },
  });
});

router.post('/logout', async (req, res) => {
  const userId = readSession(req);
  res.clearCookie(security.cookieName, cookieOptions);
  if (userId) await audit({ userId, action: 'logout', ip: req.ip });
  res.json({ ok: true });
});

// The React app calls this when the page loads, to find out who is logged in
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;