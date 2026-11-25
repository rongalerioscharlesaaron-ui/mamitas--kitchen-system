import { pool } from '../config/db.js';
import { todaySG } from '../utils/dates.js';
import { listMovements } from './movementService.js';

const BRIEF = `
  SELECT o.id, o.order_number, o.order_type, o.total, o.status, o.created_at,
         COALESCE(SUM(oi.qty), 0)::int AS item_count
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id`;

const mapBrief = (r) => ({
  id: r.id,
  number: r.order_number,
  type: r.order_type,
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

// Foods and trays always expire on the day they are added, so only EXPIRED ones raise an alert
const ALERT_RULE = `qty_remaining > 0
    AND expiry_status IN ('expired', 'soon')
    AND (item_type = 'ingredient' OR expiry_status = 'expired')`;

export async function inventoryDashboard() {
  const [stock, expiry, alerts, losses, dailyMoves, movements] = await Promise.all([
    pool.query(
      `SELECT item_id, name, item_type, category, unit, min_level,
              CASE WHEN item_type = 'ingredient' THEN qty_on_hand ELSE qty_usable END AS stock
         FROM v_item_stock
        WHERE is_enabled`
    ),
    pool.query(
      `SELECT expiry_status, COUNT(*)::int AS n
         FROM v_batch_status
        WHERE ${ALERT_RULE}
        GROUP BY expiry_status`
    ),
    pool.query(
      `SELECT batch_code, item_name, item_type, unit, qty_remaining, expiry_date, days_left, expiry_status
         FROM v_batch_status
        WHERE ${ALERT_RULE}
        ORDER BY (expiry_status = 'expired') DESC, expiry_date, batch_code
        LIMIT 5`
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM stock_movements
        WHERE movement_type IN ('DAMAGED', 'SPOILED') AND created_at >= now() - interval '7 days'`
    ),
    pool.query(
      `WITH days AS (
         SELECT generate_series(
           (now() AT TIME ZONE 'Asia/Singapore')::date - 6,
           (now() AT TIME ZONE 'Asia/Singapore')::date,
           interval '1 day'
         )::date AS day
       )
       SELECT to_char(d.day, 'Mon DD') AS label,
              d.day::text AS date_key,
              COUNT(m.id) FILTER (WHERE m.movement_type = 'IN')::int AS stock_in,
              COUNT(m.id) FILTER (WHERE m.movement_type = 'USED')::int AS used,
              COUNT(m.id) FILTER (WHERE m.movement_type IN ('DAMAGED', 'SPOILED'))::int AS waste
         FROM days d
         LEFT JOIN stock_movements m
           ON (m.created_at AT TIME ZONE 'Asia/Singapore')::date = d.day
        GROUP BY d.day
        ORDER BY d.day`
    ),
    listMovements({ types: [], q: '', limit: 5, offset: 0 }),
  ]);

  const items = stock.rows.map((r) => {
    const qty = Number(r.stock);
    const min = Number(r.min_level);
    return {
      id: r.item_id,
      name: r.name,
      type: r.item_type,
      category: r.category,
      unit: r.unit,
      stock: qty,
      minLevel: min,
      status: qty <= 0 ? 'out' : qty <= min ? 'low' : 'in',
    };
  });

  const summarize = (list) => ({
    total: list.length,
    inStock: list.filter((i) => i.status === 'in').length,
    low: list.filter((i) => i.status === 'low').length,
    out: list.filter((i) => i.status === 'out').length,
  });

  const ingredients = items.filter((i) => i.type === 'ingredient');
  const menuItems = items.filter((i) => i.type !== 'ingredient');

  const categoryMap = new Map();
  for (const item of items) {
    if (!categoryMap.has(item.category)) {
      categoryMap.set(item.category, { category: item.category, total: 0, inStock: 0, low: 0, out: 0 });
    }
    const entry = categoryMap.get(item.category);
    entry.total += 1;
    if (item.status === 'in') entry.inStock += 1;
    else if (item.status === 'low') entry.low += 1;
    else entry.out += 1;
  }

  const categories = [...categoryMap.values()].sort(
    (a, b) => (b.out + b.low) - (a.out + a.low) || a.category.localeCompare(b.category)
  );

  const lowOrOut = items
    .filter((i) => i.status !== 'in')
    .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'out' ? -1 : 1));

  const count = (status) => expiry.rows.find((r) => r.expiry_status === status)?.n ?? 0;

  return {
    totalItems: items.length,
    ingredientCount: ingredients.length,
    menuItemCount: menuItems.length,
    stockHealth: {
      overall: summarize(items),
      ingredients: summarize(ingredients),
      menu: summarize(menuItems),
    },
    categories,
    dailyMovements: dailyMoves.rows.map((r) => ({
      date: r.date_key,
      label: r.label,
      in: r.stock_in,
      used: r.used,
      waste: r.waste,
    })),
    lowOrOutCount: lowOrOut.length,
    lowOrOut: lowOrOut.slice(0, 6),
    expiredCount: count('expired'),
    soonCount: count('soon'),
    expiryAlerts: alerts.rows.map((r) => ({
      batchCode: r.batch_code,
      itemName: r.item_name,
      itemType: r.item_type,
      unit: r.unit,
      qtyRemaining: r.qty_remaining,
      expiryDate: r.expiry_date,
      daysLeft: r.days_left,
      status: r.expiry_status,
    })),
    losses7d: losses.rows[0].n,
    recentMovements: movements.movements,
  };
}