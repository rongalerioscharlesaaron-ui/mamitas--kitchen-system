import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { date } from '../utils/validate.js';
import { todaySG } from '../utils/dates.js';
import { audit } from '../utils/audit.js';
import {
  getCurrentSession, openSession, closeSession, listSessions,
} from '../services/sessionService.js';

const router = Router();
const sellers = [requireAuth, requireRole('cashier', 'owner')];
const who = (req) => ({ userId: req.user.id, username: req.user.username, ip: req.ip });

router.get('/current', ...sellers, async (req, res) => {
  res.json({ session: await getCurrentSession(req.user) });
});

// Body: { openingCash }
router.post('/open', ...sellers, async (req, res) => {
  const session = await openSession(req.user, req.body);
  await audit({
    ...who(req),
    action: 'session.opened',
    entity: 'session',
    entityId: session.id,
    details: { openingCash: session.openingCash },
  });
  res.status(201).json({ session });
});

// Body: { countedCash, note }
router.post('/close', ...sellers, async (req, res) => {
  const session = await closeSession(req.user, req.body);
  await audit({
    ...who(req),
    action: 'session.closed',
    entity: 'session',
    entityId: session.id,
    details: {
      expected: session.expectedCash,
      counted: session.countedCash,
      difference: session.cashDifference,
      orders: session.orders,
      netSales: session.netSales,
    },
  });
  res.json({ session });
});

// Owner only. ?date=today (default) or YYYY-MM-DD
router.get('/', requireAuth, requireRole('owner'), async (req, res) => {
  const day =
    req.query.date === undefined || req.query.date === 'today' ? todaySG() : date(req.query.date, 'Date');
  res.json({ sessions: await listSessions({ date: day }) });
});

export default router;