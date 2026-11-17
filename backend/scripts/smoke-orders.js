import crypto from 'node:crypto';
import {
  api, check, summary, ensureUser, loginAs, query, pool, dayOffset, ensureOpenSession,
} from './test-helpers.js';

const rand = () => crypto.randomBytes(12).toString('hex');
const suffix = crypto.randomBytes(3).toString('hex');
const N = { a: `Smoke Pos A ${suffix}`, b: `Smoke Pos B ${suffix}`, c: `Smoke Pos C ${suffix}` };

async function main() {
  try {
    await api('GET', '/health');
  } catch {
    console.error('Cannot reach the API. Start it first: npm start (in another terminal).');
    process.exitCode = 1;
    return;
  }

  const pw = { kitchen: rand(), cashier: rand(), owner: rand() };
  await ensureUser('smoke_kitchen', 'kitchen', pw.kitchen);
  await ensureUser('smoke_cashier', 'cashier', pw.cashier);
  await ensureUser('smoke_owner', 'owner', pw.owner);

  try {
    const K = await loginAs('smoke_kitchen', pw.kitchen);
    const C = await loginAs('smoke_cashier', pw.cashier);
    const O = await loginAs('smoke_owner', pw.owner);
     await ensureOpenSession(C);

    const place = (lines, payment, extra = {}, cookie = C) =>
      api('POST', '/orders', { cookie, body: { type: 'dine_in', lines, payment, ...extra } });
    const food = async (id) =>
      (await api('GET', '/items?type=food', { cookie: K })).data.items.find((i) => i.id === id);

    // ---------- Who can do what ----------
    check('Not logged in: placing an order is refused (401)',
      (await api('POST', '/orders', { body: {} })).status === 401);
    check('Kitchen staff cannot place orders (403)',
      (await api('POST', '/orders', { cookie: K, body: {} })).status === 403);
    check('Kitchen staff cannot read orders (403)',
      (await api('GET', '/orders', { cookie: K })).status === 403);
    check('Cashier cannot open the inventory dashboard (403)',
      (await api('GET', '/dashboard/inventory', { cookie: C })).status === 403);
    check('Kitchen staff cannot open the sales dashboard (403)',
      (await api('GET', '/dashboard/sales', { cookie: K })).status === 403);
    check('Not logged in: the dashboard is refused (401)',
      (await api('GET', '/dashboard/sales')).status === 401);

    // ---------- Test menu items, made through the inventory API ----------
    const make = async (name, price, qty, expiry) =>
      (await api('POST', '/items', {
        cookie: K,
        body: {
          type: 'food', name, category: 'Main dishes', price, minLevel: 1, qty,
          ...(expiry ? { expiry } : {}),
        },
      })).data;
    const A = await make(N.a, 6, 10);
    const B = await make(N.b, 2.5, 3);
    const Cc = await make(N.c, 4, 5, dayOffset(5));
    const idA = A.item.id;
    const idB = B.item.id;
    const idC = Cc.item.id;
    const second = await api('POST', `/items/${idA}/batches`, { cookie: K, body: { qty: 5 } });
    await query(
      `UPDATE inventory_batches SET received_date = CURRENT_DATE - 5, expiry_date = CURRENT_DATE - 1
        WHERE id = $1`,
      [Cc.batch.id]
    ); // makes C's only batch expired (test-only shortcut)

    // ---------- Bad orders are refused ----------
    const cash = { method: 'cash', tendered: 100 };
    const ingredient = (await api('GET', '/items?type=ingredient', { cookie: K })).data.items[0];

    check('An empty order is refused (400)', (await place([], cash)).status === 400);
    check('An unknown item is refused (400)',
      (await place([{ itemId: 2147483000, qty: 1 }], cash)).status === 400);
    check('An ingredient cannot be sold (400)',
      (await place([{ itemId: ingredient.id, qty: 1 }], cash)).status === 400);
    check('Quantity 0 is refused (400)', (await place([{ itemId: idA, qty: 0 }], cash)).status === 400);
    check('Quantity 2.5 is refused (400)', (await place([{ itemId: idA, qty: 2.5 }], cash)).status === 400);
    check('Quantity 100 is refused (400)', (await place([{ itemId: idA, qty: 100 }], cash)).status === 400);
    check('An unknown payment method is refused (400)',
      (await place([{ itemId: idA, qty: 1 }], { method: 'bitcoin' })).status === 400);
    check('Cash below the total is refused (400)',
      (await place([{ itemId: idA, qty: 1 }], { method: 'cash', tendered: 5 })).status === 400);
    check('A missing payment is refused (400)',
      (await place([{ itemId: idA, qty: 1 }], undefined)).status === 400);

    // ---------- A normal cash order ----------
    const o1 = await place(
      [{ itemId: idA, qty: 2 }, { itemId: idB, qty: 1 }],
      { method: 'cash', tendered: 20 }
    );
    const ord1 = o1.data?.order;
    check('Cash order: total 14.50, change 5.50, status preparing, 4-digit number (201)',
      o1.status === 201 && ord1?.total === 14.5 && ord1?.payment?.change === 5.5
        && ord1?.status === 'preparing' && /^\d{4}$/.test(ord1?.number ?? '')
        && ord1?.lines?.length === 2 && ord1?.cashier === 'Smoke test cashier',
      `${o1.status} ${JSON.stringify(o1.data)}`);

    const a1 = await food(idA);
    const b1 = await food(idB);
    check('The sale took servings from stock (A 15 becomes 13, B 3 becomes 2)',
      a1?.qtyUsable === 13 && b1?.qtyUsable === 2, `A=${a1?.qtyUsable} B=${b1?.qty}`);

    // ---------- A short order changes nothing ----------
    const countBefore = (await api('GET', '/orders?limit=1', { cookie: C })).data.total;
    const short = await place(
      [{ itemId: idA, qty: 1 }, { itemId: idB, qty: 3 }],
      { method: 'cash', tendered: 50 }
    );
    check('Selling more than is in stock is refused with a clear message (400)',
      short.status === 400 && /Not enough/.test(short.data?.error ?? ''),
      `${short.status} ${short.data?.error}`);
    const a2 = await food(idA);
    const b2 = await food(idB);
    check('The refused order changed nothing: all or nothing',
      a2?.qtyUsable === 13 && b2?.qtyUsable === 2, `A=${a2?.qtyUsable} B=${b2?.qtyUsable}`);
    const countAfter = (await api('GET', '/orders?limit=1', { cookie: C })).data.total;
    check('No order record was created', countAfter === countBefore, `${countBefore} vs ${countAfter}`);

    // ---------- Prices come from the server; numbers have no gaps ----------
    const o2 = await place(
      [{ itemId: idA, qty: 1, price: 0.01 }],
      { method: 'card' }
    );
    const ord2 = o2.data?.order;
    check('A price sent by the browser is ignored (total is 6.00); card pays exactly',
      o2.status === 201 && ord2?.total === 6 && ord2?.payment?.tendered === 6
        && ord2?.payment?.change === 0, `${o2.status} ${JSON.stringify(o2.data)}`);
    check('The failed order did not use up an order number',
      Number(ord2?.number) === Number(ord1?.number) + 1, `${ord1?.number} then ${ord2?.number}`);

    // ---------- Double-click protection ----------
    const requestId = crypto.randomUUID();
    const d1 = await place([{ itemId: idA, qty: 1 }], { method: 'paynow' }, { requestId });
    const d2 = await place([{ itemId: idA, qty: 1 }], { method: 'paynow' }, { requestId });
    check('First request with a request ID creates the order (201)', d1.status === 201,
      `got ${d1.status}`);
    check('The same request again returns the same order (200, duplicate)',
      d2.status === 200 && d2.data?.duplicate === true && d2.data?.order?.id === d1.data?.order?.id,
      `${d2.status} ${JSON.stringify(d2.data)}`);
    const a3 = await food(idA);
    check('The stock was taken only once (A is 11)', a3?.qtyUsable === 11, `A=${a3?.qtyUsable}`);

    // ---------- Oldest batch first ----------
    const o4 = await place([{ itemId: idA, qty: 9 }], { method: 'cash', tendered: 60 });
    check('A big order is placed (9 x 6.00 = 54.00)',
      o4.status === 201 && o4.data?.order?.total === 54, `got ${o4.status}`);
    const batches = (await api('GET', `/batches?itemId=${idA}`, { cookie: K })).data.batches;
    const first = batches.find((b) => b.id === A.batch.id);
    const next = batches.find((b) => b.id === second.data?.batch?.id);
    check('The oldest batch emptied first (batch 1 is 0, batch 2 is 2)',
      first?.qtyRemaining === 0 && next?.qtyRemaining === 2,
      `${first?.qtyRemaining} and ${next?.qtyRemaining}`);

    const usedLog = (await api(
      'GET', `/movements?q=${encodeURIComponent(N.a)}&type=USED&limit=100`, { cookie: K }
    )).data.movements.filter((m) => m.itemName === N.a);
    const usedTotal = usedLog.reduce((sum, m) => sum + m.qty, 0);
    check('Every sale wrote a Used entry with its order number, recorded by POS (13 in total)',
      usedTotal === 13 && usedLog.every((m) => m.orderNumber && m.recordedBy === 'POS'),
      `${usedTotal} ${JSON.stringify(usedLog[0])}`);

    // ---------- Expired stock is never sold ----------
    const expired = await place([{ itemId: idC, qty: 1 }], cash);
    check('Expired servings cannot be sold (400)',
      expired.status === 400 && /Not enough/.test(expired.data?.error ?? ''),
      `${expired.status} ${expired.data?.error}`);
    const menu = (await api('GET', '/menu', { cookie: C })).data.items.find((i) => i.id === idC);
    check('The menu shows that item as out of stock',
      menu?.qtyUsable === 0 && menu?.status === 'out', JSON.stringify(menu));

    // ---------- Order history ----------
    const todays = await api('GET', '/orders?date=today&limit=500', { cookie: C });
    const numbers = (todays.data?.orders ?? []).map((o) => o.number);
    check('Order history for today lists the new orders, with lines and payment',
      [ord1.number, ord2.number, d1.data.order.number, o4.data.order.number].every((n) => numbers.includes(n))
        && todays.data.orders[0].lines[0].name && todays.data.orders[0].payment.method,
      numbers.join(','));
    const prep = await api('GET', '/orders?status=preparing&limit=500', { cookie: C });
    check('The status filter returns only orders still being prepared',
      prep.data.orders.length > 0 && prep.data.orders.every((o) => o.status === 'preparing'));
    const byNumber = await api('GET', `/orders?q=${ord1.number}`, { cookie: C });
    check('Searching by order number finds the order',
      byNumber.data.orders.some((o) => o.number === ord1.number));

    // ---------- Completing orders ----------
    const done = await api('PATCH', `/orders/${ord1.id}/complete`, { cookie: C });
    check('The cashier marks the order completed (200)',
      done.status === 200 && done.data?.order?.status === 'completed', `got ${done.status}`);
    check('Completing it twice is refused (409)',
      (await api('PATCH', `/orders/${ord1.id}/complete`, { cookie: C })).status === 409);
    check('Completing an unknown order gives 404',
      (await api('PATCH', '/orders/999999999/complete', { cookie: C })).status === 404);
    check('Kitchen staff cannot complete orders (403)',
      (await api('PATCH', `/orders/${ord2.id}/complete`, { cookie: K })).status === 403);
    const single = await api('GET', `/orders/${ord1.id}`, { cookie: C });
    check('A single order can be fetched for a receipt, with its completed time',
      single.status === 200 && single.data?.order?.status === 'completed'
        && Boolean(single.data?.order?.completedAt));

    // ---------- Dashboards ----------
    const sales = await api('GET', '/dashboard/sales', { cookie: C });
    const s = sales.data ?? {};
    check('The sales dashboard shows today\'s orders, sales, and lists',
      sales.status === 200 && s.todayOrders >= 4 && s.todaySales >= 80.5
        && typeof s.preparingCount === 'number' && Array.isArray(s.preparingOrders)
        && s.recentOrders?.length >= 1 && s.recentOrders.length <= 5, JSON.stringify(s));
    check('Top sellers include the test item with 13 sold',
      (s.topSellers ?? []).some((t) => t.name === N.a && t.qty === 13), JSON.stringify(s.topSellers));

    const inv = await api('GET', '/dashboard/inventory', { cookie: K });
    const v = inv.data ?? {};
    check('The inventory dashboard shows totals, low stock, expiry, and recent movements',
      inv.status === 200 && v.totalItems >= 16 && typeof v.lowOrOutCount === 'number'
        && Array.isArray(v.lowOrOut) && Array.isArray(v.expiryAlerts) && v.expiredCount >= 1
        && typeof v.soonCount === 'number' && typeof v.losses7d === 'number'
        && v.recentMovements?.length === 5, JSON.stringify(v).slice(0, 300));

    // ---------- Activity log and settings ----------
    const log = await api('GET', '/audit-log?limit=200', { cookie: O });
    const actions = new Set((log.data?.entries ?? []).map((e) => e.action));
    check('The activity log recorded orders placed and completed',
      actions.has('order.placed') && actions.has('order.completed'), [...actions].join(','));

    const shop = await api('GET', '/shop', { cookie: C });
    check('The shop settings are available to the cashier',
      shop.status === 200 && shop.data?.shop?.gstRate === 0.09
        && typeof shop.data.shop.gstRegistered === 'boolean' && Boolean(shop.data.shop.name),
      JSON.stringify(shop.data));
  } finally {
    await query(`UPDATE items SET is_active = FALSE WHERE name LIKE 'Smoke %'`);
    await query(
      `UPDATE users SET is_active = FALSE, locked_until = NULL
        WHERE lower(username) IN ('smoke_kitchen', 'smoke_cashier', 'smoke_owner')`
    );
    await pool.end();
  }

  summary();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});