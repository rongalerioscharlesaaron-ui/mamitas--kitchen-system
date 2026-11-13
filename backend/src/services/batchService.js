import { query, withTransaction } from '../config/db.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { number, date, oneOf, text, parseId } from '../utils/validate.js';
import { todaySG } from '../utils/dates.js';

export const EXPIRY_STATUSES = ['expired', 'soon', 'ok', 'none'];

function mapBatch(r) {
  return {
    id: r.batch_id,
    code: r.batch_code,
    itemId: r.item_id,
    itemName: r.item_name,
    itemType: r.item_type,
    category: r.category,
    unit: r.unit,
    qtyReceived: r.qty_received,
    qtyRemaining: r.qty_remaining,
    receivedDate: r.received_date,
    expiryDate: r.expiry_date,
    daysLeft: r.days_left,
    expiryStatus: r.expiry_status,
  };
}

// filters: { itemId, inStock, status: [], kind: 'ingredient' | 'menu' }
export async function listBatches(filters = {}) {
  const conds = [];
  const params = [];

  if (filters.itemId) {
    params.push(filters.itemId);
    conds.push(`item_id = $${params.length}`);
  }
  if (filters.inStock) conds.push('qty_remaining > 0');
  if (filters.status?.length) {
    params.push(filters.status);
    conds.push(`expiry_status = ANY($${params.length}::text[])`);
  }
  if (filters.kind === 'ingredient') conds.push(`item_type = 'ingredient'`);
  if (filters.kind === 'menu') conds.push(`item_type <> 'ingredient'`);

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT * FROM v_batch_status ${where} ORDER BY expiry_date NULLS LAST, batch_code`,
    params
  );
  return rows.map(mapBatch);
}

// Shared by "add batch" and "create item with a first batch". Run it inside a transaction.
export async function insertBatch(db, { itemId, qty, expiry, userId, reason }) {
  const inserted = await db.query(
    `INSERT INTO inventory_batches (item_id, qty_received, qty_remaining, expiry_date, created_by)
     VALUES ($1, $2, $2, $3, $4)
     RETURNING id, batch_code`,
    [itemId, qty, expiry, userId]
  );
  const { id, batch_code: code } = inserted.rows[0];
  await db.query(
    `INSERT INTO stock_movements (item_id, batch_id, movement_type, qty, reason, user_id)
     VALUES ($1, $2, 'IN', $3, $4, $5)`,
    [itemId, id, qty, reason, userId]
  );
  return { id, code };
}

export async function addBatch(user, rawItemId, body) {
  const b = body ?? {};
  const itemId = parseId(rawItemId, 'item id');

  const found = await query(
    'SELECT id, name, item_type, has_expiry FROM items WHERE id = $1 AND is_active',
    [itemId]
  );
  const item = found.rows[0];
  if (!item) throw notFound('Item not found.');

  const isIngredient = item.item_type === 'ingredient';
  const qty = number(b.qty, 'Quantity', { min: 0.001, max: 1000000, integer: !isIngredient });
  const expiry = date(b.expiry, 'Expiry date', { allowEmpty: true });

  if (isIngredient && item.has_expiry && !expiry) {
    throw badRequest('Enter the expiry date of this batch.');
  }
  if (isIngredient && !item.has_expiry && expiry) {
    throw badRequest(`${item.name} has no expiry date, so a batch cannot have one.`);
  }
  if (expiry && expiry < todaySG()) throw badRequest('Expiry date cannot be in the past.');

  const reason = isIngredient && item.has_expiry ? 'New batch' : 'Stock in';
  const batch = await withTransaction((db) =>
    insertBatch(db, { itemId, qty, expiry, userId: user.id, reason })
  );
  return { batch: { ...batch, qty, expiry }, item };
}

// Damaged or spoiled goods come off one specific batch
export async function recordLoss(user, rawBatchId, body) {
  const b = body ?? {};
  const batchId = parseId(rawBatchId, 'batch id');
  const type = oneOf(b.type, 'Type', ['DAMAGED', 'SPOILED']);
  const reason = text(b.reason, 'Reason', { max: 200 });

  return withTransaction(async (db) => {
    const { rows } = await db.query(
      `SELECT b.id, b.item_id, b.batch_code, b.qty_remaining, i.name, i.unit, i.item_type
         FROM inventory_batches b
         JOIN items i ON i.id = b.item_id
        WHERE b.id = $1
          FOR UPDATE OF b`,
      [batchId]
    );
    const batch = rows[0];
    if (!batch) throw notFound('Batch not found.');

    const qty = number(b.qty, 'Quantity', {
      min: 0.001,
      max: 1000000,
      integer: batch.item_type !== 'ingredient',
    });
    if (qty > batch.qty_remaining) {
      throw badRequest(`Only ${batch.qty_remaining} ${batch.unit} left in batch ${batch.batch_code}.`);
    }

    const updated = await db.query(
      'UPDATE inventory_batches SET qty_remaining = qty_remaining - $2 WHERE id = $1 RETURNING qty_remaining',
      [batchId, qty]
    );
    await db.query(
      `INSERT INTO stock_movements (item_id, batch_id, movement_type, qty, reason, user_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [batch.item_id, batchId, type, qty, reason, user.id]
    );

    return {
      batchCode: batch.batch_code,
      itemName: batch.name,
      unit: batch.unit,
      type,
      qty,
      reason,
      remaining: updated.rows[0].qty_remaining,
    };
  });
}

