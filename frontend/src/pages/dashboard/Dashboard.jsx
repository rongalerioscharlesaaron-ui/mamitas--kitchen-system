import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useInventory } from '../../context/InventoryContext';
import { useOrders } from '../../context/OrderContext';
import StatCard from '../../components/StatCard';
import StatusBadge from '../../components/StatusBadge';
import { stockStatus, MOVE_LABEL, MOVE_TONE, EXPIRY_INFO } from '../../utils/inventory';
import { expiryStatus, fmtDate, fmtDateTime } from '../../utils/dates';
import { formatMoney, fromCents, toCents } from '../../utils/money';

const isToday = (iso) => new Date(iso).toDateString() === new Date().toDateString();
const ORDER_STATUS = {
  preparing: { label: 'Preparing', tone: 'info' },
  completed: { label: 'Completed', tone: 'ok' },
};
const orderItemCount = (o) => o.lines.reduce((s, l) => s + l.qty, 0);

export default function Dashboard() {
  const { user } = useAuth();
  if (user.role === 'cashier') return <CashierOverview user={user} />;
  if (user.role === 'owner') return <OwnerOverview />;
  return (
    <section>
      <h1>Dashboard</h1>
      <p className="muted">Overview of your inventory today.</p>
      <InventoryContent />
    </section>
  );
}

/* ---------- Sales numbers shared by the cashier and owner views ---------- */
function useSales() {
  const { orders } = useOrders();
  return useMemo(() => {
    const today = orders.filter((o) => isToday(o.createdAt));
    const salesCents = today.reduce((s, o) => s + toCents(o.total), 0);

    const sold = {};
    today.forEach((o) =>
      o.lines.forEach((l) => {
        sold[l.name] = (sold[l.name] || 0) + l.qty;
      })
    );
    const top = Object.entries(sold)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const sorted = [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      todayCount: today.length,
      sales: fromCents(salesCents),
      average: today.length ? fromCents(Math.round(salesCents / today.length)) : 0,
      preparing: sorted.filter((o) => o.status === 'preparing'),
      recent: sorted.slice(0, 5),
      top,
    };
  }, [orders]);
}

function RecentOrders({ orders }) {
  return (
    <div className="card panel">
      <h2>Recent orders</h2>
      {orders.length === 0 ? (
        <p className="muted">No orders yet.</p>
      ) : (
        <ul className="list">
          {orders.map((o) => (
            <li key={o.id}>
              <span>
                Order #{o.number}, {formatMoney(o.total)}
                <br />
                <small className="muted">{fmtDateTime(o.createdAt)}</small>
              </span>
              <StatusBadge tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</StatusBadge>
            </li>
          ))}
        </ul>
      )}
      <Link to="/orders/history">View order history</Link>
    </div>
  );
}

/* ---------- Cashier ---------- */
function CashierOverview({ user }) {
  const s = useSales();
  const { menuItems, stockOf } = useOrders();

  const running = menuItems
    .map((i) => ({ item: i, stock: stockOf(i.id) }))
    .map((r) => ({ ...r, status: stockStatus(r.stock, r.item.minLevel) }))
    .filter((r) => r.status.key !== 'in')
    .sort((a, b) => (a.status.key === 'out' ? -1 : 1) - (b.status.key === 'out' ? -1 : 1));

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted" style={{ margin: 0 }}>Welcome back, {user.name}.</p>
        </div>
        <Link to="/orders" className="btn btn-primary btn-lg">New order</Link>
      </div>

      <div className="stat-grid">
        <StatCard label="Orders today" value={s.todayCount} tone="info" to="/orders/history" />
        <StatCard label="Sales today" value={formatMoney(s.sales)} tone="ok" to="/orders/history" />
        <StatCard
          label="Still preparing" value={s.preparing.length} tone="warn"
          to="/orders/history" hint="Not yet handed over"
        />
        <StatCard
          label="Menu running low" value={running.length} tone="warn"
          to="/orders" hint="Low or out of stock"
        />
      </div>

      <div className="panels">
        <div className="card panel">
          <h2>Being prepared</h2>
          {s.preparing.length === 0 ? (
            <p className="muted">No orders are waiting.</p>
          ) : (
            <ul className="list">
              {s.preparing.slice(0, 5).map((o) => (
                <li key={o.id}>
                  <span>
                    Order #{o.number}
                    <br />
                    <small className="muted">
                      {orderItemCount(o)} {orderItemCount(o) === 1 ? 'item' : 'items'}, {fmtDateTime(o.createdAt)}
                    </small>
                  </span>
                  <StatusBadge tone="info">Preparing</StatusBadge>
                </li>
              ))}
            </ul>
          )}
          <Link to="/orders/history">Mark orders as completed</Link>
        </div>

        <div className="card panel">
          <h2>Menu running low</h2>
          {running.length === 0 ? (
            <p className="muted">Everything on the menu is well stocked.</p>
          ) : (
            <ul className="list">
              {running.slice(0, 6).map((r) => (
                <li key={r.item.id}>
                  <span>{r.item.name}, {r.stock} {r.item.unit} left</span>
                  <StatusBadge tone={r.status.tone}>{r.status.label}</StatusBadge>
                </li>
              ))}
            </ul>
          )}
          <Link to="/orders">Go to new order</Link>
        </div>

        <RecentOrders orders={s.recent} />
      </div>
    </section>
  );
}

