import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import bcrypt from 'bcryptjs';
import { query, withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import { security } from '../config/security.js';
import { shop as defaultShop } from '../config/shop.js';
import { badRequest, conflict, notFound } from '../utils/httpError.js';
import { text, number, oneOf, bool, parseId } from '../utils/validate.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.resolve(__dirname, '../../../database/backups');

const ROLES = ['cashier', 'kitchen', 'owner'];

function mapUser(r) {
  return {
    id: r.id,
    username: r.username,
    fullName: r.full_name,
    role: r.role,
    isActive: r.is_active,
    mustChangePassword: Boolean(r.must_change_password),
    isLocked: Boolean(r.locked_until && new Date(r.locked_until) > new Date()),
    lockedUntil: r.locked_until,
    lastLogin: r.last_login_at,
    createdAt: r.created_at,
  };
}

export async function listUsers() {
  const { rows } = await query(
    `SELECT id, username, full_name, role, is_active, must_change_password,
            locked_until, last_login_at, created_at
       FROM users
      WHERE deleted_at IS NULL
      ORDER BY id ASC`
  );
  return rows.map(mapUser);
}

export async function createUser(body) {
  const fullName = text(body?.fullName, 'Full name', { min: 2, max: 100 });
  const username = text(body?.username, 'Username', { min: 3, max: 50 }).toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(username)) {
    throw badRequest('Username can only contain letters, numbers, dots, underscores, or hyphens.');
  }
  const role = oneOf(body?.role, 'Role', ROLES);
  const password = text(body?.password, 'Temporary password', { min: 6, max: 100 });
  if (Buffer.byteLength(password) > security.maxPasswordBytes) {
    throw badRequest(`Password must be at most ${security.maxPasswordBytes} bytes.`);
  }

  const passwordHash = await bcrypt.hash(password, security.bcryptCost);
  try {
    const { rows } = await query(
      `INSERT INTO users (username, password_hash, full_name, role, must_change_password)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING id, username, full_name, role, is_active, must_change_password,
                 locked_until, last_login_at, created_at`,
      [username, passwordHash, fullName, role]
    );
    return mapUser(rows[0]);
  } catch (err) {
    if (err.code === '23505') throw conflict('That username is already taken.');
    throw err;
  }
}

export async function updateUser(id, actorId, body) {
  return withTransaction(async (db) => {
    const { rows: existing } = await db.query(
      'SELECT id, username, full_name, role, is_active FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
      [id]
    );
    const current = existing[0];
    if (!current) throw notFound('User not found.');

    const updates = [];
    const params = [];
    const push = (col, val) => {
      params.push(val);
      updates.push(`${col} = $${params.length}`);
    };

    const nextRole = body?.role !== undefined ? oneOf(body.role, 'Role', ROLES) : current.role;
    const nextActive = body?.isActive !== undefined ? bool(body.isActive, 'Active status') : current.is_active;

    if (id === actorId && nextRole !== 'owner') {
      throw badRequest('You cannot remove your own owner role.');
    }
    if (id === actorId && !nextActive) {
      throw badRequest('You cannot deactivate your own account.');
    }

    // Ensure at least one active owner remains in the system
    const losingOwner = current.role === 'owner' && current.is_active && (nextRole !== 'owner' || !nextActive);
    if (losingOwner) {
      const { rows: owners } = await db.query(
        "SELECT COUNT(*)::int AS cnt FROM users WHERE role = 'owner' AND is_active = TRUE AND deleted_at IS NULL AND id <> $1",
        [id]
      );
      if (owners[0].cnt < 1) {
        throw badRequest('The system must always keep at least one active owner.');
      }
    }

    if (body?.fullName !== undefined) {
      push('full_name', text(body.fullName, 'Full name', { min: 2, max: 100 }));
    }
    if (body?.role !== undefined) {
      push('role', nextRole);
    }
    if (body?.isActive !== undefined) {
      push('is_active', nextActive);
      if (nextActive) {
        updates.push('failed_logins = 0', 'locked_until = NULL');
      }
    }
    if (body?.password !== undefined && body.password !== '') {
      const password = text(body.password, 'Temporary password', { min: 6, max: 100 });
      if (Buffer.byteLength(password) > security.maxPasswordBytes) {
        throw badRequest(`Password must be at most ${security.maxPasswordBytes} bytes.`);
      }
      const passwordHash = await bcrypt.hash(password, security.bcryptCost);
      push('password_hash', passwordHash);
      updates.push(
        'must_change_password = TRUE',
        'session_version = session_version + 1',
        'failed_logins = 0',
        'locked_until = NULL'
      );
    }

    if (updates.length === 0) throw badRequest('No changes provided.');

    params.push(id);
    const { rows } = await db.query(
      `UPDATE users
          SET ${updates.join(', ')}
        WHERE id = $${params.length}
        RETURNING id, username, full_name, role, is_active, must_change_password,
                  locked_until, last_login_at, created_at`,
      params
    );
    return mapUser(rows[0]);
  });
}

