import { pool, withTransaction } from '../config/db.js';
import { badRequest, notFound, conflict } from '../utils/httpError.js';
import { number, oneOf, parseId } from '../utils/validate.js';
import { toCents, fromCents, gstIncluded } from '../utils/money.js';

const ORDER_TYPES = ['dine_in', 'takeaway'];
const PAYMENT_METHODS = ['cash', 'paynow', 'card'];
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const ORDER_SELECT = `
  SELECT o.id, o.order_number, o.order_type, o.status, o.total, o.gst_amount,
         o.created_at, o.completed_at,
         u.full_name AS cashier,
         p.method, p.amount_tendered, p.change_given,
         COALESCE(
           json_agg(json_build_object('itemId', oi.item_id, 'name', oi.item_name,
                                      'price', oi.unit_price, 'qty', oi.qty) ORDER BY oi.id)
             FILTER (WHERE oi.id IS NOT NULL),
           '[]'::json) AS lines,
         COUNT(*) OVER () AS total_count
    FROM orders o
    JOIN users u ON u.id = o.cashier_id
    JOIN payments p ON p.order_id = o.id
    LEFT JOIN order_items oi ON oi.order_id = o.id`;

const ORDER_GROUP = 'GROUP BY o.id, u.full_name, p.id';

function mapOrder(r) {
  return {
    id: r.id,
    number: r.order_number,
    type: r.order_type,
    status: r.status,
    total: r.total,
    gst: r.gst_amount,
    cashier: r.cashier,
    createdAt: r.created_at,
    completedAt: r.completed_at,
    lines: r.lines,
    payment: { method: r.method, tendered: r.amount_tendered, change: r.change_given },
  };
}

// db is the pool, or a client inside a transaction
async function fetchOrders(db, { where = '', params = [], limit = 100, offset = 0 } = {}) {
  const all = [...params, limit, offset];
  const { rows } = await db.query(
    `${ORDER_SELECT} ${where} ${ORDER_GROUP}
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT $${all.length - 1} OFFSET $${all.length}`,
    all
  );
  return { total: rows[0]?.total_count ?? 0, orders: rows.map(mapOrder) };
}

