import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { oneOf, date } from '../utils/validate.js';
import { todaySG } from '../utils/dates.js';
import { audit } from '../utils/audit.js';
import { listOrders, getOrder, placeOrder, completeOrder } from '../services/orderService.js';

const router = Router();
const sales = [requireAuth, requireRole('cashier', 'owner')];
const who = (req) => ({ userId: req.user.id, username: req.user.username, ip: req.ip });

// Filters: ?status=preparing|completed  ?date=today|YYYY-MM-DD  ?q=0012  ?limit=100  ?offset=0
router.get('/', ...sales, async (req, res) => {
  const q = req.query;
  const filters = {};
  if (q.status !== undefined) filters.status = oneOf(q.status, 'Status', ['preparing', 'completed']);
  if (q.date !== undefined) filters.date = q.date === 'today' ? todaySG() : date(q.date, 'Date');
  if (typeof q.q === 'string') filters.q = q.q.replace(/\D/g, '').slice(0, 10);
  filters.limit = Math.min(Math.max(parseInt(q.limit, 10) || 100, 1), 500);
  filters.offset = Math.max(parseInt(q.offset, 10) || 0, 0);
  res.json(await listOrders(filters));
});

router.post('/', ...sales, async (req, res) => {
  const { order, duplicate } = await placeOrder(req.user, req.body);
  if (!duplicate) {
    await audit({
      ...who(req),
      action: 'order.placed',
      entity: 'order',
      entityId: order.id,
      details: {
        number: order.number,
        total: order.total,
        items: order.lines.reduce((sum, l) => sum + l.qty, 0),
        method: order.payment.method,
        type: order.type,
      },
    });
  }
  res.status(duplicate ? 200 : 201).json({ order, duplicate });
});

router.get('/:id', ...sales, async (req, res) => {
  res.json({ order: await getOrder(req.params.id) });
});

router.patch('/:id/complete', ...sales, async (req, res) => {
  const result = await completeOrder(req.params.id);
  await audit({
    ...who(req),
    action: 'order.completed',
    entity: 'order',
    entityId: result.id,
    details: { number: result.number },
  });
  res.json({ order: await getOrder(result.id) });
});

export default router;