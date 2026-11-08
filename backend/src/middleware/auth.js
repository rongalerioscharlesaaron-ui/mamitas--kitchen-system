import jwt from 'jsonwebtoken';
import { query } from '../config/db.js';
import { env } from '../config/env.js';
import { security } from '../config/security.js';
import { unauthorized, forbidden } from '../utils/httpError.js';
import { audit } from '../utils/audit.js';

// Returns the user id from a valid session cookie, or null.
export function readSession(req) {
  const token = req.cookies?.[security.cookieName];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
    return Number(payload.sub) || null;
  } catch {
    return null;
  }
}

// The user is looked up on every request, so a deactivated account or a changed
// role takes effect immediately.
export async function requireAuth(req, res, next) {
  const userId = readSession(req);
  if (!userId) throw unauthorized();

  const { rows } = await query(
    'SELECT id, username, full_name, role, is_active FROM users WHERE id = $1',
    [userId]
  );
  const user = rows[0];
  if (!user || !user.is_active) throw unauthorized();

  req.user = { id: user.id, username: user.username, name: user.full_name, role: user.role };
  next();
}

// Use after requireAuth:  router.get('/', requireAuth, requireRole('owner'), handler)
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