/* ---------- Owner ---------- */
function OwnerOverview() {
  const s = useSales();
  return (
    <section>
      <h1>Dashboard</h1>
      <p className="muted">Sales and inventory overview for today.</p>

      <div className="stat-grid">
        <StatCard label="Sales today" value={formatMoney(s.sales)} tone="ok" to="/orders/history" />
        <StatCard label="Orders today" value={s.todayCount} tone="info" to="/orders/history" />
        <StatCard label="Average order" value={formatMoney(s.average)} tone="info" to="/orders/history" />
        <StatCard
          label="Still preparing" value={s.preparing.length} tone="warn"
          to="/orders/history" hint="Not yet handed over"
        />
      </div>

      <div className="panels">
        <div className="card panel">
          <h2>Top sellers today</h2>
          {s.top.length === 0 ? (
            <p className="muted">No sales yet today.</p>
          ) : (
            <ul className="list">
              {s.top.map(([name, qty]) => (
                <li key={name}>
                  <span>{name}</span>
                  <StatusBadge tone="muted">{qty} sold</StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </div>
        <RecentOrders orders={s.recent} />
      </div>

      <div className="section-head">
        <h2>Inventory</h2>
      </div>
      <InventoryContent />
    </section>
  );
}

/* ---------- Inventory cards and panels (kitchen and owner) ---------- */
function InventoryContent() {
  const { items, batches, movements, stockByItem, usableStockByItem, itemMap } = useInventory();

  // Foods and trays count only sellable (non-expired) stock, like the Menu page
  const stockOf = (i) => (i.type === 'ingredient' ? stockByItem[i.id] : usableStockByItem[i.id]) || 0;

  const attention = items
    .map((i) => ({ item: i, stock: stockOf(i) }))
    .map((r) => ({ ...r, status: stockStatus(r.stock, r.item.minLevel) }))
    .filter((r) => r.status.key !== 'in')
    .sort((a, b) => (a.status.key === 'out' ? -1 : 1) - (b.status.key === 'out' ? -1 : 1));

  const live = batches.filter((b) => b.qty > 0 && b.expiry);
  const expired = live.filter((b) => expiryStatus(b.expiry) === 'expired');
  const soon = live.filter((b) => expiryStatus(b.expiry) === 'soon');
  const alerts = [...expired, ...soon].sort((a, b) => a.expiry.localeCompare(b.expiry));

  const weekAgo = Date.now() - 7 * 86400000;
  const losses = movements.filter(
    (m) => (m.type === 'DAMAGED' || m.type === 'SPOILED') && new Date(m.date).getTime() >= weekAgo
  );

  const recent = [...movements].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const ingredients = items.filter((i) => i.type === 'ingredient').length;

  return (
    <>
      <div className="stat-grid">
        <StatCard
          label="Total items" value={items.length} tone="info" to="/inventory"
          hint={`${ingredients} ingredients, ${items.length - ingredients} menu items`}
        />
        <StatCard label="Low or out of stock" value={attention.length} tone="warn" to="/inventory/menu" hint="Needs restocking" />
        <StatCard label="Expiring soon" value={soon.length} tone="warn" to="/inventory/expiration" hint="Batches" />
        <StatCard label="Expired" value={expired.length} tone="danger" to="/inventory/expiration" hint="Still on hand" />
        <StatCard label="Damaged or spoiled" value={losses.length} tone="danger" to="/inventory/damaged" hint="Entries in the last 7 days" />
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
                  <span>{r.item.name}, {r.stock} of {r.item.minLevel} {r.item.unit}</span>
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
                    <span>{item?.name}, {b.qty} {item?.unit}, {fmtDate(b.expiry)}</span>
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
                  {itemMap[m.itemId]?.name}, {m.qty} {itemMap[m.itemId]?.unit}
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
    </>
  );
}