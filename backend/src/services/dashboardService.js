import { pool } from '../config/db.js';
import { todaySG } from '../utils/dates.js';
import { listMovements } from './movementService.js';

const BRIEF = `
  SELECT o.id, o.order_number, o.total, o.status, o.created_at,
         COALESCE(SUM(oi.qty), 0)::int AS item_count
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id`;

const mapBrief = (r) => ({
  id: r.id,
  number: r.order_number,
  total: r.total,
  status: r.status,
  createdAt: r.created_at,
  itemCount: r.item_count,
});

export async function salesDashboard() {
  const today = todaySG();
  const [daily, preparing, preparingCount, top, recent] = await Promise.all([
    pool.query(
      'SELECT orders, sales, average_order FROM v_daily_sales WHERE sales_date = $1::date',
      [today]
    ),
    pool.query(
      `${BRIEF} WHERE o.status = 'preparing' GROUP BY o.id
        ORDER BY o.created_at DESC, o.id DESC LIMIT 5`
    ),
    pool.query(`SELECT COUNT(*)::int AS n FROM orders WHERE status = 'preparing'`),
    pool.query(
      `SELECT item_name, qty_sold FROM v_item_sales
        WHERE sales_date = $1::date
        ORDER BY qty_sold DESC, item_name LIMIT 5`,
      [today]
    ),
    pool.query(`${BRIEF} GROUP BY o.id ORDER BY o.created_at DESC, o.id DESC LIMIT 5`),
  ]);

  const d = daily.rows[0];
  return {
    todayOrders: d?.orders ?? 0,
    todaySales: d?.sales ?? 0,
    averageOrder: d?.average_order ?? 0,
    preparingCount: preparingCount.rows[0].n,
    preparingOrders: preparing.rows.map(mapBrief),
    topSellers: top.rows.map((r) => ({ name: r.item_name, qty: r.qty_sold })),
    recentOrders: recent.rows.map(mapBrief),
  };
}

export async function inventoryDashboard() {
  const [stock, expiry, alerts, losses, movements] = await Promise.all([
    pool.query(
      `SELECT item_id, name, item_type, unit, min_level,
              CASE WHEN item_type = 'ingredient' THEN qty_on_hand ELSE qty_usable END AS stock
         FROM v_item_stock`
    ),
    pool.query(
      `SELECT expiry_status, COUNT(*)::int AS n
         FROM v_batch_status
        WHERE qty_remaining > 0 AND expiry_status IN ('expired', 'soon')
        GROUP BY expiry_status`
    ),
    pool.query(
      `SELECT batch_code, item_name, unit, qty_remaining, expiry_date, expiry_status
         FROM v_batch_status
        WHERE qty_remaining > 0 AND expiry_status IN ('expired', 'soon')
        ORDER BY expiry_date, batch_code
        LIMIT 5`
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM stock_movements
        WHERE movement_type IN ('DAMAGED', 'SPOILED') AND created_at >= now() - interval '7 days'`
    ),
    listMovements({ types: [], q: '', limit: 5, offset: 0 }),
  ]);

  const items = stock.rows.map((r) => ({
    id: r.item_id,
    name: r.name,
    type: r.item_type,
    unit: r.unit,
    stock: r.stock,
    minLevel: r.min_level,
    status: r.stock <= 0 ? 'out' : r.stock <= r.min_level ? 'low' : 'in',
  }));
  const lowOrOut = items
    .filter((i) => i.status !== 'in')
    .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'out' ? -1 : 1));

  const count = (status) => expiry.rows.find((r) => r.expiry_status === status)?.n ?? 0;

  return {
    totalItems: items.length,
    ingredientCount: items.filter((i) => i.type === 'ingredient').length,
    menuItemCount: items.filter((i) => i.type !== 'ingredient').length,
    lowOrOutCount: lowOrOut.length,
    lowOrOut: lowOrOut.slice(0, 5),
    expiredCount: count('expired'),
    soonCount: count('soon'),
    expiryAlerts: alerts.rows.map((r) => ({
      batchCode: r.batch_code,
      itemName: r.item_name,
      unit: r.unit,
      qtyRemaining: r.qty_remaining,
      expiryDate: r.expiry_date,
      status: r.expiry_status,
    })),
    losses7d: losses.rows[0].n,
    recentMovements: movements.movements,
  };
}