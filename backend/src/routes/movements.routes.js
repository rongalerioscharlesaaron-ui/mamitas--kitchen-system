import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { oneOf } from '../utils/validate.js';
import { listMovements, MOVEMENT_TYPES } from '../services/movementService.js';

const router = Router();

// Filters: ?type=DAMAGED,SPOILED  ?kind=ingredient|menu  ?q=chicken (item name or batch ID)  ?limit=100  ?offset=0
router.get('/', requireAuth, requireRole('kitchen', 'owner'), async (req, res) => {
  const types =
    req.query.type === undefined
      ? []
      : String(req.query.type)
          .split(',')
          .map((t) => oneOf(t.trim().toUpperCase(), 'Type', MOVEMENT_TYPES));
  const kind =
    req.query.kind === undefined ? undefined : oneOf(req.query.kind, 'Kind', ['ingredient', 'menu']);
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  res.json(await listMovements({ types, q, kind, limit, offset }));
});

export default router;