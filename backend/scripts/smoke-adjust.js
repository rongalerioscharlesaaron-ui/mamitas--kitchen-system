import crypto from 'node:crypto';
import { api, check, summary, ensureUser, loginAs, query, pool } from './test-helpers.js';

const rand = () => crypto.randomBytes(12).toString('hex');
const suffix = crypto.randomBytes(3).toString('hex');
const N = { ing: `Smoke Adj Ing ${suffix}`, dish: `Smoke Adj Dish ${suffix}` };

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

    const adjust = (batchId, countedQty, reason = 'Stock count', cookie = K) =>
      api('POST', `/batches/${batchId}/adjust`, { cookie, body: { countedQty, reason } });
    const getItem = async (id) =>
      (await api('GET', '/items', { cookie: K })).data.items.find((i) => i.id === id);

    check('Not logged in: adjusting is refused (401)',
      (await api('POST', '/batches/1/adjust', { body: { countedQty: 1, reason: 'x' } })).status === 401);
    check('Cashier cannot adjust stock (403)', (await adjust(1, 5, 'x', C)).status === 403);

    // ---------- Test items ----------
    const ing = await api('POST', '/items', {
      cookie: K,
      body: { type: 'ingredient', name: N.ing, category: 'Dry ingredients', unit: 'kg',
              minLevel: 2, hasExpiry: false, qty: 10 },
    });
    check('Test ingredient created with 10 kg (201)', ing.status === 201, `got ${ing.status} ${JSON.stringify(ing.data)}`);
    const ingId = ing.data.item.id;
    const ingBatch = ing.data.batch;

    const dish = await api('POST', '/items', {
      cookie: K,
      body: { type: 'food', name: N.dish, category: 'Main dishes', price: 5, minLevel: 2, qty: 10 },
    });
    check('Test dish created with 10 servings (201)', dish.status === 201, `got ${dish.status}`);
    const dishId = dish.data.item.id;
    const dishBatch = dish.data.batch;

    // ---------- Adjusting an ingredient ----------
    const down = await adjust(ingBatch.id, 7.5);
    check('Counting 7.5 kg when the system shows 10 kg is accepted (from 10, to 7.5, difference -2.5)',
      down.status === 200 && down.data?.result?.from === 10 && down.data?.result?.to === 7.5
        && down.data?.result?.diff === -2.5, `${down.status} ${JSON.stringify(down.data)}`);
    check('The stock on hand is now 7.5', (await getItem(ingId))?.qtyOnHand === 7.5);

    const logDown = await api('GET',
      `/movements?type=ADJUSTMENT&q=${encodeURIComponent(N.ing)}`, { cookie: K });
    const entry = logDown.data?.movements?.[0];
    check('The log shows an Adjustment of -2.5, with the reason and who recorded it',
      entry?.type === 'ADJUSTMENT' && entry?.qty === -2.5 && entry?.reason === 'Stock count'
        && entry?.recordedBy === 'Smoke test kitchen', JSON.stringify(entry));

    check('Counting the same quantity again is refused (400)', (await adjust(ingBatch.id, 7.5)).status === 400);
    check('An empty reason is refused (400)', (await adjust(ingBatch.id, 5, '')).status === 400);
    check('A negative quantity is refused (400)', (await adjust(ingBatch.id, -1)).status === 400);
    check('A non-number is refused (400)', (await adjust(ingBatch.id, 'abc')).status === 400);

    const up = await adjust(ingBatch.id, 12, 'Opening count correction');
    const afterUp = (await api('GET', `/batches?itemId=${ingId}`, { cookie: K })).data.batches[0];
    check('Counting more than was received works, and "received" is raised to match (12)',
      up.status === 200 && up.data?.result?.diff === 4.5
        && afterUp?.qtyRemaining === 12 && afterUp?.qtyReceived === 12,
      `${up.status} ${JSON.stringify(afterUp)}`);
    const logUp = await api('GET', `/movements?type=ADJUSTMENT&q=${encodeURIComponent(N.ing)}`, { cookie: K });
    check('The log now also shows an Adjustment of +4.5',
      (logUp.data?.movements ?? []).some((m) => m.qty === 4.5));

    const recon = await query(
      `SELECT b.qty_remaining AS remaining,
              SUM(CASE m.movement_type WHEN 'IN' THEN m.qty WHEN 'ADJUSTMENT' THEN m.qty ELSE -m.qty END) AS history
         FROM inventory_batches b
         JOIN stock_movements m ON m.batch_id = b.id
        WHERE b.id = $1
        GROUP BY b.id`,
      [ingBatch.id]
    );
    check('The batch quantity equals its movement history (10 - 2.5 + 4.5 = 12)',
      recon.rows[0]?.remaining === 12 && recon.rows[0]?.history === 12, JSON.stringify(recon.rows[0]));

    check('The owner can adjust too (200)', (await adjust(ingBatch.id, 11, 'Recount', O)).status === 200);

    // ---------- Adjusting servings ----------
    check('Half a serving is refused: whole numbers only (400)', (await adjust(dishBatch.id, 7.5)).status === 400);
    const dishDown = await adjust(dishBatch.id, 8);
    check('Counting 8 servings when the system shows 10 is accepted',
      dishDown.status === 200 && (await getItem(dishId))?.qtyUsable === 8, `got ${dishDown.status}`);
    const dishZero = await adjust(dishBatch.id, 0, 'None left');
    check('Counting 0 is accepted and the dish shows as out of stock',
      dishZero.status === 200 && (await getItem(dishId))?.status === 'out', `got ${dishZero.status}`);

    check('An unknown batch gives 404', (await adjust(999999999, 1)).status === 404);

    const onlyAdj = await api('GET', '/movements?type=ADJUSTMENT&limit=200', { cookie: K });
    check('The ADJUSTMENT filter returns only adjustments',
      onlyAdj.data.movements.length > 0 && onlyAdj.data.movements.every((m) => m.type === 'ADJUSTMENT'));

    // ---------- Activity log ----------
    const log = await api('GET', '/audit-log?limit=200&action=batch.adjusted', { cookie: O });
    check('The activity log records the old and new count',
      (log.data?.entries ?? []).some((e) => e.details?.code === ingBatch.code
        && e.details?.from === 12 && e.details?.to === 11), JSON.stringify(log.data?.entries?.[0]));

    // ---------- Editing a low-stock level ----------
    const high = await api('PATCH', `/items/${ingId}`, { cookie: K, body: { minLevel: 15 } });
    check('Kitchen can raise an ingredient\'s low-stock level, and it now shows as low',
      high.status === 200 && high.data?.item?.minLevel === 15 && high.data?.item?.status === 'low',
      `${high.status} ${JSON.stringify(high.data?.item)}`);
    check('A decimal low-stock level is fine for an ingredient (2.5)',
      (await api('PATCH', `/items/${ingId}`, { cookie: K, body: { minLevel: 2.5 } })).status === 200);
    check('A decimal low-stock level is refused for a dish (400)',
      (await api('PATCH', `/items/${dishId}`, { cookie: K, body: { minLevel: 2.5 } })).status === 400);
    check('A negative low-stock level is refused (400)',
      (await api('PATCH', `/items/${ingId}`, { cookie: K, body: { minLevel: -1 } })).status === 400);
    check('Cashiers cannot edit items (403)',
      (await api('PATCH', `/items/${ingId}`, { cookie: C, body: { minLevel: 1 } })).status === 403);
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