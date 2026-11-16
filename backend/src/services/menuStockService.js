import { withTransaction } from '../config/db.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { number, oneOf, text, parseId } from '../utils/validate.js';

async function loadMenuItem(db, itemId) {
  const { rows } = await db.query(
    'SELECT id, name, unit, item_type FROM items WHERE id = $1 AND is_active',
    [itemId]
  );
  const item = rows[0];
  if (!item) throw notFound('Item not found.');
  if (item.item_type === 'ingredient') {
    throw badRequest('This is an ingredient. Use its batches instead.');
  }
  return item;
}

// Servings that have not expired, locked for the change. order is 'ASC' (oldest first) or 'DESC'.
function usableBatches(db, itemId, order) {
  return db.query(
    `SELECT id, qty_remaining
       FROM inventory_batches
      WHERE item_id = $1
        AND qty_remaining > 0
        AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
      ORDER BY received_date ${order}, id ${order}
        FOR UPDATE`,
    [itemId]
  );
}

const move = (db, itemId, batchId, type, qty, reason, userId) =>
  db.query(
    `INSERT INTO stock_movements (item_id, batch_id, movement_type, qty, reason, user_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [itemId, batchId, type, qty, reason, userId]
  );

// Damaged or spoiled servings come off today's stock, oldest first
export async function recordMenuLoss(user, rawItemId, body) {
  const b = body ?? {};
  const itemId = parseId(rawItemId, 'item id');
  const type = oneOf(b.type, 'Type', ['DAMAGED', 'SPOILED']);
  const reason = text(b.reason, 'Reason', { max: 200 });
  const qty = number(b.qty, 'Quantity', { min: 1, max: 1000000, integer: true });

  return withTransaction(async (db) => {
    const item = await loadMenuItem(db, itemId);
    const { rows } = await usableBatches(db, itemId, 'ASC');
    const available = rows.reduce((sum, r) => sum + r.qty_remaining, 0);
    if (qty > available) throw badRequest(`Only ${available} ${item.unit} available today.`);

    let remaining = qty;
    for (const batch of rows) {
      if (remaining <= 0) break;
      const take = Math.min(batch.qty_remaining, remaining);
      await db.query('UPDATE inventory_batches SET qty_remaining = qty_remaining - $2 WHERE id = $1', [
        batch.id, take,
      ]);
      await move(db, itemId, batch.id, type, take, reason, user.id);
      remaining -= take;
    }
    return { itemName: item.name, unit: item.unit, type, qty, reason, remaining: available - qty };
  });
}

// Sets today's servings to the quantity that was really counted. The difference is logged as an Adjustment.
export async function adjustMenuStock(user, rawItemId, body) {
  const b = body ?? {};
  const itemId = parseId(rawItemId, 'item id');
  const reason = text(b.reason, 'Reason', { max: 200 });
  const counted = number(b.countedQty, 'Counted quantity', { min: 0, max: 1000000, integer: true });

  return withTransaction(async (db) => {
    const item = await loadMenuItem(db, itemId);
    const { rows } = await usableBatches(db, itemId, 'ASC');
    const available = rows.reduce((sum, r) => sum + r.qty_remaining, 0);
    const diff = counted - available;
    if (diff === 0) {
      throw badRequest(`${item.name} already shows ${counted} ${item.unit}. Nothing to adjust.`);
    }

    if (diff > 0) {
      const newest = rows[rows.length - 1];
      if (newest) {
        await db.query(
          `UPDATE inventory_batches
              SET qty_remaining = qty_remaining + $2,
                  qty_received = GREATEST(qty_received, qty_remaining + $2)
            WHERE id = $1`,
          [newest.id, diff]
        );
        await move(db, itemId, newest.id, 'ADJUSTMENT', diff, reason, user.id);
      } else {
        const created = await db.query(
          `INSERT INTO inventory_batches (item_id, qty_received, qty_remaining, created_by)
           VALUES ($1, $2, $2, $3) RETURNING id`,
          [itemId, diff, user.id]
        );
        await move(db, itemId, created.rows[0].id, 'ADJUSTMENT', diff, reason, user.id);
      }
    } else {
      let remaining = -diff;
      for (const batch of rows) {
        if (remaining <= 0) break;
        const take = Math.min(batch.qty_remaining, remaining);
        await db.query('UPDATE inventory_batches SET qty_remaining = qty_remaining - $2 WHERE id = $1', [
          batch.id, take,
        ]);
        await move(db, itemId, batch.id, 'ADJUSTMENT', -take, reason, user.id);
        remaining -= take;
      }
    }

    return { itemName: item.name, unit: item.unit, from: available, to: counted, diff, reason };
  });
}

// Writes off every expired serving or tray: of one item, or of the whole menu when no item is given
export async function writeOffExpiredMenu(user, rawItemId) {
  const itemId = rawItemId === undefined || rawItemId === null ? null : parseId(rawItemId, 'item id');

  return withTransaction(async (db) => {
    const params = [];
    let scope = '';
    if (itemId) {
      params.push(itemId);
      scope = `AND b.item_id = $${params.length}`;
    }
    const { rows } = await db.query(
      `SELECT b.id, b.item_id, b.qty_remaining
         FROM inventory_batches b
         JOIN items i ON i.id = b.item_id
        WHERE i.item_type <> 'ingredient'
          AND b.qty_remaining > 0
          AND b.expiry_date < CURRENT_DATE
          ${scope}
        ORDER BY b.item_id, b.id
          FOR UPDATE OF b`,
      params
    );

    let servings = 0;
    for (const batch of rows) {
      await db.query('UPDATE inventory_batches SET qty_remaining = 0 WHERE id = $1', [batch.id]);
      await move(db, batch.item_id, batch.id, 'SPOILED', batch.qty_remaining, 'Expired', user.id);
      servings += batch.qty_remaining;
    }
    return { batches: rows.length, items: new Set(rows.map((r) => r.item_id)).size, servings };
  });
}