// filters: { status, date (YYYY-MM-DD, Singapore), q (digits of the order number), limit, offset }
export async function listOrders({ status, date, q, limit, offset }) {
  const conds = [];
  const params = [];
  if (status) {
    params.push(status);
    conds.push(`o.status = $${params.length}`);
  }
  if (date) {
    params.push(date);
    conds.push(`(o.created_at AT TIME ZONE 'Asia/Singapore')::date = $${params.length}::date`);
  }
  if (q) {
    params.push(q);
    conds.push(`strpos(o.order_number, $${params.length}) > 0`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  return fetchOrders(pool, { where, params, limit, offset });
}

export async function getOrder(rawId) {
  const id = parseId(rawId, 'order id');
  const { orders } = await fetchOrders(pool, { where: 'WHERE o.id = $1', params: [id], limit: 1 });
  if (!orders[0]) throw notFound('Order not found.');
  return orders[0];
}

async function findByRequestId(db, requestId, cashierId) {
  const { orders } = await fetchOrders(db, {
    where: 'WHERE o.client_request_id = $1 AND o.cashier_id = $2',
    params: [requestId, cashierId],
    limit: 1,
  });
  return orders[0] ?? null;
}

export async function placeOrder(user, body) {
  const b = body ?? {};
  const type = oneOf(b.type, 'Order type', ORDER_TYPES);

  if (!Array.isArray(b.lines) || b.lines.length === 0) throw badRequest('The order is empty.');
  if (b.lines.length > 50) throw badRequest('Too many items in one order.');

  // Only item and quantity are read from the request. Names and prices come from the database.
  const wanted = new Map();
  for (const line of b.lines) {
    const itemId = parseId(line?.itemId, 'item id');
    const qty = number(line?.qty, 'Quantity', { min: 1, max: 99, integer: true });
    wanted.set(itemId, (wanted.get(itemId) ?? 0) + qty);
  }
  for (const qty of wanted.values()) {
    if (qty > 99) throw badRequest('Quantity of one item cannot be more than 99.');
  }

  const pay = b.payment ?? {};
  const method = oneOf(pay.method, 'Payment method', PAYMENT_METHODS);
  const tendered =
    method === 'cash'
      ? number(pay.tendered, 'Cash received', { min: 0, max: 1000000, decimals: 2 })
      : null;

  const requestId = b.requestId ?? null;
  if (requestId !== null && (typeof requestId !== 'string' || !UUID.test(requestId))) {
    throw badRequest('Invalid request id.');
  }

  // The same request sent twice returns the first order instead of making a second one
  if (requestId) {
    const existing = await findByRequestId(pool, requestId, user.id);
    if (existing) return { order: existing, duplicate: true };
  }

  try {
    const order = await withTransaction(async (db) => {
      // The cashier needs an open cash session. The row is locked so the session cannot be
      // closed while this order is being saved.
      const open = await db.query(
        `SELECT id FROM cashier_sessions WHERE cashier_id = $1 AND closed_at IS NULL FOR SHARE`,
        [user.id]
      );
      if (!open.rows[0]) throw conflict('Open your cash drawer before taking orders.');
      const sessionId = open.rows[0].id;

      // Ordered by id, so two orders locking the same items always lock them in the same order
      const ids = [...wanted.keys()].sort((x, y) => x - y);
      const found = await db.query(
        `SELECT id, name, price, is_enabled
           FROM items
          WHERE id = ANY($1::int[]) AND is_active AND item_type <> 'ingredient'
          ORDER BY id`,
        [ids]
      );
      if (found.rows.length !== ids.length) throw badRequest('One of the items is not on the menu.');
      const disabled = found.rows.filter((r) => !r.is_enabled).map((r) => r.name);
      if (disabled.length > 0) {
        throw badRequest(
          `${disabled.join(', ')} ${disabled.length === 1 ? 'is' : 'are'} no longer on the menu. Remove ${disabled.length === 1 ? 'it' : 'them'} from the order.`
        );
      }

      const lines = found.rows.map((r) => ({
        itemId: r.id,
        name: r.name,
        price: r.price,
        qty: wanted.get(r.id),
      }));

      const totalCents = lines.reduce((sum, l) => sum + toCents(l.price) * l.qty, 0);
      let tenderedCents = totalCents;
      if (method === 'cash') {
        tenderedCents = toCents(tendered);
        if (tenderedCents < totalCents) throw badRequest('Cash received is less than the total.');
      }
      const changeCents = tenderedCents - totalCents;

      const inserted = await db.query(
        `INSERT INTO orders (order_type, total, gst_amount, cashier_id, client_request_id, session_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, order_number`,
        [type, fromCents(totalCents), fromCents(gstIncluded(totalCents)), user.id, requestId, sessionId]
      );
      const { id: orderId, order_number: number } = inserted.rows[0];

      for (const l of lines) {
        await db.query(
          `INSERT INTO order_items (order_id, item_id, item_name, unit_price, qty)
           VALUES ($1, $2, $3, $4, $5)`,
          [orderId, l.itemId, l.name, l.price, l.qty]
        );
      }

      // Takes servings or trays from the oldest unexpired batch. Raises an error if short.
      for (const l of lines) {
        await db.query('SELECT fn_consume_stock($1, $2, $3, $4, $5)', [
          l.itemId, l.qty, orderId, user.id, `Order #${number}`,
        ]);
      }

      await db.query(
        `INSERT INTO payments (order_id, method, amount_due, amount_tendered, change_given)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderId, method, fromCents(totalCents), fromCents(tenderedCents), fromCents(changeCents)]
      );

      const { orders } = await fetchOrders(db, {
        where: 'WHERE o.id = $1', params: [orderId], limit: 1,
      });
      return orders[0];
    });
    return { order, duplicate: false };
  } catch (err) {
    // Two identical requests at the same instant: the database lets only one through
    if (err.code === '23505' && requestId) {
      const existing = await findByRequestId(pool, requestId, user.id);
      if (existing) return { order: existing, duplicate: true };
    }
    throw err;
  }
}

export async function completeOrder(rawId) {
  const id = parseId(rawId, 'order id');
  const done = await pool.query(
    `UPDATE orders SET status = 'completed', completed_at = now()
      WHERE id = $1 AND status = 'preparing'
      RETURNING id, order_number`,
    [id]
  );
  if (done.rows[0]) return { id, number: done.rows[0].order_number };

  const found = await pool.query('SELECT order_number FROM orders WHERE id = $1', [id]);
  if (!found.rows[0]) throw notFound('Order not found.');
  throw conflict(`Order #${found.rows[0].order_number} is already completed.`);
}