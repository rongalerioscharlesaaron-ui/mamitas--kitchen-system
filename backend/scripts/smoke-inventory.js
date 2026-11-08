import crypto from 'node:crypto';
import {
  api, check, summary, ensureUser, loginAs, query, pool, dayOffset,
} from './test-helpers.js';

const rand = () => crypto.randomBytes(12).toString('hex');
const suffix = crypto.randomBytes(3).toString('hex');
const names = {
  spice: `Smoke Spice ${suffix}`,
  salt: `Smoke Salt ${suffix}`,
  dish: `Smoke Dish ${suffix}`,
};

async function main() {
  try {
    await api('GET', '/health');
  } catch {
    console.error('Cannot reach the API. Start it first: npm run dev (in another terminal).');
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

    // ---------- Who can do what ----------
    check('Not logged in: /items is refused (401)', (await api('GET', '/items')).status === 401);
    check('Cashier cannot list inventory items (403)',
      (await api('GET', '/items', { cookie: C })).status === 403);
    check('Cashier cannot read stock movements (403)',
      (await api('GET', '/movements', { cookie: C })).status === 403);
    check('Cashier cannot add stock (403)',
      (await api('POST', '/items/1/batches', { cookie: C, body: { qty: 1 } })).status === 403);

    const menu = await api('GET', '/menu', { cookie: C });
    check('Cashier can read the menu: foods and trays only, with prices',
      menu.status === 200 && menu.data.items.length >= 8
        && menu.data.items.every((i) => i.type !== 'ingredient' && i.price > 0),
      `status ${menu.status}`);

    const items = await api('GET', '/items', { cookie: K });
    check('Kitchen can list items (at least 16)',
      items.status === 200 && items.data.items.length >= 16, `status ${items.status}`);
    const trays = await api('GET', '/items?type=food_tray', { cookie: K });
    check('Filtering by type works',
      trays.status === 200 && trays.data.items.length >= 3
        && trays.data.items.every((i) => i.type === 'food_tray'));
    const cats = await api('GET', '/categories', { cookie: C });
    check('Categories include Meat',
      cats.status === 200 && cats.data.categories.some((c) => c.name === 'Meat'));

    // ---------- Creating items ----------
    const spiceBody = {
      type: 'ingredient', name: names.spice, category: 'Wet ingredients',
      unit: 'L', minLevel: 1, hasExpiry: true,
    };
    const noStock = await api('POST', '/items', { cookie: K, body: spiceBody });
    check('Perishable ingredient without quantity and expiry is refused (400)',
      noStock.status === 400, `got ${noStock.status}`);

    const spice = await api('POST', '/items', {
      cookie: K, body: { ...spiceBody, qty: 5, expiry: dayOffset(30) },
    });
    check('Perishable ingredient is created with its first batch (201)',
      spice.status === 201 && /^B-\d{4}$/.test(spice.data?.batch?.code ?? ''),
      `got ${spice.status} ${JSON.stringify(spice.data)}`);
    const spiceId = spice.data?.item?.id;
    const firstBatch = spice.data?.batch;

    const dup = await api('POST', '/items', {
      cookie: K, body: { ...spiceBody, name: names.spice.toLowerCase(), qty: 1, expiry: dayOffset(5) },
    });
    check('A duplicate name is refused (409)', dup.status === 409, `got ${dup.status}`);

    const wrongCat = await api('POST', '/items', {
      cookie: K,
      body: { type: 'food', name: `${names.dish} bad`, category: 'Meat', price: 5, minLevel: 1 },
    });
    check('A food in the Meat category is refused (400)', wrongCat.status === 400,
      `got ${wrongCat.status}`);

    const dish = await api('POST', '/items', {
      cookie: K,
      body: { type: 'food', name: names.dish, category: 'Sides', price: 4.5, minLevel: 5, qty: 10 },
    });
    check('A food is created with 10 servings (201)',
      dish.status === 201 && dish.data?.item?.qtyUsable === 10, `got ${dish.status}`);
    const dishId = dish.data?.item?.id;
    const dishBatch = dish.data?.batch;

    const fractional = await api('POST', '/items', {
      cookie: K,
      body: { type: 'food', name: `${names.dish} frac`, category: 'Sides', price: 4, minLevel: 1, qty: 2.5 },
    });
    check('2.5 servings is refused: whole numbers only (400)', fractional.status === 400,
      `got ${fractional.status}`);

    const salt = await api('POST', '/items', {
      cookie: K,
      body: {
        type: 'ingredient', name: names.salt, category: 'Dry ingredients',
        unit: 'kg', minLevel: 1, hasExpiry: false, qty: 2,
      },
    });
    check('An ingredient without expiry is created (201)', salt.status === 201, `got ${salt.status}`);
    const saltId = salt.data?.item?.id;

    // ---------- Batches ----------
    const saltIn = await api('POST', `/items/${saltId}/batches`, { cookie: K, body: { qty: 1 } });
    check('Stock in for an ingredient without expiry works (201)', saltIn.status === 201,
      `got ${saltIn.status}`);
    const saltExp = await api('POST', `/items/${saltId}/batches`, {
      cookie: K, body: { qty: 1, expiry: dayOffset(10) },
    });
    check('A batch with an expiry date is refused for a non-expiring ingredient (400)',
      saltExp.status === 400, `got ${saltExp.status}`);

    const noExpiry = await api('POST', `/items/${spiceId}/batches`, { cookie: K, body: { qty: 3 } });
    check('A perishable batch without an expiry date is refused (400)', noExpiry.status === 400,
      `got ${noExpiry.status}`);
    const pastExpiry = await api('POST', `/items/${spiceId}/batches`, {
      cookie: K, body: { qty: 3, expiry: dayOffset(-1) },
    });
    check('An expiry date in the past is refused (400)', pastExpiry.status === 400,
      `got ${pastExpiry.status}`);

    const second = await api('POST', `/items/${spiceId}/batches`, {
      cookie: K, body: { qty: 3, expiry: dayOffset(10) },
    });
    check('Every delivery gets its own batch ID',
      second.status === 201 && /^B-\d{4}$/.test(second.data?.batch?.code ?? '')
        && second.data.batch.code !== firstBatch?.code,
      `${firstBatch?.code} vs ${second.data?.batch?.code}`);

    const list = await api('GET', `/batches?itemId=${spiceId}&inStock=true`, { cookie: K });
    check('Both batches of the item are listed, with expiry status "ok"',
      list.status === 200 && list.data.batches.length === 2
        && list.data.batches.every((b) => b.expiryStatus === 'ok'),
      JSON.stringify(list.data));

    // ---------- Damaged or spoiled goods, per batch ----------
    const tooMuch = await api('POST', `/batches/${firstBatch.id}/loss`, {
      cookie: K, body: { type: 'DAMAGED', qty: 99, reason: 'Dropped' },
    });
    check('Recording more than the batch holds is refused (400)', tooMuch.status === 400,
      `got ${tooMuch.status}`);

    const loss = await api('POST', `/batches/${firstBatch.id}/loss`, {
      cookie: K, body: { type: 'DAMAGED', qty: 1, reason: 'Dropped' },
    });
    check('Damage is recorded against that batch (5 becomes 4)',
      loss.status === 200 && loss.data?.result?.remaining === 4, `got ${loss.status}`);

    const fracLoss = await api('POST', `/batches/${dishBatch.id}/loss`, {
      cookie: K, body: { type: 'DAMAGED', qty: 0.5, reason: 'Dropped' },
    });
    check('Half a serving cannot be recorded (400)', fracLoss.status === 400,
      `got ${fracLoss.status}`);

    const dishLoss = await api('POST', `/batches/${dishBatch.id}/loss`, {
      cookie: K, body: { type: 'SPOILED', qty: 2, reason: 'Spoiled (smell)' },
    });
    check('Spoiled servings are recorded (10 becomes 8)',
      dishLoss.status === 200 && dishLoss.data?.result?.remaining === 8, `got ${dishLoss.status}`);

    // ---------- Write-off ----------
    const notExpired = await api('POST', `/batches/${second.data.batch.id}/write-off`, { cookie: K });
    check('A batch that has not expired cannot be written off (400)', notExpired.status === 400,
      `got ${notExpired.status}`);

    // make the second batch expired (a test-only shortcut straight in the database)
    await query(
      `UPDATE inventory_batches
          SET received_date = CURRENT_DATE - 5, expiry_date = CURRENT_DATE - 1
        WHERE id = $1`,
      [second.data.batch.id]
    );
    const writeOff = await api('POST', `/batches/${second.data.batch.id}/write-off`, { cookie: K });
    const afterWo = await api('GET', `/batches?itemId=${spiceId}`, { cookie: K });
    const woBatch = afterWo.data?.batches?.find((b) => b.id === second.data.batch.id);
    check('An expired batch is written off (stock 0, status expired)',
      writeOff.status === 200 && woBatch?.qtyRemaining === 0 && woBatch?.expiryStatus === 'expired',
      `got ${writeOff.status} ${JSON.stringify(woBatch)}`);

    // ---------- Movement history ----------
    const mv = await api('GET', `/movements?q=${encodeURIComponent(names.spice)}&limit=50`, { cookie: K });
    const moves = mv.data?.movements ?? [];
    const types = moves.map((m) => m.type);
    check('The log shows the new batches, the damage, and the expired write-off',
      ['IN', 'DAMAGED', 'SPOILED'].every((t) => types.includes(t)), types.join(','));
    check('Each movement says who recorded it',
      moves.length > 0 && moves.every((m) => m.recordedBy === 'Smoke test kitchen'));
    const inReasons = moves.filter((m) => m.type === 'IN').map((m) => m.reason);
    check('Reasons are "Initial stock" and "New batch"',
      inReasons.includes('Initial stock') && inReasons.includes('New batch'), inReasons.join(','));

    const lossOnly = await api('GET', '/movements?type=DAMAGED,SPOILED&limit=500', { cookie: K });
    check('The type filter returns only damaged and spoiled entries',
      lossOnly.status === 200 && lossOnly.data.movements.length > 0
        && lossOnly.data.movements.every((m) => m.type === 'DAMAGED' || m.type === 'SPOILED'));

    const saltLog = await api('GET', `/movements?q=${encodeURIComponent(names.salt)}`, { cookie: K });
    check('Stock in for a non-expiring ingredient is logged as "Stock in"',
      (saltLog.data?.movements ?? []).some((m) => m.type === 'IN' && m.reason === 'Stock in'));

    // ---------- Prices and roles ----------
    const kitchenPrice = await api('PATCH', `/items/${dishId}`, { cookie: K, body: { price: 5 } });
    check('Kitchen cannot change a price (403)', kitchenPrice.status === 403, `got ${kitchenPrice.status}`);

    const kitchenMin = await api('PATCH', `/items/${dishId}`, { cookie: K, body: { minLevel: 6 } });
    check('Kitchen can change the low-stock level', kitchenMin.status === 200, `got ${kitchenMin.status}`);

    const ownerPrice = await api('PATCH', `/items/${dishId}`, { cookie: O, body: { price: 5.25 } });
    const menuAfter = await api('GET', '/menu', { cookie: C });
    const seen = menuAfter.data?.items?.find((i) => i.id === dishId);
    check('Owner changes the price and the cashier sees it',
      ownerPrice.status === 200 && seen?.price === 5.25 && seen?.minLevel === 6,
      `got ${ownerPrice.status} ${JSON.stringify(seen)}`);

    const ingPrice = await api('PATCH', `/items/${spiceId}`, { cookie: O, body: { price: 3 } });
    check('An ingredient cannot be given a price (400)', ingPrice.status === 400, `got ${ingPrice.status}`);

    // ---------- Activity log ----------
    const log = await api('GET', '/audit-log?limit=200', { cookie: O });
    const actions = new Set((log.data?.entries ?? []).map((e) => e.action));
    const wanted = ['item.created', 'item.updated', 'batch.created', 'batch.loss', 'batch.write_off'];
    check('The activity log recorded item, batch, damage, and write-off actions',
      wanted.every((a) => actions.has(a)), `missing: ${wanted.filter((a) => !actions.has(a)).join(', ')}`);
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