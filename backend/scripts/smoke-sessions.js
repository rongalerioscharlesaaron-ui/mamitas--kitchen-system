import crypto from 'node:crypto';
import { api, check, summary, ensureUser, loginAs, query, pool } from './test-helpers.js';

const rand = () => crypto.randomBytes(12).toString('hex');
const suffix = crypto.randomBytes(3).toString('hex');
const DISH = `Smoke Sess Dish ${suffix}`;

// Test-only shortcut: close any session a previous run left open
const closeAll = () =>
  query(
    `UPDATE cashier_sessions
        SET closed_at = now(), expected_cash = opening_cash, counted_cash = opening_cash, cash_difference = 0
      WHERE closed_at IS NULL
        AND cashier_id IN (SELECT id FROM users WHERE username IN ('smoke_cashier', 'smoke_owner'))`
  );

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
    await closeAll();
    const K = await loginAs('smoke_kitchen', pw.kitchen);
    const C = await loginAs('smoke_cashier', pw.cashier);
    const O = await loginAs('smoke_owner', pw.owner);

    const dish = await api('POST', '/items', {
      cookie: K,
      body: { type: 'food', name: DISH, category: 'Main dishes', price: 5, minLevel: 1, qty: 30 },
    });
    const dishId = dish.data.item.id;
    const place = (qty, payment, cookie = C) =>
      api('POST', '/orders', {
        cookie, body: { type: 'dine_in', lines: [{ itemId: dishId, qty }], payment },
      });
    const open = (openingCash, cookie = C) => api('POST', '/sessions/open', { cookie, body: { openingCash } });
    const close = (body, cookie = C) => api('POST', '/sessions/close', { cookie, body });

    // ---------- Who can use sessions ----------
    check('Not logged in: sessions are refused (401)', (await api('GET', '/sessions/current')).status === 401);
    check('Kitchen staff cannot use sessions (403)',
      (await api('GET', '/sessions/current', { cookie: K })).status === 403
        && (await open(10, K)).status === 403);

    // ---------- Orders need an open session ----------
    const none = await api('GET', '/sessions/current', { cookie: C });
    check('A cashier starts with no open session', none.status === 200 && none.data?.session === null,
      JSON.stringify(none.data));
    const blocked = await place(1, { method: 'card' });
    check('An order without an open session is refused (409)',
      blocked.status === 409 && /cash drawer/i.test(blocked.data?.error ?? ''),
      `${blocked.status} ${blocked.data?.error}`);

    check('Negative opening cash is refused (400)', (await open(-5)).status === 400);
    check('A non-number is refused (400)', (await open('abc')).status === 400);
    check('Opening cash with 3 decimals is refused (400)', (await open(10.123)).status === 400);
    check('A missing amount is refused (400)',
      (await api('POST', '/sessions/open', { cookie: C, body: {} })).status === 400);

    // ---------- Opening ----------
    const opened = await open(100);
    const s1 = opened.data?.session;
    check('Opening a session with 100.00 works (201) and stamps Time IN',
      opened.status === 201 && s1?.isOpen === true && s1?.openingCash === 100 && s1?.orders === 0
        && s1?.expectedCash === 100 && s1?.openedToday === true && Boolean(s1?.openedAt),
      `${opened.status} ${JSON.stringify(opened.data)}`);
    check('A second open session is refused (409)', (await open(50)).status === 409);
    const cur = await api('GET', '/sessions/current', { cookie: C });
    check('The current session is returned', cur.data?.session?.id === s1?.id);

    // ---------- Selling ----------
    const o1 = await place(2, { method: 'cash', tendered: 20 });
    const o2 = await place(1, { method: 'paynow' });
    const o3 = await place(1, { method: 'card' });
    check('Cash, PayNow, and card orders are placed (201 each)',
      [o1, o2, o3].every((o) => o.status === 201),
      [o1, o2, o3].map((o) => `${o.status} ${o.data?.error ?? ''}`).join(' | '));

    const cur2 = (await api('GET', '/sessions/current', { cookie: C })).data?.session;
    check('The session adds up: 3 orders, net sales 20.00 (cash 10, PayNow 5, card 5), cash in drawer 110.00',
      cur2?.orders === 3 && cur2?.netSales === 20 && cur2?.cashSales === 10 && cur2?.paynowSales === 5
        && cur2?.cardSales === 5 && cur2?.expectedCash === 110, JSON.stringify(cur2));

    const link = await query('SELECT session_id FROM orders WHERE order_number = $1', [o1.data.order.number]);
    check('The order is saved with its session', link.rows[0]?.session_id === s1?.id);

    let message = '';
    try {
      await query(
        `INSERT INTO orders (order_type, total, cashier_id)
         SELECT 'dine_in', 1, id FROM users WHERE username = 'smoke_cashier'`
      );
    } catch (err) {
      message = err.message;
    }
    check('The database itself refuses an order that has no session', /cash session/i.test(message), message);

    // ---------- Owner view ----------
    check('A cashier cannot list all sessions (403)',
      (await api('GET', '/sessions?date=today', { cookie: C })).status === 403);
    const list1 = await api('GET', '/sessions?date=today', { cookie: O });
    check('The owner sees the open session in today\'s list',
      list1.status === 200
        && list1.data.sessions.some((s) => s.id === s1?.id && s.isOpen && s.cashier === 'Smoke test cashier'),
      JSON.stringify(list1.data));

    // ---------- Closing ----------
    check('Closing without a counted amount is refused (400)', (await close({})).status === 400);
    check('A count that differs from the expected cash needs a note (400)',
      (await close({ countedCash: 100 })).status === 400);
    const closed = await close({ countedCash: 100, note: 'Gave change from the drawer' });
    const c1 = closed.data?.session;
    check('Closing with a note works: expected 110, counted 100, difference -10, with Time OUT',
      closed.status === 200 && c1?.isOpen === false && c1?.expectedCash === 110 && c1?.countedCash === 100
        && c1?.cashDifference === -10 && Boolean(c1?.closedAt), `${closed.status} ${JSON.stringify(closed.data)}`);
    check('After closing there is no current session',
      (await api('GET', '/sessions/current', { cookie: C })).data?.session === null);
    const late = await place(1, { method: 'card' });
    check('An order after closing is refused (409)', late.status === 409, `got ${late.status}`);

    // ---------- A second shift ----------
    const second = await open(50);
    check('A new session can be started (201) and is a different session',
      second.status === 201 && second.data?.session?.id !== s1?.id, `got ${second.status}`);
    const closed2 = await close({ countedCash: 50 });
    check('A balanced count needs no note (difference 0)',
      closed2.status === 200 && closed2.data?.session?.cashDifference === 0
        && closed2.data?.session?.expectedCash === 50, `${closed2.status} ${JSON.stringify(closed2.data)}`);

    const list2 = await api('GET', '/sessions?date=today', { cookie: O });
    const f1 = list2.data?.sessions?.find((s) => s.id === s1?.id);
    const f2 = list2.data?.sessions?.find((s) => s.id === second.data?.session?.id);
    check('The owner sees both closed sessions with their differences (-10 and 0)',
      f1?.cashDifference === -10 && f2?.cashDifference === 0 && f1?.isOpen === false, JSON.stringify([f1, f2]));

    const ownerOpen = await open(0, O);
    const ownerClose = await close({ countedCash: 0 }, O);
    check('The owner can run a session too', ownerOpen.status === 201 && ownerClose.status === 200,
      `${ownerOpen.status} ${ownerClose.status}`);

    // ---------- Activity log ----------
    const log = await api('GET', '/audit-log?limit=200&action=session.', { cookie: O });
    const actions = new Set((log.data?.entries ?? []).map((e) => e.action));
    check('The activity log recorded sessions opened and closed',
      actions.has('session.opened') && actions.has('session.closed'), [...actions].join(','));
  } finally {
    await closeAll();
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