export async function unlockUser(id) {
  const { rows } = await query(
    `UPDATE users
        SET failed_logins = 0, locked_until = NULL
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id, username, full_name, role, is_active, must_change_password,
                locked_until, last_login_at, created_at`,
    [id]
  );
  if (!rows[0]) throw notFound('User not found.');
  return mapUser(rows[0]);
}

export async function signOutEverywhere(id) {
  const { rows } = await query(
    `UPDATE users
        SET session_version = session_version + 1
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id, username, full_name, role, is_active, must_change_password,
                locked_until, last_login_at, created_at`,
    [id]
  );
  if (!rows[0]) throw notFound('User not found.');
  return mapUser(rows[0]);
}

// Deleting a user is a soft delete: the row stays, because orders, cash sessions, stock movements and
// the activity log all point at it (and the app is never allowed to DELETE rows). The user disappears
// from the list, can no longer sign in, and the username becomes free to use again.
export async function deleteUser(rawId, actorId) {
  const id = parseId(rawId, 'user id');
  if (id === actorId) throw badRequest('You cannot delete your own account.');

  return withTransaction(async (db) => {
    const { rows } = await db.query(
      `SELECT id, username, full_name, role, is_active
         FROM users
        WHERE id = $1 AND deleted_at IS NULL
          FOR UPDATE`,
      [id]
    );
    const current = rows[0];
    if (!current) throw notFound('User not found.');

    // The system must always keep one active owner who can sign in
    if (current.role === 'owner' && current.is_active) {
      const { rows: owners } = await db.query(
        `SELECT COUNT(*)::int AS cnt FROM users
          WHERE role = 'owner' AND is_active = TRUE AND deleted_at IS NULL AND id <> $1`,
        [id]
      );
      if (owners[0].cnt < 1) throw badRequest('The system must always keep at least one active owner.');
    }

    // A cash drawer that is still open must be closed (and counted) first
    const { rows: open } = await db.query(
      'SELECT 1 FROM cashier_sessions WHERE cashier_id = $1 AND closed_at IS NULL',
      [id]
    );
    if (open[0]) {
      throw conflict(`${current.full_name} still has an open cash session. Close it before deleting this account.`);
    }

    // is_active = FALSE and a new session_version end every signed-in session and block sign-in
    await db.query(
      `UPDATE users
          SET deleted_at = now(),
              is_active = FALSE,
              session_version = session_version + 1,
              failed_logins = 0,
              locked_until = NULL
        WHERE id = $1`,
      [id]
    );
    return { id: current.id, username: current.username, fullName: current.full_name, role: current.role };
  });
}

// Menu management (owner): a disabled food or food tray is hidden from the POS and cannot be sold or
// cooked. Its stock and history stay as they are. Answers { changed: false } if it was already so.
export async function setMenuItemEnabled(rawId, body) {
  const id = parseId(rawId, 'item id');
  const enabled = bool(body?.enabled, 'Enabled');

  return withTransaction(async (db) => {
    const { rows } = await db.query(
      `SELECT id, name, item_type, is_enabled
         FROM items
        WHERE id = $1 AND is_active
          FOR UPDATE`,
      [id]
    );
    const item = rows[0];
    if (!item) throw notFound('Menu item not found.');
    if (item.item_type === 'ingredient') throw badRequest('Only menu items can be enabled or disabled.');

    const stock = await db.query(
      'SELECT qty_usable, unit FROM v_item_stock WHERE item_id = $1',
      [id]
    );
    const result = {
      id: item.id,
      name: item.name,
      type: item.item_type,
      isEnabled: enabled,
      qtyUsable: stock.rows[0]?.qty_usable ?? 0,
      unit: stock.rows[0]?.unit ?? '',
      changed: item.is_enabled !== enabled,
    };
    if (result.changed) await db.query('UPDATE items SET is_enabled = $2 WHERE id = $1', [id, enabled]);
    return result;
  });
}

