import { useEffect, useState } from 'react';
import { Users, Settings, UtensilsCrossed, ShieldCheck, Database, Plus, RefreshCw, Download } from 'lucide-react';
import { api } from '../../api/client';
import { useInventory } from '../../context/InventoryContext';
import { SHOP } from '../../config/shop';
import { ROLE_LABELS } from '../../routes/navItems';
import StatusBadge from '../../components/StatusBadge';
import Modal from '../../components/Modal';
import AddMenuItemModal from '../../components/inventory/AddMenuItemModal';
import EditMenuItemModal from '../../components/inventory/EditMenuItemModal';
import { fmtDateTime } from '../../utils/dates';
import { formatMoney } from '../../utils/money';

const ADMIN_TABS = [
  { id: 'users', label: 'Users & Roles', icon: Users },
  { id: 'config', label: 'System Configuration', icon: Settings },
  { id: 'menu', label: 'Menu Management', icon: UtensilsCrossed },
  { id: 'audit', label: 'Audit Logs & Backups', icon: ShieldCheck },
];

const AUDIT_CATEGORIES = [
  { id: '', label: 'All categories' },
  { id: 'login', label: 'Sign-in & Security' },
  { id: 'account', label: 'Account & Passwords' },
  { id: 'access', label: 'Access Denied' },
  { id: 'admin', label: 'Administration' },
  { id: 'session', label: 'Cashier Sessions' },
  { id: 'order', label: 'Orders & POS' },
  { id: 'stock', label: 'Inventory & Stock' },
];

const FALLBACK_USERS = [
  { id: 1, username: 'owner', fullName: 'Owner', role: 'owner', isActive: true, mustChangePassword: false, isLocked: false },
  { id: 2, username: 'cashier', fullName: 'Cashier', role: 'cashier', isActive: true, mustChangePassword: false, isLocked: false },
  { id: 3, username: 'kitchen', fullName: 'Kitchen Staff', role: 'kitchen', isActive: true, mustChangePassword: false, isLocked: false },
];

function describeAudit(l) {
  const d = l.details || {};
  const target = l.entity ? `${l.entity}${l.entity_id ? ` #${l.entity_id}` : ''}` : '';
  switch (l.action) {
    case 'login.success':
      return 'Signed in successfully';
    case 'login.failed':
      return `Failed sign-in attempt (${d.reason || 'invalid credentials'})`;
    case 'login.blocked':
      return 'Sign-in blocked while account was locked';
    case 'account.locked':
      return `Account locked for ${d.minutes || 15} minutes after repeated failures`;
    case 'account.password_changed':
      return 'Changed own password and signed out other devices';
    case 'logout':
      return 'Signed out';
    case 'access.denied':
      return `Blocked from ${d.method || ''} ${d.path || ''}`.trim();
    case 'admin.user_created':
      return `Created ${d.role || 'staff'} account "${d.username || ''}" with temporary password`;
    case 'admin.user_updated':
      return `Updated user "${d.username || ''}" (role: ${d.role || '-'}, active: ${d.isActive ? 'yes' : 'no'})`;
    case 'admin.user_unlocked':
      return `Unlocked account "${d.username || ''}"`;
    case 'admin.user_signed_out':
      return `Signed out "${d.username || ''}" from all devices`;
    case 'admin.shop_updated':
      return `Updated store configuration (${d.name || 'Mamitas’ Kitchen'})`;
    case 'admin.backup_created':
      return `Created database backup ${l.entity_id || ''} (${d.size || ''})`.trim();
    case 'admin.backup_downloaded':
      return `Downloaded database backup ${l.entity_id || ''}`.trim();
    case 'session.opened':
      return `Opened register session with ${formatMoney(d.openingCash || 0)}`;
    case 'session.closed':
      return `Closed register session (net sales ${formatMoney(d.netSales || 0)}, diff ${formatMoney(d.difference || 0)})`;
    default:
      return target ? `${l.action} on ${target}` : l.action;
  }
}

