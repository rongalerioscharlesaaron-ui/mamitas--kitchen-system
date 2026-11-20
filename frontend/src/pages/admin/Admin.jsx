import { useEffect, useState } from 'react';
import { Users, Settings, UtensilsCrossed, ShieldCheck, Database, Plus, RefreshCw } from 'lucide-react';
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

const FALLBACK_USERS = [
  { id: 1, username: 'owner', fullName: 'Owner', role: 'owner', isActive: true, lastLogin: null },
  { id: 2, username: 'cashier', fullName: 'Cashier', role: 'cashier', isActive: true, lastLogin: null },
  { id: 3, username: 'kitchen', fullName: 'Kitchen Staff', role: 'kitchen', isActive: true, lastLogin: null },
];

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
  const [backendWired, setBackendWired] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);

  const loadUsers = () => {
    api.get('/admin/users')
      .then((d) => {
        if (Array.isArray(d?.users)) {
          setUsers(d.users);
          setBackendWired(true);
        }
      })
      .catch(() => setBackendWired(false));
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
    } catch {
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, isActive: next } : x)));
      onNotice({ ok: true, message: `Updated ${u.fullName} in UI preview (connect /api/admin/users to persist).` });
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

      {!backendWired && (
        <div className="info-box">
          Showing default system accounts. Once we wire <code>/api/admin/users</code> on the backend, changes here will save directly to PostgreSQL.
        </div>
      )}

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
                  <StatusBadge tone={u.isActive ? 'ok' : 'danger'}>
                    {u.isActive ? 'Active' : 'Inactive'}
                  </StatusBadge>
                </td>
                <td>
                  <div className="actions">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(u)}>
                      Edit Role / Password
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
              onNotice({ ok: true, message: `Created account for ${payload.fullName}.` });
            } catch {
              setUsers((prev) => [...prev, { id: Date.now(), ...payload, isActive: true }]);
              onNotice({ ok: true, message: `Added ${payload.fullName} in UI preview.` });
            }
            setCreating(false);
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
              onNotice({ ok: true, message: `Updated ${payload.fullName}.` });
            } catch {
              setUsers((prev) => prev.map((x) => (x.id === editing.id ? { ...x, ...payload } : x)));
              onNotice({ ok: true, message: `Updated ${payload.fullName} in UI preview.` });
            }
            setEditing(null);
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
      setError('Enter a password with at least 6 characters.');
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
          <label htmlFor="u-pass">{user ? 'New password (leave blank to keep current)' : 'Initial password'}</label>
          <input id="u-pass" type="password" value={form.password} onChange={set('password')} />
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
    } catch {
      onNotice({ ok: true, message: 'Configuration updated in UI preview (connect /api/admin/shop to persist).' });
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
          <input type="checkbox" checked={cfg.gstRegistered} onChange={set('gstRegistered')} style={{ width: 18, height: 18, minHeight: 0 }} />
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
  const [query, setQuery] = useState('');
  const [backups, setBackups] = useState([
    { id: 'bk-1', filename: 'before_opening_stock.dump', size: '51.7 KB', createdAt: '2026-11-17T08:00:00Z', status: 'Verified' },
    { id: 'bk-2', filename: 'before_real_data.dump', size: '51.3 KB', createdAt: '2026-11-16T18:30:00Z', status: 'Verified' },
  ]);
  const [backingUp, setBackingUp] = useState(false);

  const loadAudit = () => {
    api.get('/audit?limit=50')
      .then((d) => {
        if (Array.isArray(d?.logs)) setLogs(d.logs);
      })
      .catch(() => setLogs([]));
  };

  useEffect(() => {
    loadAudit();
  }, []);

  const triggerBackup = async () => {
    setBackingUp(true);
    try {
      const res = await api.post('/admin/backups');
      if (res?.backup) setBackups((prev) => [res.backup, ...prev]);
      onNotice({ ok: true, message: 'Database backup snapshot created.' });
    } catch {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      setBackups((prev) => [
        { id: `bk-${Date.now()}`, filename: `mamitas_backup_${stamp}.dump`, size: '54.2 KB', createdAt: new Date().toISOString(), status: 'Preview' },
        ...prev,
      ]);
      onNotice({ ok: true, message: 'Backup snapshot queued in UI preview (connect /api/admin/backups on backend).' });
    }
    setBackingUp(false);
  };

  const filteredLogs = logs.filter((l) => {
    if (!query.trim()) return true;
    const text = `${l.action || ''} ${l.actor || l.userName || ''} ${l.details || ''}`.toLowerCase();
    return text.includes(query.trim().toLowerCase());
  });

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <div className="card">
        <div className="session-head">
          <div>
            <h2>Database Backups</h2>
            <p className="muted" style={{ margin: 0 }}>
              Create manual PostgreSQL snapshots before bulk menu updates or end-of-month closing.
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
              </tr>
            </thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.id}>
                  <td><code>{b.filename}</code></td>
                  <td>{b.size}</td>
                  <td>{fmtDateTime(b.createdAt)}</td>
                  <td><StatusBadge tone="ok">{b.status}</StatusBadge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="section-head" style={{ marginTop: 0 }}>
          <h2 style={{ flex: 1 }}>System Audit Trail</h2>
          <button type="button" className="btn btn-secondary btn-sm" onClick={loadAudit}>
            <RefreshCw size={15} aria-hidden="true" /> Refresh
          </button>
        </div>

        <div className="toolbar">
          <input
            type="search"
            placeholder="Filter by user, action, or entity"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>User</th>
                <th>Action</th>
                <th>Target / Details</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.length === 0 && (
                <tr>
                  <td colSpan="4" className="empty">
                    No audit log entries returned yet. We will wire <code>/api/audit</code> in the backend phase.
                  </td>
                </tr>
              )}
              {filteredLogs.map((l) => (
                <tr key={l.id}>
                  <td>{fmtDateTime(l.createdAt || l.created_at)}</td>
                  <td><strong>{l.actor || l.userName || 'System'}</strong></td>
                  <td><StatusBadge tone="info">{l.action}</StatusBadge></td>
                  <td>{l.details || l.target || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}