export async function updateShopSettings(body) {
  const name = text(body?.name ?? defaultShop.name, 'Business name', { min: 2, max: 100 });
  const location = text(body?.location ?? defaultShop.location, 'Location', { min: 2, max: 100 });
  const currency = text(body?.currency ?? defaultShop.currency, 'Currency', { min: 3, max: 5 }).toUpperCase();
  const gstRegistered = bool(Boolean(body?.gstRegistered), 'GST registered');
  const gstRate = number(body?.gstRate ?? defaultShop.gstRate, 'GST rate', { min: 0, max: 0.5, decimals: 4 });
  const gstRegNo = typeof body?.gstRegNo === 'string' ? body.gstRegNo.trim().slice(0, 40) : '';
  const expiryWarningDays = number(body?.expiryWarningDays ?? 3, 'Expiry warning days', {
    min: 1,
    max: 30,
    integer: true,
    decimals: 0,
  });

  const { rows } = await query(
    `INSERT INTO shop_settings (id, name, location, currency, gst_registered, gst_rate, gst_reg_no, expiry_warning_days, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       location = EXCLUDED.location,
       currency = EXCLUDED.currency,
       gst_registered = EXCLUDED.gst_registered,
       gst_rate = EXCLUDED.gst_rate,
       gst_reg_no = EXCLUDED.gst_reg_no,
       expiry_warning_days = EXCLUDED.expiry_warning_days,
       updated_at = now()
     RETURNING name, location, currency, gst_registered, gst_rate, gst_reg_no, expiry_warning_days`,
    [name, location, currency, gstRegistered, gstRate, gstRegNo, expiryWarningDays]
  );

  const r = rows[0];
  return {
    name: r.name,
    location: r.location,
    currency: r.currency,
    gstRegistered: r.gst_registered,
    gstRate: r.gst_rate,
    gstRegNo: r.gst_reg_no,
    expiryWarningDays: r.expiry_warning_days,
  };
}

function fmtBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function resolvePgDump() {
  if (process.env.PG_DUMP_PATH) return process.env.PG_DUMP_PATH;
  if (process.platform === 'win32') {
    for (const ver of ['18', '17', '16', '15']) {
      const candidate = `C:\\Program Files\\PostgreSQL\\${ver}\\bin\\pg_dump.exe`;
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // try next version
      }
    }
  }
  return 'pg_dump';
}

export async function listBackups() {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const entries = await fs.readdir(BACKUP_DIR, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile() && /\.(dump|sql)$/i.test(e.name));

  const list = await Promise.all(
    files.map(async (f) => {
      const stat = await fs.stat(path.join(BACKUP_DIR, f.name));
      return {
        id: f.name,
        filename: f.name,
        size: fmtBytes(stat.size),
        createdAt: stat.mtime.toISOString(),
        status: 'Verified',
      };
    })
  );

  return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function createBackup() {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const filename = `mamitas_backup_${stamp}.dump`;
  const fullPath = path.join(BACKUP_DIR, filename);
  const pgDumpBin = await resolvePgDump();

  try {
    await execFileAsync(
      pgDumpBin,
      [
        '-Fc',
        '-h', String(env.db.host),
        '-p', String(env.db.port),
        '-U', String(env.db.user),
        '-d', String(env.db.database),
        '-f', fullPath,
      ],
      { env: { ...process.env, PGPASSWORD: String(env.db.password || '') } }
    );
  } catch (err) {
    throw badRequest(
      err.code === 'ENOENT'
        ? 'pg_dump was not found in PATH. Add PostgreSQL bin folder to system PATH to enable live backups.'
        : `Backup failed: ${err.message}`
    );
  }

  const stat = await fs.stat(fullPath);
  return {
    id: filename,
    filename,
    size: fmtBytes(stat.size),
    createdAt: stat.mtime.toISOString(),
    status: 'Verified',
  };
}

export async function getBackupPath(filename) {
  if (typeof filename !== 'string' || !/^[a-zA-Z0-9._-]+\.(dump|sql)$/i.test(filename)) {
    throw badRequest('Invalid backup filename.');
  }
  const fullPath = path.resolve(BACKUP_DIR, filename);
  if (!fullPath.startsWith(BACKUP_DIR + path.sep)) {
    throw badRequest('Invalid backup path.');
  }
  try {
    await fs.access(fullPath);
  } catch {
    throw notFound('Backup file not found.');
  }
  return fullPath;
}