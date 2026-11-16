import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { oneOf } from '../utils/validate.js';
import { audit } from '../utils/audit.js';
import { listItems, getItem, createItem, updateItem } from '../services/itemService.js';
import { addBatch } from '../services/batchService.js';
import {
  recordMenuLoss, adjustMenuStock, writeOffExpiredMenu,
} from '../services/menuStockService.js';

const router = Router();
const staff = [requireAuth, requireRole('kitchen', 'owner')];
const who = (req) => ({ userId: req.user.id, username: req.user.username, ip: req.ip });

router.get('/', ...staff, async (req, res) => {
  const type =
    req.query.type === undefined
      ? null
      : oneOf(req.query.type, 'Type', ['ingredient', 'food', 'food_tray']);
  res.json({ items: await listItems(type) });
});

router.post('/', ...staff, async (req, res) => {
  const { itemId, batch } = await createItem(req.user, req.body);
  const item = await getItem(itemId);
  await audit({
    ...who(req),
    action: 'item.created',
    entity: 'item',
    entityId: itemId,
    details: { name: item.name, type: item.type, batch: batch?.code ?? null },
  });
  res.status(201).json({ item, batch });
});

// Body: { itemId } for one item, or nothing for the whole menu
router.post('/write-off-expired', ...staff, async (req, res) => {
  const result = await writeOffExpiredMenu(req.user, req.body?.itemId);
  if (result.batches > 0) {
    await audit({
      ...who(req),
      action: 'menu.write_off_expired',
      entity: 'item',
      entityId: req.body?.itemId ?? null,
      details: result,
    });
  }
  res.json({ result });
});

router.patch('/:id', ...staff, async (req, res) => {
  const { itemId, changes } = await updateItem(req.user, req.params.id, req.body);
  await audit({
    ...who(req),
    action: 'item.updated',
    entity: 'item',
    entityId: itemId,
    details: changes,
  });
  res.json({ item: await getItem(itemId) });
});

router.post('/:id/batches', ...staff, async (req, res) => {
  const { batch, item } = await addBatch(req.user, req.params.id, req.body);
  await audit({
    ...who(req),
    action: 'batch.created',
    entity: 'batch',
    entityId: batch.id,
    details: { code: batch.code, item: item.name, qty: batch.qty, expiry: batch.expiry },
  });
  res.status(201).json({ batch });
});

// Foods and trays: damaged or spoiled servings, taken from today's stock
router.post('/:id/loss', ...staff, async (req, res) => {
  const result = await recordMenuLoss(req.user, req.params.id, req.body);
  await audit({
    ...who(req),
    action: 'menu.loss',
    entity: 'item',
    entityId: req.params.id,
    details: { item: result.itemName, type: result.type, qty: result.qty, reason: result.reason },
  });
  res.json({ result });
});

// Foods and trays: set today's servings to the counted quantity
router.post('/:id/adjust', ...staff, async (req, res) => {
  const result = await adjustMenuStock(req.user, req.params.id, req.body);
  await audit({
    ...who(req),
    action: 'menu.adjusted',
    entity: 'item',
    entityId: req.params.id,
    details: {
      item: result.itemName, from: result.from, to: result.to, diff: result.diff, reason: result.reason,
    },
  });
  res.json({ result });
});

export default router;