import { Router } from 'express';
import { query } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// Owner only. Optional filters: ?limit=25&beforeId=120&category=admin&user=cashier&from=2026-11-20&to=2026-11-20
router.get('/', requireAuth, requireRole('owner'), async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 200);
  const beforeId = parseInt(req.query.beforeId, 10) || null;
  const category =
    typeof req.query.category === 'string' && req.query.category ? req.query.category.slice(0, 30) : null;
  const userFilter =
    typeof req.query.user === 'string' && req.query.user.trim() ? req.query.user.trim().slice(0, 50) : null;
  const fromDate =
    typeof req.query.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : null;
  const toDate =
    typeof req.query.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : null;

  const { rows } = await query(
    `SELECT a.id, a.created_at, a.action, a.entity, a.entity_id, a.details,
            host(a.ip_address) AS ip,
            COALESCE(u.username, a.username) AS username
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
      WHERE ($1::bigint IS NULL OR a.id < $1)
        AND ($2::text IS NULL OR starts_with(a.action, $2 || '.'))
        AND ($3::text IS NULL OR lower(COALESCE(u.username, a.username, '')) LIKE '%' || lower($3) || '%')
        AND ($4::date IS NULL OR (a.created_at AT TIME ZONE 'Asia/Manila')::date >= $4::date)
        AND ($5::date IS NULL OR (a.created_at AT TIME ZONE 'Asia/Manila')::date <= $5::date)
      ORDER BY a.id DESC
      LIMIT $6`,
    [beforeId, category, userFilter, fromDate, toDate, limit + 1]
  );

  const hasMore = rows.length > limit;
  const entries = hasMore ? rows.slice(0, limit) : rows;
  res.json({ entries, hasMore });
});

export default router;