import pg from 'pg';
import { env } from './env.js';

const { Pool, types } = pg;

// By default pg returns NUMERIC and BIGINT as text, and DATE as a JavaScript Date
// that shifts with the time zone. Return real numbers and 'YYYY-MM-DD' strings instead.
types.setTypeParser(1700, (v) => parseFloat(v)); // NUMERIC
types.setTypeParser(20, (v) => parseInt(v, 10)); // BIGINT (COUNT, movement ids)
types.setTypeParser(1082, (v) => v); // DATE

export const pool = new Pool({
  ...env.db,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => console.error('Unexpected database error:', err.message));

// Always pass user input as parameters ($1, $2, ...), never inside the SQL text.
export const query = (text, params) => pool.query(text, params);

// Runs several statements as one all-or-nothing transaction.
export async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // the connection is already gone; nothing to undo
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function checkDatabase() {
  const { rows } = await pool.query(
    `SELECT current_user AS db_user,
            current_database() AS db_name,
            current_setting('TimeZone') AS timezone,
            now() AS server_time`
  );
  return rows[0];
}