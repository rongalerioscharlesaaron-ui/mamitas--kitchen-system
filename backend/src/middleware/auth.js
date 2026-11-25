import jwt from 'jsonwebtoken';
import { query } from '../config/db.js';
import { env } from '../config/env.js';
import { security } from '../config/security.js';
import { unauthorized, forbidden } from '../utils/httpError.js';
import { audit } from '../utils/audit.js';

// Returns { userId, sessionVersion } from a valid session cookie, or null.
export function readSession(req) {
  const token = req.cookies?.[security.cookieName];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
    const userId = Number(payload.sub) || null;
    if (!userId) return null;
    return { userId, sessionVersion: Number(payload.sv) || 1 };
  } catch {
    return null;
  }
}

// Looked up on every request: deactivated accounts, role changes, password resets,
// and "sign out everywhere" take effect immediately.
export async function requireAuth(req, res, next) {
  const session = readSession(req);
  if (!session) throw unauthorized();

  const { rows } = await query(
    `SELECT id, username, full_name, role, is_active, must_change_password, session_version
       FROM users
      WHERE id = $1`,
    [session.userId]
  );
  const user = rows[0];
  if (!user || !user.is_active) throw unauthorized();
  if (Number(user.session_version) !== session.sessionVersion) throw unauthorized();

  req.user = {
    id: user.id,
    username: user.username,
    name: user.full_name,
    role: user.role,
    mustChangePassword: Boolean(user.must_change_password),
  };

  // While a temporary password is active, only /auth/me, /auth/change-password, and /auth/logout work
  const path = req.originalUrl.split('?')[0];
  const allowedWhileTemp = ['/api/auth/me', '/api/auth/change-password', '/api/auth/logout'];
  if (req.user.mustChangePassword && !allowedWhileTemp.includes(path)) {
    throw forbidden('You must set a new password before continuing.');
  }

  next();
}

// Use after requireAuth: router.get('/', requireAuth, requireRole('owner'), handler)
export function requireRole(...roles) {
  return async (req, res, next) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) {
      await audit({
        userId: req.user.id,
        username: req.user.username,
        action: 'access.denied',
        details: { method: req.method, path: req.originalUrl.split('?')[0], needs: roles },
        ip: req.ip,
      });
      throw forbidden();
    }
    next();
  };
}