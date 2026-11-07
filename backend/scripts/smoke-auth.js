import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { query, pool } from '../src/config/db.js';
import { security } from '../src/config/security.js';

const BASE = process.env.API_URL || 'http://localhost:3000/api';
const ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `   (${extra})`}`);
}

async function api(method, path, { body, cookie, origin = ORIGIN } = {}) {
  const headers = { 'Content-Type': 'application/json', Origin: origin };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.getSetCookie();
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  const session = setCookie
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith(`${security.cookieName}=`));
  return { status: res.status, data, setCookie, cookie: session };
}

async function ensureUser(username, role, password) {
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

function summary() {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
}

async function limiterTest() {
  let first429 = null;
  for (let i = 1; i <= 30; i += 1) {
    const r = await api('POST', '/auth/login', {
      body: { username: `nobody_${i}`, password: 'wrong-password' },
    });
    if (r.status === 429) {
      first429 = i;
      break;
    }
  }
  check('Login rate limit blocks a device after about 20 failed attempts', first429 !== null,
    'no 429 after 30 attempts');
  console.log('Restart the backend now. The limiter blocks this device for 15 minutes.');
  summary();
}

async function main() {
  try {
    await api('GET', '/health');
  } catch {
    console.error(`Cannot reach the API at ${BASE}. Start it first: npm run dev (in another terminal).`);
    process.exitCode = 1;
    return;
  }

  if (process.argv.includes('--limiter')) {
    await limiterTest();
    return;
  }

  const cashierPw = crypto.randomBytes(12).toString('hex');
  const ownerPw = crypto.randomBytes(12).toString('hex');
  await ensureUser('smoke_cashier', 'cashier', cashierPw);
  await ensureUser('smoke_owner', 'owner', ownerPw);

  try {
    // --- Not logged in ---
    check('Not logged in: /auth/me is refused (401)', (await api('GET', '/auth/me')).status === 401);
    check('Not logged in: /audit-log is refused (401)', (await api('GET', '/audit-log')).status === 401);

    // --- Wrong credentials look the same ---
    const wrongPw = await api('POST', '/auth/login', {
      body: { username: 'smoke_owner', password: 'definitely-wrong' },
    });
    const wrongUser = await api('POST', '/auth/login', {
      body: { username: 'nobody_here', password: 'definitely-wrong' },
    });
    check('Wrong password gives 401', wrongPw.status === 401, `got ${wrongPw.status}`);
    check('Unknown user gives the same 401 and the same message',
      wrongUser.status === 401 && wrongUser.data?.error === wrongPw.data?.error,
      `${wrongUser.status} ${wrongUser.data?.error}`);

    // --- Login ---
    const cashier = await api('POST', '/auth/login', {
      body: { username: 'smoke_cashier', password: cashierPw },
    });
    check('Cashier login works (200) and returns the role',
      cashier.status === 200 && cashier.data?.user?.role === 'cashier', `got ${cashier.status}`);
    check('The login response contains no password or hash',
      !JSON.stringify(cashier.data).includes('password'));
    const flags = cashier.setCookie[0] ?? '';
    check('Session cookie is HttpOnly and SameSite=Lax',
      flags.includes('HttpOnly') && flags.includes('SameSite=Lax'), flags);

    const me = await api('GET', '/auth/me', { cookie: cashier.cookie });
    check('/auth/me returns the logged-in user',
      me.status === 200 && me.data?.user?.username === 'smoke_cashier', `got ${me.status}`);

    // --- Roles ---
    const denied = await api('GET', '/audit-log', { cookie: cashier.cookie });
    check('Cashier cannot read the activity log (403)', denied.status === 403, `got ${denied.status}`);

    const owner = await api('POST', '/auth/login', {
      body: { username: 'smoke_owner', password: ownerPw },
    });
    check('Owner login works', owner.status === 200 && owner.data?.user?.role === 'owner',
      `got ${owner.status}`);
    const log = await api('GET', '/audit-log?limit=5', { cookie: owner.cookie });
    check('Owner can read the activity log (200)',
      log.status === 200 && Array.isArray(log.data?.entries), `got ${log.status}`);

    // --- Lockout ---
    const wrong = { username: 'smoke_cashier', password: 'definitely-wrong' };
    const codes = [];
    for (let i = 0; i < security.maxFailedLogins; i += 1) {
      codes.push((await api('POST', '/auth/login', { body: wrong })).status);
    }
    check(`First ${security.maxFailedLogins - 1} wrong passwords give 401, the last one locks the account (429)`,
      codes.slice(0, -1).every((c) => c === 401) && codes.at(-1) === 429, `got ${codes.join(', ')}`);

    const whileLocked = await api('POST', '/auth/login', {
      body: { username: 'smoke_cashier', password: cashierPw },
    });
    check('Even the correct password is refused while locked (429)', whileLocked.status === 429,
      `got ${whileLocked.status}`);

    await query(
      `UPDATE users SET locked_until = now() - interval '1 minute' WHERE lower(username) = 'smoke_cashier'`
    );
    const afterLock = await api('POST', '/auth/login', {
      body: { username: 'smoke_cashier', password: cashierPw },
    });
    check('Login works again after the lock expires (200)', afterLock.status === 200,
      `got ${afterLock.status}`);
    const row = await query(
      'SELECT failed_logins, locked_until FROM users WHERE lower(username) = $1', ['smoke_cashier']);
    check('The failed-login counter is back to 0',
      row.rows[0].failed_logins === 0 && row.rows[0].locked_until === null);

    // --- Activity log ---
    const full = await api('GET', '/audit-log?limit=200', { cookie: owner.cookie });
    const entries = full.data?.entries ?? [];
    const has = (action, username) =>
      entries.some((e) => e.action === action && e.username === username);
    check('Log has: login.success', has('login.success', 'smoke_owner'));
    check('Log has: login.failed', has('login.failed', 'smoke_cashier'));
    check('Log has: account.locked', has('account.locked', 'smoke_cashier'));
    check('Log has: access.denied', has('access.denied', 'smoke_cashier'));
    const text = JSON.stringify(entries);
    check('The log contains no passwords', !text.includes(cashierPw) && !text.includes(ownerPw)
      && !text.includes('password_hash'));

    // --- Other websites and logout ---
    const evil = await api('POST', '/auth/login', {
      body: { username: 'smoke_owner', password: ownerPw },
      origin: 'http://evil.example',
    });
    check('A write request from another website is refused (403)', evil.status === 403,
      `got ${evil.status}`);

    const out = await api('POST', '/auth/logout', { cookie: owner.cookie });
    check('Logout clears the cookie',
      out.status === 200 && out.setCookie.some((c) => c.startsWith(`${security.cookieName}=;`)),
      out.setCookie.join(' | '));
  } finally {
    await query(
      `UPDATE users SET is_active = FALSE, locked_until = NULL
        WHERE lower(username) IN ('smoke_cashier', 'smoke_owner')`
    );
    await pool.end();
  }

  summary();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});