export default function Admin() {
  const [tab, setTab] = useState('users');
  const [notice, setNotice] = useState(null);

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Administration</h1>
          <p className="muted" style={{ margin: 0 }}>
            Manage staff accounts, system configuration, menu catalog, audit trail, and database backups.
          </p>
        </div>
      </div>

      {notice && (
        <div className={`notice notice-${notice.ok ? 'ok' : 'error'}`} role="status">
          <span>{notice.message}</span>
          <button type="button" className="icon-btn" onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      <div className="chips" role="tablist" aria-label="Administration sections">
        {ADMIN_TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              className="chip"
              aria-selected={tab === t.id}
              aria-pressed={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              <span className="chip-inner"><Icon size={15} aria-hidden="true" /> {t.label}</span>
            </button>
          );
        })}
      </div>

      {tab === 'users' && <UserManagementTab onNotice={setNotice} />}
      {tab === 'config' && <SystemConfigTab onNotice={setNotice} />}
      {tab === 'menu' && <MenuAdminTab onNotice={setNotice} />}
      {tab === 'audit' && <AuditAndBackupsTab onNotice={setNotice} />}
    </section>
  );
}

/* ---------- 1. User & Role Management ---------- */
function UserManagementTab({ onNotice }) {
  const [users, setUsers] = useState(FALLBACK_USERS);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);

  const loadUsers = () => {
    api.get('/admin/users')
      .then((d) => {
        if (Array.isArray(d?.users)) setUsers(d.users);
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const toggleActive = async (u) => {
    const next = !u.isActive;
    try {
      await api.patch(`/admin/users/${u.id}`, { isActive: next });
      loadUsers();
      onNotice({ ok: true, message: `${u.fullName} is now ${next ? 'active' : 'deactivated'}.` });
    } catch (err) {
      onNotice({ ok: false, message: err.message });
    }
  };

  const handleUnlock = async (u) => {
    try {
      await api.post(`/admin/users/${u.id}/unlock`);
      loadUsers();
      onNotice({ ok: true, message: `Unlocked ${u.fullName}'s account.` });
    } catch (err) {
      onNotice({ ok: false, message: err.message });
    }
  };

  const handleSignOutEverywhere = async (u) => {
    try {
      await api.post(`/admin/users/${u.id}/sign-out`);
      onNotice({ ok: true, message: `Ended all active sessions for ${u.fullName}.` });
    } catch (err) {
      onNotice({ ok: false, message: err.message });
    }
  };

  return (
    <div>
      <div className="section-head" style={{ marginTop: 8 }}>
        <h2 style={{ flex: 1 }}>Staff Accounts &amp; Roles</h2>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
          <Plus size={16} aria-hidden="true" /> Add Staff User
        </button>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Full Name</th>
              <th>Username</th>
              <th>Role</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td><strong>{u.fullName}</strong></td>
                <td><code>{u.username}</code></td>
                <td>
                  <StatusBadge tone={u.role === 'owner' ? 'info' : u.role === 'kitchen' ? 'warn' : 'muted'}>
                    {ROLE_LABELS[u.role] || u.role}
                  </StatusBadge>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <StatusBadge tone={u.isActive ? 'ok' : 'danger'}>
                      {u.isActive ? 'Active' : 'Inactive'}
                    </StatusBadge>
                    {u.isLocked && <StatusBadge tone="danger">Locked</StatusBadge>}
                    {u.mustChangePassword && <StatusBadge tone="warn">Temp password</StatusBadge>}
                  </div>
                </td>
                <td>
                  <div className="actions">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(u)}>
                      Edit / Reset Password
                    </button>
                    {u.isLocked && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleUnlock(u)}>
                        Unlock
                      </button>
                    )}
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleSignOutEverywhere(u)}>
                      Sign out everywhere
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => toggleActive(u)}>
                      {u.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && (
        <UserFormModal
          onClose={() => setCreating(false)}
          onSave={async (payload) => {
            try {
              await api.post('/admin/users', payload);
              loadUsers();
              onNotice({ ok: true, message: `Created ${payload.fullName} with a temporary password.` });
              setCreating(false);
            } catch (err) {
              onNotice({ ok: false, message: err.message });
            }
          }}
        />
      )}

      {editing && (
        <UserFormModal
          user={editing}
          onClose={() => setEditing(null)}
          onSave={async (payload) => {
            try {
              await api.patch(`/admin/users/${editing.id}`, payload);
              loadUsers();
              onNotice({
                ok: true,
                message: payload.password
                  ? `Updated ${payload.fullName} and issued a temporary password (all sessions ended).`
                  : `Updated ${payload.fullName}.`,
              });
              setEditing(null);
            } catch (err) {
              onNotice({ ok: false, message: err.message });
            }
          }}
        />
      )}
    </div>
  );
}

