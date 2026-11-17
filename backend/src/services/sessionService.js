import { pool, withTransaction } from '../config/db.js';
import { badRequest, conflict, notFound } from '../utils/httpError.js';
import { number } from '../utils/validate.js';
import { toCents, fromCents } from '../utils/money.js';
import { todaySG } from '../utils/dates.js';

function map(r) {
  const closed = r.closed_at !== null;
  return {
    id: r.session_id,
    cashierId: r.cashier_id,
    cashier: r.cashier,
    openedAt: r.opened_at,
    closedAt: r.closed_at,
    isOpen: !closed,
    openedToday: r.opened_date === todaySG(),
    openingCash: r.opening_cash,
    orders: r.orders,
    netSales: r.net_sales,
    cashSales: r.cash_sales,
    paynowSales: r.paynow_sales,
    cardSales: r.card_sales,
    // an open session is worked out live; a closed one keeps what was recorded when it closed
    expectedCash: closed ? r.expected_cash : r.expected_now,
    countedCash: r.counted_cash,
    cashDifference: r.cash_difference,
    closeNote: r.close_note,
  };
}

export async function getCurrentSession(user) {
  const { rows } = await pool.query(
    'SELECT * FROM v_session_summary WHERE cashier_id = $1 AND closed_at IS NULL',
    [user.id]
  );
  return rows[0] ? map(rows[0]) : null;
}

export async function openSession(user, body) {
  const openingCash = number(body?.openingCash, 'Opening cash', { min: 0, max: 100000, decimals: 2 });
  let id;
  try {
    const inserted = await pool.query(
      'INSERT INTO cashier_sessions (cashier_id, opening_cash) VALUES ($1, $2) RETURNING id',
      [user.id, openingCash]
    );
    id = inserted.rows[0].id;
  } catch (err) {
    if (err.code === '23505') {
      throw conflict('You already have an open session. Close it before starting a new one.');
    }
    throw err;
  }
  const { rows } = await pool.query('SELECT * FROM v_session_summary WHERE session_id = $1', [id]);
  return map(rows[0]);
}

export async function closeSession(user, body) {
  const counted = number(body?.countedCash, 'Counted cash', { min: 0, max: 1000000, decimals: 2 });
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 200) : '';

  return withTransaction(async (db) => {
    // Waits for any order that is still being saved into this session
    const locked = await db.query(
      'SELECT id FROM cashier_sessions WHERE cashier_id = $1 AND closed_at IS NULL FOR UPDATE',
      [user.id]
    );
    const sessionId = locked.rows[0]?.id;
    if (!sessionId) throw notFound('You have no open session to close.');

    const { rows } = await db.query('SELECT * FROM v_session_summary WHERE session_id = $1', [sessionId]);
    const expectedCents = toCents(rows[0].expected_now);
    const diffCents = toCents(counted) - expectedCents;
    if (diffCents !== 0 && !note) {
      throw badRequest('The count is different from the expected cash. Add a note to explain the difference.');
    }

    await db.query(
      `UPDATE cashier_sessions
          SET closed_at = now(), expected_cash = $2, counted_cash = $3,
              cash_difference = $4, close_note = $5
        WHERE id = $1`,
      [sessionId, fromCents(expectedCents), counted, fromCents(diffCents), note || null]
    );
    const after = await db.query('SELECT * FROM v_session_summary WHERE session_id = $1', [sessionId]);
    return map(after.rows[0]);
  });
}

// Owner: the sessions opened on a day, plus any session that is still open
export async function listSessions({ date }) {
  const { rows } = await pool.query(
    `SELECT * FROM v_session_summary
      WHERE opened_date = $1::date OR closed_at IS NULL
      ORDER BY opened_at DESC
      LIMIT 200`,
    [date]
  );
  return rows.map(map);
}