import { Router } from 'express';
import { query } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// Owner only. Optional filters: ?limit=50 and ?action=login (matches actions that start with it)
router.get('/', requireAuth, requireRole('owner'), async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const action =
    typeof req.query.action === 'string' && req.query.action ? req.query.action.slice(0, 50) : null;

  const { rows } = await query(
    `SELECT a.id, a.created_at, a.action, a.entity, a.entity_id, a.details,
            host(a.ip_address) AS ip,
            COALESCE(u.username, a.username) AS username
     FROM audit_log a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE ($1::text IS NULL OR starts_with(a.action, $1))
     ORDER BY a.id DESC
     LIMIT $2`,
    [action, limit]
  );
  res.json({ entries: rows });
});

export default router;