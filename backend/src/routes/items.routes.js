import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { oneOf } from '../utils/validate.js';
import { audit } from '../utils/audit.js';
import { listItems, getItem, createItem, updateItem } from '../services/itemService.js';
import { addBatch } from '../services/batchService.js';

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

export default router;