// Only a batch that has really expired can be written off
export async function writeOffBatch(user, rawBatchId) {
  const batchId = parseId(rawBatchId, 'batch id');

  return withTransaction(async (db) => {
    const { rows } = await db.query(
      `SELECT b.id, b.item_id, b.batch_code, b.qty_remaining, i.name, i.unit,
              (b.expiry_date IS NOT NULL AND b.expiry_date < CURRENT_DATE) AS expired
         FROM inventory_batches b
         JOIN items i ON i.id = b.item_id
        WHERE b.id = $1
          FOR UPDATE OF b`,
      [batchId]
    );
    const batch = rows[0];
    if (!batch) throw notFound('Batch not found.');
    if (!batch.expired) throw badRequest(`Batch ${batch.batch_code} has not expired.`);
    if (!(batch.qty_remaining > 0)) throw badRequest('Nothing is left to write off.');

    await db.query('UPDATE inventory_batches SET qty_remaining = 0 WHERE id = $1', [batchId]);
    await db.query(
      `INSERT INTO stock_movements (item_id, batch_id, movement_type, qty, reason, user_id)
       VALUES ($1, $2, 'SPOILED', $3, 'Expired', $4)`,
      [batch.item_id, batchId, batch.qty_remaining, user.id]
    );

    return {
      batchCode: batch.batch_code,
      itemName: batch.name,
      unit: batch.unit,
      qty: batch.qty_remaining,
    };
  });
}

// Sets a batch to the quantity that was really counted. The difference is logged as a signed Adjustment.
export async function adjustBatch(user, rawBatchId, body) {
  const b = body ?? {};
  const batchId = parseId(rawBatchId, 'batch id');
  const reason = text(b.reason, 'Reason', { max: 200 });

  return withTransaction(async (db) => {
    const { rows } = await db.query(
      `SELECT b.id, b.item_id, b.batch_code, b.qty_remaining, i.name, i.unit, i.item_type
         FROM inventory_batches b
         JOIN items i ON i.id = b.item_id
        WHERE b.id = $1
          FOR UPDATE OF b`,
      [batchId]
    );
    const batch = rows[0];
    if (!batch) throw notFound('Batch not found.');

    const counted = number(b.countedQty, 'Counted quantity', {
      min: 0,
      max: 1000000,
      integer: batch.item_type !== 'ingredient',
    });
    const diff = Math.round((counted - batch.qty_remaining) * 1000) / 1000;
    if (diff === 0) {
      throw badRequest(`Batch ${batch.batch_code} already shows ${counted} ${batch.unit}. Nothing to adjust.`);
    }

    // If more was counted than was ever received, the received quantity is corrected too
    await db.query(
      `UPDATE inventory_batches
          SET qty_remaining = $2, qty_received = GREATEST(qty_received, $2)
        WHERE id = $1`,
      [batchId, counted]
    );
    await db.query(
      `INSERT INTO stock_movements (item_id, batch_id, movement_type, qty, reason, user_id)
       VALUES ($1, $2, 'ADJUSTMENT', $3, $4, $5)`,
      [batch.item_id, batchId, diff, reason, user.id]
    );

    return {
      batchCode: batch.batch_code,
      itemName: batch.name,
      unit: batch.unit,
      from: batch.qty_remaining,
      to: counted,
      diff,
      reason,
    };
  });
}