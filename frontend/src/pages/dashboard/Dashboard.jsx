import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useInventory } from '../../context/InventoryContext';
import StatCard from '../../components/StatCard';
import StatusBadge from '../../components/StatusBadge';
import { stockStatus, MOVE_LABEL, MOVE_TONE, EXPIRY_INFO } from '../../utils/inventory';
import { expiryStatus, fmtDate, fmtDateTime } from '../../utils/dates';

export default function Dashboard() {
  const { user } = useAuth();

  if (user.role === 'cashier') {
    return (
      <section>
        <h1>Welcome, {user.name}</h1>
        <p className="muted">Your order screen will appear here once the POS is built.</p>
      </section>
    );
  }

  return <InventoryOverview />;
}

function InventoryOverview() {
  const { items, batches, movements, stockByItem, itemMap } = useInventory();

  const attention = items
    .map((i) => ({ item: i, stock: stockByItem[i.id] || 0 }))
    .map((r) => ({ ...r, status: stockStatus(r.stock, r.item.minLevel) }))
    .filter((r) => r.status.key !== 'in');

  const live = batches.filter((b) => b.qty > 0 && b.expiry);
  const expired = live.filter((b) => expiryStatus(b.expiry) === 'expired');
  const soon = live.filter((b) => expiryStatus(b.expiry) === 'soon');
  const alerts = [...expired, ...soon].sort((a, b) => a.expiry.localeCompare(b.expiry));

  const weekAgo = Date.now() - 7 * 86400000;
  const losses = movements.filter(
    (m) =>
      (m.type === 'DAMAGED' || m.type === 'SPOILED') &&
      new Date(m.date).getTime() >= weekAgo
  );

  const recent = [...movements].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const ingredients = items.filter((i) => i.type === 'ingredient').length;

  return (
    <section>
      <h1>Dashboard</h1>
      <p className="muted">Overview of your inventory today.</p>

      <div className="stat-grid">
        <StatCard
          label="Total Items"
          value={items.length}
          tone="info"
          to="/inventory"
          hint={`${ingredients} ingredients · ${items.length - ingredients} menu items`}
        />
        <StatCard
          label="Low / Out of Stock"
          value={attention.length}
          tone="warn"
          to="/inventory"
          hint="Needs restocking"
        />
        <StatCard
          label="Expiring Soon"
          value={soon.length}
          tone="warn"
          to="/inventory/expiration"
          hint="Batches"
        />
        <StatCard
          label="Expired"
          value={expired.length}
          tone="danger"
          to="/inventory/expiration"
          hint="Still on hand"
        />
        <StatCard
          label="Damaged / Spoiled"
          value={losses.length}
          tone="danger"
          to="/inventory/damaged"
          hint="Entries in the last 7 days"
        />
      </div>

      <div className="panels">
        <div className="card panel">
          <h2>Needs restock</h2>
          {attention.length === 0 ? (
            <p className="muted">Everything is well stocked.</p>
          ) : (
            <ul className="list">
              {attention.slice(0, 5).map((r) => (
                <li key={r.item.id}>
                  <span>
                    {r.item.name} · {r.stock} / {r.item.minLevel} {r.item.unit}
                  </span>
                  <StatusBadge tone={r.status.tone}>{r.status.label}</StatusBadge>
                </li>
              ))}
            </ul>
          )}
          <Link to="/inventory">View inventory</Link>
        </div>

        <div className="card panel">
          <h2>Expiry alerts</h2>
          {alerts.length === 0 ? (
            <p className="muted">No batches are close to expiring.</p>
          ) : (
            <ul className="list">
              {alerts.slice(0, 5).map((b) => {
                const info = EXPIRY_INFO[expiryStatus(b.expiry)];
                const item = itemMap[b.itemId];
                return (
                  <li key={b.id}>
                    <span>
                      {item?.name} · {b.qty} {item?.unit} · {fmtDate(b.expiry)}
                    </span>
                    <StatusBadge tone={info.tone}>{info.label}</StatusBadge>
                  </li>
                );
              })}
            </ul>
          )}
          <Link to="/inventory/expiration">View expiration monitoring</Link>
        </div>

        <div className="card panel">
          <h2>Recent stock movements</h2>
          <ul className="list">
            {recent.map((m) => (
              <li key={m.id}>
                <span>
                  {itemMap[m.itemId]?.name} · {m.qty} {itemMap[m.itemId]?.unit}
                  <br />
                  <small className="muted">{fmtDateTime(m.date)}</small>
                </span>
                <StatusBadge tone={MOVE_TONE[m.type]}>{MOVE_LABEL[m.type]}</StatusBadge>
              </li>
            ))}
          </ul>
          <Link to="/inventory/movements">View all logs</Link>
        </div>
      </div>
    </section>
  );
}