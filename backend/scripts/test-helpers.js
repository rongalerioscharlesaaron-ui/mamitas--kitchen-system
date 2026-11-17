import bcrypt from 'bcryptjs';
import { query, pool } from '../src/config/db.js';
import { security } from '../src/config/security.js';

export { query, pool };

export const BASE = process.env.API_URL || 'http://localhost:3000/api';
const ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

let passed = 0;
let failed = 0;

export function check(name, ok, extra = '') {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `   (${extra})`}`);
}

export function summary() {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
}

export async function api(method, path, { body, cookie } = {}) {
  const headers = { 'Content-Type': 'application/json', Origin: ORIGIN };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  const session = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith(`${security.cookieName}=`));
  return { status: res.status, data, cookie: session };
}

export async function ensureUser(username, role, password) {
  const hash = await bcrypt.hash(password, 4);
  const found = await query('SELECT id FROM users WHERE lower(username) = $1', [username]);
  if (found.rows[0]) {
    await query(
      `UPDATE users SET password_hash = $2, role = $3, is_active = TRUE,
                        failed_logins = 0, locked_until = NULL WHERE id = $1`,
      [found.rows[0].id, hash, role]
    );
  } else {
    await query(
      'INSERT INTO users (username, password_hash, full_name, role) VALUES ($1, $2, $3, $4)',
      [username, hash, `Smoke test ${role}`, role]
    );
  }
}

export async function loginAs(username, password) {
  const r = await api('POST', '/auth/login', { body: { username, password } });
  if (r.status !== 200) {
    throw new Error(`Test login failed for ${username} (${r.status}): ${r.data?.error}`);
  }
  return r.cookie;
}

// A date N days from today, as YYYY-MM-DD in Singapore time
const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit',
});
export const dayOffset = (n) => dayFormat.format(new Date(Date.now() + n * 86400000));

// A cashier needs an open session before orders can be placed
export async function ensureOpenSession(cookie, openingCash = 100) {
  const current = await api('GET', '/sessions/current', { cookie });
  if (current.data?.session) return current.data.session;
  const opened = await api('POST', '/sessions/open', { cookie, body: { openingCash } });
  if (opened.status !== 201) {
    throw new Error(`Could not open a test session (${opened.status}): ${opened.data?.error}`);
  }
  return opened.data.session;
}