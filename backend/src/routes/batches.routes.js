import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { oneOf, parseId } from '../utils/validate.js';
import { audit } from '../utils/audit.js';
import {
  listBatches, recordLoss, writeOffBatch, adjustBatch, EXPIRY_STATUSES,
} from '../services/batchService.js';

const router = Router();
const staff = [requireAuth, requireRole('kitchen', 'owner')];
const who = (req) => ({ userId: req.user.id, username: req.user.username, ip: req.ip });

// Filters: ?itemId=3  ?inStock=true  ?status=expired,soon  ?kind=ingredient|menu
router.get('/', ...staff, async (req, res) => {
  const q = req.query;
  const filters = {};
  if (q.itemId !== undefined) filters.itemId = parseId(q.itemId, 'item id');
  if (q.inStock === 'true') filters.inStock = true;
  if (q.status !== undefined) {
    filters.status = String(q.status)
      .split(',')
      .map((s) => oneOf(s.trim(), 'Status', EXPIRY_STATUSES));
  }
  if (q.kind !== undefined) filters.kind = oneOf(q.kind, 'Kind', ['ingredient', 'menu']);
  res.json({ batches: await listBatches(filters) });
});

router.post('/:id/loss', ...staff, async (req, res) => {
  const result = await recordLoss(req.user, req.params.id, req.body);
  await audit({
    ...who(req),
    action: 'batch.loss',
    entity: 'batch',
    entityId: req.params.id,
    details: {
      code: result.batchCode, item: result.itemName, type: result.type,
      qty: result.qty, reason: result.reason,
    },
  });
  res.json({ result });
});

router.post('/:id/write-off', ...staff, async (req, res) => {
  const result = await writeOffBatch(req.user, req.params.id);
  await audit({
    ...who(req),
    action: 'batch.write_off',
    entity: 'batch',
    entityId: req.params.id,
    details: { code: result.batchCode, item: result.itemName, qty: result.qty },
  });
  res.json({ result });
});

// Body: { countedQty, reason }
router.post('/:id/adjust', ...staff, async (req, res) => {
  const result = await adjustBatch(req.user, req.params.id, req.body);
  await audit({
    ...who(req),
    action: 'batch.adjusted',
    entity: 'batch',
    entityId: req.params.id,
    details: {
      code: result.batchCode, item: result.itemName,
      from: result.from, to: result.to, diff: result.diff, reason: result.reason,
    },
  });
  res.json({ result });
});

export default router;