function UserFormModal({ user, onClose, onSave }) {
  const [form, setForm] = useState({
    fullName: user?.fullName || '',
    username: user?.username || '',
    role: user?.role || 'cashier',
    password: '',
  });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = (e) => {
    e.preventDefault();
    if (!form.fullName.trim() || !form.username.trim()) {
      setError('Full name and username are required.');
      return;
    }
    if (!user && form.password.length < 6) {
      setError('Enter a temporary password with at least 6 characters.');
      return;
    }
    onSave({
      fullName: form.fullName.trim(),
      username: form.username.trim().toLowerCase(),
      role: form.role,
      ...(form.password ? { password: form.password } : {}),
    });
  };

  return (
    <Modal title={user ? `Edit ${user.fullName}` : 'Add Staff User'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="u-name">Full name</label>
          <input id="u-name" value={form.fullName} onChange={set('fullName')} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="u-user">Username</label>
          <input id="u-user" value={form.username} onChange={set('username')} disabled={Boolean(user)} />
        </div>
        <div className="field">
          <label htmlFor="u-role">Role</label>
          <select id="u-role" value={form.role} onChange={set('role')}>
            <option value="cashier">Cashier (POS &amp; Shifts)</option>
            <option value="kitchen">Kitchen Staff (Inventory &amp; Prep)</option>
            <option value="owner">Owner / Administrator (Full Access)</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="u-pass">
            {user ? 'Reset to temporary password (leave blank to keep current)' : 'Temporary password'}
          </label>
          <input id="u-pass" type="password" value={form.password} onChange={set('password')} />
          <span className="hint">
            {user
              ? 'Setting a new password forces a password change on next sign-in and ends active sessions.'
              : 'The user must set their own password on first sign-in before using the app.'}
          </span>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">{user ? 'Save Changes' : 'Create User'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- 2. System Configuration ---------- */
function SystemConfigTab({ onNotice }) {
  const [cfg, setCfg] = useState({
    name: SHOP.name,
    location: SHOP.location,
    currency: SHOP.currency,
    gstRegistered: SHOP.gstRegistered,
    gstRate: String(SHOP.gstRate * 100),
    gstRegNo: SHOP.gstRegNo || '',
    expiryWarningDays: '3',
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/shop')
      .then((d) => {
        if (d?.shop) {
          setCfg((prev) => ({
            ...prev,
            name: d.shop.name ?? prev.name,
            location: d.shop.location ?? prev.location,
            currency: d.shop.currency ?? prev.currency,
            gstRegistered: Boolean(d.shop.gstRegistered),
            gstRate: d.shop.gstRate != null ? String(Number(d.shop.gstRate) * 100) : prev.gstRate,
            gstRegNo: d.shop.gstRegNo ?? prev.gstRegNo,
            expiryWarningDays: d.shop.expiryWarningDays != null ? String(d.shop.expiryWarningDays) : prev.expiryWarningDays,
          }));
        }
      })
      .catch(() => {});
  }, []);

  const set = (k) => (e) => {
    const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setCfg({ ...cfg, [k]: val });
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch('/admin/shop', {
        ...cfg,
        gstRate: Number(cfg.gstRate) / 100,
        expiryWarningDays: Number(cfg.expiryWarningDays),
      });
      onNotice({ ok: true, message: 'System configuration saved.' });
    } catch (err) {
      onNotice({ ok: false, message: err.message });
    }
    setBusy(false);
  };

  return (
    <form className="card" style={{ maxWidth: 680 }} onSubmit={save}>
      <h2 style={{ marginTop: 0 }}>Shop, Tax &amp; Alert Settings</h2>
      <p className="muted">Configure store details printed on receipts and global operational thresholds.</p>

      <div className="admin-form-grid">
        <div className="field">
          <label htmlFor="cfg-name">Business / Kitchen Name</label>
          <input id="cfg-name" value={cfg.name} onChange={set('name')} />
        </div>
        <div className="field">
          <label htmlFor="cfg-loc">Branch / Location</label>
          <input id="cfg-loc" value={cfg.location} onChange={set('location')} />
        </div>
        <div className="field">
          <label htmlFor="cfg-curr">Currency Code</label>
          <input id="cfg-curr" value={cfg.currency} onChange={set('currency')} maxLength={5} />
        </div>
        <div className="field">
          <label htmlFor="cfg-exp">Expiry Warning Window (Days)</label>
          <input id="cfg-exp" type="number" min="1" max="30" value={cfg.expiryWarningDays} onChange={set('expiryWarningDays')} />
        </div>
      </div>

      <div className="field" style={{ marginTop: 6 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={cfg.gstRegistered}
            onChange={set('gstRegistered')}
            style={{ width: 18, height: 18, minHeight: 0 }}
          />
          GST Registered (Prices are GST-inclusive)
        </label>
      </div>

      {cfg.gstRegistered && (
        <div className="admin-form-grid">
          <div className="field">
            <label htmlFor="cfg-gst">GST Rate (%)</label>
            <input id="cfg-gst" type="number" step="0.1" min="0" max="30" value={cfg.gstRate} onChange={set('gstRate')} />
          </div>
          <div className="field">
            <label htmlFor="cfg-reg">GST Registration No.</label>
            <input id="cfg-reg" value={cfg.gstRegNo} onChange={set('gstRegNo')} placeholder="e.g. 202612345A" />
          </div>
        </div>
      )}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>
    </form>
  );
}

/* ---------- 3. Menu Management ---------- */
function MenuAdminTab({ onNotice }) {
  const { items, usableStockByItem } = useInventory();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [modal, setModal] = useState(null);

  const menuRows = items.filter((i) => {
    if (i.type === 'ingredient') return false;
    if (typeFilter !== 'all' && i.type !== typeFilter) return false;
    if (search.trim() && !i.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  return (
    <div>
      <div className="section-head" style={{ marginTop: 8 }}>
        <h2 style={{ flex: 1 }}>Menu Catalog &amp; Pricing ({menuRows.length})</h2>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setModal({ kind: 'add' })}>
          <Plus size={16} aria-hidden="true" /> Add Menu Item
        </button>
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search dishes or food trays"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Filter menu type">
          <option value="all">All menu types</option>
          <option value="food">Foods (Servings)</option>
          <option value="food_tray">Food Trays</option>
        </select>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Menu Item</th>
              <th>Type</th>
              <th>Category</th>
              <th className="num">Selling Price</th>
              <th className="num">Low-Stock Level</th>
              <th className="num">Usable Today</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {menuRows.length === 0 && (
              <tr><td colSpan="7" className="empty">No menu items match your filter.</td></tr>
            )}
            {menuRows.map((i) => (
              <tr key={i.id}>
                <td><strong>{i.name}</strong></td>
                <td>{i.type === 'food_tray' ? 'Food tray' : 'Food'}</td>
                <td>{i.category}</td>
                <td className="num">{formatMoney(i.price)}</td>
                <td className="num">{i.minLevel} {i.unit}</td>
                <td className="num">{usableStockByItem[i.id] || 0} {i.unit}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setModal({ kind: 'edit', item: i })}
                  >
                    Edit Price / Threshold
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal?.kind === 'add' && <AddMenuItemModal onClose={() => setModal(null)} onDone={onNotice} />}
      {modal?.kind === 'edit' && (
        <EditMenuItemModal item={modal.item} onClose={() => setModal(null)} onDone={onNotice} />
      )}
    </div>
  );
}

/* ---------- 4. Audit Logs & Backups ---------- */
function AuditAndBackupsTab({ onNotice }) {
  const [logs, setLogs] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [category, setCategory] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [backups, setBackups] = useState([]);
  const [backingUp, setBackingUp] = useState(false);

  const fetchLogs = async ({ append = false, beforeId = null } = {}) => {
    setLoadingLogs(true);
    const params = new URLSearchParams({ limit: '25' });
    if (beforeId) params.set('beforeId', String(beforeId));
    if (category) params.set('category', category);
    if (userFilter.trim()) params.set('user', userFilter.trim());
    if (fromDate) params.set('from', fromDate);
    if (toDate) params.set('to', toDate);

    try {
      const d = await api.get(`/audit-log?${params.toString()}`);
      const rows = Array.isArray(d?.entries) ? d.entries : [];
      setLogs((prev) => (append ? [...prev, ...rows] : rows));
      setHasMore(Boolean(d?.hasMore));
    } catch {
      if (!append) setLogs([]);
      setHasMore(false);
    }
    setLoadingLogs(false);
  };

  const loadBackups = () => {
    api.get('/admin/backups')
      .then((d) => {
        if (Array.isArray(d?.backups)) setBackups(d.backups);
      })
      .catch(() => {});
  };

useEffect(() => {
    let active = true;
    const run = async () => {
      setLoadingLogs(true);
      const params = new URLSearchParams({ limit: '25' });
      if (category) params.set('category', category);
      if (userFilter.trim()) params.set('user', userFilter.trim());
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);

      try {
        const d = await api.get(`/audit-log?${params.toString()}`);
        if (!active) return;
        const rows = Array.isArray(d?.entries) ? d.entries : [];
        setLogs(rows);
        setHasMore(Boolean(d?.hasMore));
      } catch {
        if (!active) return;
        setLogs([]);
        setHasMore(false);
      } finally {
        if (active) setLoadingLogs(false);
      }
    };
    run();
    return () => {
      active = false;
    };
  }, [category, userFilter, fromDate, toDate]);

  useEffect(() => {
    loadBackups();
  }, []);

  const triggerBackup = async () => {
    setBackingUp(true);
    try {
      const res = await api.post('/admin/backups');
      if (res?.backup) setBackups((prev) => [res.backup, ...prev]);
      fetchLogs({ append: false });
      onNotice({ ok: true, message: `Database backup ${res.backup.filename} created.` });
    } catch (err) {
      onNotice({ ok: false, message: err.message });
    }
    setBackingUp(false);
  };

  const exportLogsCsv = () => {
    const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const headers = ['Timestamp', 'User', 'Action', 'Description', 'Entity', 'IP Address'];
    const rows = logs.map((l) => [
      l.created_at,
      l.username || 'System',
      l.action,
      describeAudit(l),
      l.entity ? `${l.entity}${l.entity_id ? ` #${l.entity_id}` : ''}` : '',
      l.ip || '',
    ]);
    const csv = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mamitas-activity-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <div className="card">
        <div className="session-head">
          <div>
            <h2>Database Backups</h2>
            <p className="muted" style={{ margin: 0 }}>
              Create manual PostgreSQL snapshots saved under <code>database/backups/</code>.
            </p>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={triggerBackup} disabled={backingUp}>
            <Database size={16} aria-hidden="true" /> {backingUp ? 'Creating snapshot...' : 'Create Backup Now'}
          </button>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Snapshot File</th>
                <th>Size</th>
                <th>Created At</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {backups.length === 0 && (
                <tr><td colSpan="5" className="empty">No backup snapshots found yet. Click Create Backup Now to generate one.</td></tr>
              )}
              {backups.map((b) => (
                <tr key={b.id}>
                  <td><code>{b.filename}</code></td>
                  <td>{b.size}</td>
                  <td>{fmtDateTime(b.createdAt)}</td>
                  <td><StatusBadge tone="ok">{b.status}</StatusBadge></td>
                  <td>
                    <a
                      href={`/api/admin/backups/${encodeURIComponent(b.filename)}/download`}
                      download={b.filename}
                      className="btn btn-secondary btn-sm"
                    >
                      <Download size={14} aria-hidden="true" /> Download
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="section-head" style={{ marginTop: 0 }}>
          <h2 style={{ flex: 1 }}>Activity Log</h2>
          <div className="actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => fetchLogs({ append: false })}>
              <RefreshCw size={15} aria-hidden="true" /> Refresh
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={exportLogsCsv} disabled={logs.length === 0}>
              <Download size={15} aria-hidden="true" /> Export CSV
            </button>
          </div>
        </div>

        <div className="toolbar">
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
            {AUDIT_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          <input
            type="search"
            placeholder="Filter by username"
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            aria-label="Filter by username"
          />
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            aria-label="From date"
          />
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            aria-label="To date"
          />
          {(category || userFilter || fromDate || toDate) && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setCategory('');
                setUserFilter('');
                setFromDate('');
                setToDate('');
              }}
            >
              Clear filters
            </button>
          )}
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>User</th>
                <th>Event</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && (
                <tr>
                  <td colSpan="4" className="empty">
                    {loadingLogs ? 'Loading activity log...' : 'No activity log entries match your filters.'}
                  </td>
                </tr>
              )}
              {logs.map((l) => (
                <tr key={l.id}>
                  <td>{fmtDateTime(l.created_at)}</td>
                  <td><strong>{l.username || 'System'}</strong></td>
                  <td><StatusBadge tone="info">{l.action}</StatusBadge></td>
                  <td>{describeAudit(l)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {hasMore && (
          <div style={{ marginTop: 14, textAlign: 'center' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={loadingLogs}
              onClick={() => fetchLogs({ append: true, beforeId: logs[logs.length - 1]?.id })}
            >
              {loadingLogs ? 'Loading...' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}