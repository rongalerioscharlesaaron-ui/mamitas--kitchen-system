import bcrypt from 'bcryptjs';
import { query, pool } from '../src/config/db.js';
import { security } from '../src/config/security.js';
import { audit } from '../src/utils/audit.js';

const ROLES = ['cashier', 'kitchen', 'owner'];

function ask(prompt, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            if (!hidden) stdout.write('\b \b');
          }
          continue;
        }
        if (ch < ' ') continue;
        value += ch;
        if (!hidden) stdout.write(ch);
      }
    };
    stdin.on('data', onData);
  });
}

function checkPassword(password, username) {
  if (password.length < security.minPasswordLength) {
    return `Use at least ${security.minPasswordLength} characters.`;
  }
  if (Buffer.byteLength(password) > security.maxPasswordBytes) {
    return `Use at most ${security.maxPasswordBytes} bytes.`;
  }
  if (password.toLowerCase() === username.toLowerCase()) {
    return 'The password cannot be the same as the username.';
  }
  return null;
}

async function main() {
  if (!process.stdin.isTTY) {
    console.error('Run this in a terminal (for example the VS Code terminal).');
    process.exit(1);
  }

  const username = (await ask('Username: ')).trim();
  if (!/^[A-Za-z0-9._-]{3,50}$/.test(username)) {
    throw new Error('Username must be 3 to 50 letters, numbers, dots, dashes, or underscores.');
  }

  const found = await query(
    'SELECT id, full_name, role FROM users WHERE lower(username) = lower($1)',
    [username]
  );
  const existing = found.rows[0];

  let fullName;
  let role;
  if (existing) {
    console.log(`"${username}" already exists (${existing.full_name}, ${existing.role}).`);
    const yes = (await ask('Reset its password? (yes/no): ')).trim().toLowerCase();
    if (yes !== 'yes') {
      console.log('Nothing changed.');
      return;
    }
  } else {
    fullName = (await ask('Full name: ')).trim();
    if (!fullName || fullName.length > 100) throw new Error('Enter a full name (up to 100 characters).');
    role = (await ask(`Role (${ROLES.join(', ')}): `)).trim().toLowerCase();
    if (!ROLES.includes(role)) throw new Error(`Role must be one of: ${ROLES.join(', ')}.`);
  }

  const password = await ask('Password: ', { hidden: true });
  const problem = checkPassword(password, username);
  if (problem) throw new Error(problem);
  const again = await ask('Repeat password: ', { hidden: true });
  if (again !== password) throw new Error('The two passwords do not match.');

  const hash = await bcrypt.hash(password, security.bcryptCost);

  if (existing) {
    await query(
      'UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL WHERE id = $1',
      [existing.id, hash]
    );
    await audit({
      username: 'script', action: 'user.password_reset', entity: 'user', entityId: existing.id,
      details: { username },
    });
    console.log(`Password reset for "${username}". Any lockout was cleared.`);
  } else {
    const result = await query(
      'INSERT INTO users (username, password_hash, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id',
      [username, hash, fullName, role]
    );
    await audit({
      username: 'script', action: 'user.created', entity: 'user', entityId: result.rows[0].id,
      details: { username, role },
    });
    console.log(`User "${username}" created as ${role}.`);
  }
}

main()
  .catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());