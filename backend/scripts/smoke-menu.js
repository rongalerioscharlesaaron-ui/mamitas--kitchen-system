import crypto from 'node:crypto';
import { api, check, summary, ensureUser, loginAs, query, pool, dayOffset } from './test-helpers.js';

const rand = () => crypto.randomBytes(12).toString('hex');
const suffix = crypto.randomBytes(3).toString('hex');
const N = {
  dish: `Smoke Menu Dish ${suffix}`,
  tray: `Smoke Menu Tray ${suffix}`,
  ing: `Smoke Menu Ing ${suffix}`,
};

async function main() {
  try {
    await api('GET', '/health');
  } catch {
    console.error('Cannot reach the API. Start it first: npm start (in another terminal).');
    process.exitCode = 1;
    return;
  }

  const pw = { kitchen: rand(), cashier: rand() };
  await ensureUser('smoke_kitchen', 'kitchen', pw.kitchen);
  await ensureUser('smoke_cashier', 'cashier', pw.cashier);

  try {
    const K = await loginAs('smoke_kitchen', pw.kitchen);
    const C = await loginAs('smoke_cashier', pw.cashier);
    const today = (await query('SELECT CURRENT_DATE::text AS d')).rows[0].d;

    const food = async (id) => (await api('GET', '/items', { cookie: K })).data.items.find((i) => i.id === id);
    const loss = (id, body, cookie = K) => api('POST', `/items/${id}/loss`, { cookie, body });
    const adjust = (id, countedQty, reason = 'Stock count', cookie = K) =>
      api('POST', `/items/${id}/adjust`, { cookie, body: { countedQty, reason } });
    const expireAll = (id) =>
      query(
        `UPDATE inventory_batches SET received_date = CURRENT_DATE - 2, expiry_date = CURRENT_DATE - 2
          WHERE item_id = $1 AND qty_remaining > 0`,
        [id]
      );

    // ---------- No expiry date for foods and trays ----------
    const dish = await api('POST', '/items', {
      cookie: K,
      body: {
        type: 'food', name: N.dish, category: 'Main dishes', price: 5, minLevel: 2, trays: 1,
        expiry: dayOffset(30),
      },
    });
    check('A dish is created with 1 tray (10 servings) and no expiry date is needed (201)',
      dish.status === 201, `got ${dish.status} ${JSON.stringify(dish.data)}`);
    const dishId = dish.data?.item?.id;

    const b1 = (await api('GET', `/batches?itemId=${dishId}`, { cookie: K })).data?.batches?.[0];
    check('Its servings expire today, even though an expiry date was sent',
      b1?.expiryDate === today && b1?.daysLeft === 0, JSON.stringify(b1));

    const tray = await api('POST', '/items', {
      cookie: K, body: { type: 'food_tray', name: N.tray, price: 30, minLevel: 1, qty: 4 },
    });
    const trayId = tray.data?.item?.id;
    const tb = (await api('GET', `/batches?itemId=${trayId}`, { cookie: K })).data?.batches?.[0];
    check('A food tray is created and expires today too',
      tray.status === 201 && tb?.expiryDate === today, `${tray.status} ${JSON.stringify(tb)}`);

    const more = await api('POST', `/items/${dishId}/batches`, {
      cookie: K, body: { trays: 1, expiry: dayOffset(10) },
    });
    const dishBatches = (await api('GET', `/batches?itemId=${dishId}`, { cookie: K })).data?.batches ?? [];
    check('Adding a tray ignores any expiry date: still 2 deliveries, all expiring today, 20 available',
      more.status === 201 && more.data?.servings === 10 && dishBatches.length === 2
        && dishBatches.every((b) => b.expiryDate === today)
        && (await food(dishId))?.qtyUsable === 20, `${more.status} ${JSON.stringify(dishBatches)}`);

    const raw = await query(
      `INSERT INTO inventory_batches (item_id, qty_received, qty_remaining, expiry_date)
       VALUES ($1, 1, 1, CURRENT_DATE + 30) RETURNING received_date, expiry_date`,
      [trayId]
    );
    check('The database itself forces a food batch to expire on the day it is received',
      raw.rows[0].expiry_date === raw.rows[0].received_date, JSON.stringify(raw.rows[0]));

    const inv = await api('GET', '/dashboard/inventory', { cookie: K });
    check('The dashboard never lists "expiring soon" foods or trays',
      inv.status === 200 && inv.data.expiryAlerts.every((a) => a.status !== 'soon' || a.itemType === 'ingredient'),
      JSON.stringify(inv.data?.expiryAlerts));

    // ---------- Damaged servings, no batch needed ----------
    const ing = await api('POST', '/items', {
      cookie: K,
      body: { type: 'ingredient', name: N.ing, category: 'Dry ingredients', unit: 'kg',
              minLevel: 1, hasExpiry: false, qty: 5 },
    });
    const ingId = ing.data?.item?.id;

    check('Recording more damage than there is is refused (400)',
      (await loss(dishId, { type: 'DAMAGED', qty: 99, reason: 'Dropped' })).status === 400);
    check('Half a serving is refused (400)',
      (await loss(dishId, { type: 'DAMAGED', qty: 2.5, reason: 'Dropped' })).status === 400);
    check('The item-level damage route refuses ingredients (400)',
      (await loss(ingId, { type: 'DAMAGED', qty: 1, reason: 'Dropped' })).status === 400);

    const lost = await loss(dishId, { type: 'DAMAGED', qty: 3, reason: 'Dropped' });
    check('3 damaged servings are taken from today\'s stock without choosing a batch (20 becomes 17)',
      lost.status === 200 && lost.data?.result?.remaining === 17 && (await food(dishId))?.qtyUsable === 17,
      `${lost.status} ${JSON.stringify(lost.data)}`);
    const dmgLog = await api('GET',
      `/movements?kind=menu&type=DAMAGED&q=${encodeURIComponent(N.dish)}`, { cookie: K });
    check('The menu movement log shows the damaged servings',
      (dmgLog.data?.movements ?? []).some((m) => m.type === 'DAMAGED' && m.qty === 3));

    // ---------- Adjusting servings ----------
    check('Counting the same number is refused (400)', (await adjust(dishId, 17)).status === 400);
    check('Counting half a serving is refused (400)', (await adjust(dishId, 4.5)).status === 400);
    check('An empty reason is refused (400)', (await adjust(dishId, 5, '')).status === 400);

    const up = await adjust(dishId, 25);
    check('Counting 25 when the system shows 17 gives +8',
      up.status === 200 && up.data?.result?.diff === 8 && (await food(dishId))?.qtyUsable === 25,
      `${up.status} ${JSON.stringify(up.data)}`);
    const down = await adjust(dishId, 9);
    check('Counting 9 gives -16, taken oldest first',
      down.status === 200 && down.data?.result?.diff === -16 && (await food(dishId))?.qtyUsable === 9,
      `${down.status} ${JSON.stringify(down.data)}`);
    const adjLog = (await api('GET',
      `/movements?kind=menu&type=ADJUSTMENT&q=${encodeURIComponent(N.dish)}`, { cookie: K })).data?.movements ?? [];
    check('The log has 3 adjustments that add up to -8 (+8, -7, -9)',
      adjLog.length === 3 && adjLog.reduce((s, m) => s + m.qty, 0) === -8, JSON.stringify(adjLog.map((m) => m.qty)));

    const zero = await adjust(dishId, 0, 'None left');
    check('Counting 0 shows the dish as out of stock',
      zero.status === 200 && (await food(dishId))?.status === 'out', `got ${zero.status}`);
    const fresh = await adjust(dishId, 6, 'Cooked more');
    check('Counting servings when none are left starts new stock for today (6)',
      fresh.status === 200 && (await food(dishId))?.qtyUsable === 6, `got ${fresh.status}`);

    // ---------- Expired servings ----------
    await expireAll(dishId);
    const gone = await food(dishId);
    check('From the next day the servings are expired: 0 can be sold, 6 are still on hand',
      gone?.qtyUsable === 0 && gone?.qtyOnHand === 6, JSON.stringify(gone));
    const exp = await api('GET', '/batches?status=expired&kind=menu', { cookie: K });
    check('The expired servings are listed for Expiration Monitoring',
      exp.status === 200 && exp.data.batches.some((b) => b.itemId === dishId));

    const wo = await api('POST', '/items/write-off-expired', { cookie: K, body: { itemId: dishId } });
    check('Writing off the item clears the 6 expired servings',
      wo.status === 200 && wo.data?.result?.servings === 6 && (await food(dishId))?.qtyOnHand === 0,
      `${wo.status} ${JSON.stringify(wo.data)}`);
    const spoiled = await api('GET',
      `/movements?kind=menu&type=SPOILED&q=${encodeURIComponent(N.dish)}`, { cookie: K });
    check('The write-off is logged as Spoiled with the reason "Expired"',
      (spoiled.data?.movements ?? []).some((m) => m.qty === 6 && m.reason === 'Expired'));
    const again = await api('POST', '/items/write-off-expired', { cookie: K, body: { itemId: dishId } });
    check('Writing off again finds nothing to do',
      again.status === 200 && again.data?.result?.batches === 0);

    await adjust(dishId, 3, 'Cooked more');
    await expireAll(dishId);
    const bulk = await api('POST', '/items/write-off-expired', { cookie: K, body: {} });
    check('"Write off all expired" clears every expired serving on the menu',
      bulk.status === 200 && bulk.data?.result?.servings >= 3 && (await food(dishId))?.qtyOnHand === 0,
      `${bulk.status} ${JSON.stringify(bulk.data)}`);

    // ---------- Roles and log filters ----------
    const denied = [
      (await loss(dishId, { type: 'DAMAGED', qty: 1, reason: 'x' }, C)).status,
      (await adjust(dishId, 1, 'x', C)).status,
      (await api('POST', '/items/write-off-expired', { cookie: C, body: {} })).status,
    ];
    check('Cashiers cannot damage, adjust, or write off menu stock (403 each)',
      denied.every((s) => s === 403), denied.join(', '));

    const ingLog = await api('GET', '/movements?kind=ingredient&limit=200', { cookie: K });
    check('The ingredient log shows only ingredients',
      ingLog.status === 200 && ingLog.data.movements.length > 0
        && ingLog.data.movements.every((m) => m.itemType === 'ingredient'));
    const menuLog = await api('GET', '/movements?kind=menu&limit=200', { cookie: K });
    check('The menu log shows only foods and trays',
      menuLog.status === 200 && menuLog.data.movements.length > 0
        && menuLog.data.movements.every((m) => m.itemType !== 'ingredient'));
    check('An unknown log kind is refused (400)',
      (await api('GET', '/movements?kind=other', { cookie: K })).status === 400);
  } finally {
    await query(`UPDATE items SET is_active = FALSE WHERE name LIKE 'Smoke %'`);
    await query(
      `UPDATE users SET is_active = FALSE, locked_until = NULL
        WHERE lower(username) IN ('smoke_kitchen', 'smoke_cashier')`
    );
    await pool.end();
  }

  summary();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});