import { query } from '../config/db.js';

export const MOVEMENT_TYPES = ['IN', 'USED', 'DAMAGED', 'SPOILED', 'ADJUSTMENT'];

// filters: { types: [], q, limit, offset }
export async function listMovements({ types, q, limit, offset }) {
  const conds = [];
  const params = [];

  if (types?.length) {
    params.push(types);
    conds.push(`m.movement_type = ANY($${params.length}::movement_type[])`);
  }
  if (q) {
    params.push(q);
    const n = params.length;
    conds.push(
      `(strpos(lower(i.name), lower($${n})) > 0 OR strpos(lower(b.batch_code), lower($${n})) > 0)`
    );
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  params.push(limit, offset);
  const { rows } = await query(
    `SELECT m.id, m.created_at, m.movement_type, m.qty, m.reason,
            i.id AS item_id, i.name AS item_name, i.item_type, i.unit,
            b.batch_code,
            CASE WHEN m.order_id IS NOT NULL THEN 'POS'
                 ELSE COALESCE(u.full_name, 'System') END AS recorded_by,
            o.order_number,
            COUNT(*) OVER () AS total
       FROM stock_movements m
       JOIN items i ON i.id = m.item_id
       JOIN inventory_batches b ON b.id = m.batch_id
       LEFT JOIN users u ON u.id = m.user_id
       LEFT JOIN orders o ON o.id = m.order_id
       ${where}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return {
    total: rows[0]?.total ?? 0,
    movements: rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      itemId: r.item_id,
      itemName: r.item_name,
      itemType: r.item_type,
      unit: r.unit,
      batchCode: r.batch_code,
      type: r.movement_type,
      qty: r.qty,
      reason: r.reason,
      recordedBy: r.recorded_by,
      orderNumber: r.order_number,
    })),
  };
}