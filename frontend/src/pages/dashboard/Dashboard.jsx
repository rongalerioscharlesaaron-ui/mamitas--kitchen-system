import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useOrders } from '../../context/OrderContext';
import { useSession } from '../../context/SessionContext';
import { useAutoLoad } from '../../hooks/useAutoLoad';
import StatCard from '../../components/StatCard';
import StatusBadge from '../../components/StatusBadge';
import SessionCard from '../../components/session/SessionCard';
import OpenSessionForm from '../../components/session/OpenSessionForm';
import CloseSessionModal from '../../components/session/CloseSessionModal';
import { MOVE_LABEL, MOVE_TONE, EXPIRY_INFO } from '../../utils/inventory';
import { fmtDate, fmtDateTime } from '../../utils/dates';
import { fmtDayTime } from '../../utils/time';
import { formatMoney } from '../../utils/money';

const ORDER_STATUS = {
  preparing: { label: 'Preparing', tone: 'info' },
  completed: { label: 'Completed', tone: 'ok' },
};
const STOCK_BADGE = {
  out: { label: 'Out of stock', tone: 'danger' },
  low: { label: 'Low stock', tone: 'warn' },
};
const itemsText = (n) => `${n} ${n === 1 ? 'item' : 'items'}`;

// Shows a loading text or an error until the data has arrived
function Gate({ state, children }) {
  if (!state.data) {
    return state.error ? (
      <div className="notice notice-error" role="alert">
        <span>{state.error}</span>
        <button className="btn btn-secondary btn-sm" onClick={state.reload}>Try again</button>
      </div>
    ) : (
      <p className="muted">Loading...</p>
    );
  }
  return (
    <>
      {state.error && (
        <div className="notice notice-error" role="alert">
          <span>{state.error}</span>
          <button className="btn btn-secondary btn-sm" onClick={state.reload}>Try again</button>
        </div>
      )}
      {children(state.data)}
    </>
  );
}

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
  const sales = useAutoLoad(() => api.get('/dashboard/sales'), []);
  const { menuItems } = useOrders();
  const { session, ready } = useSession();
  const [closing, setClosing] = useState(null); // the session being closed

  const running = menuItems
    .filter((i) => i.status !== 'in')
    .sort((a, b) => (a.status === 'out' ? -1 : 1) - (b.status === 'out' ? -1 : 1));

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted" style={{ margin: 0 }}>Welcome back, {user.name}.</p>
        </div>
        {session && <Link to="/orders" className="btn btn-primary btn-lg">New order</Link>}
      </div>

      {!ready ? (
        <p className="muted">Loading...</p>
      ) : session ? (
        <SessionCard session={session} onClose={() => setClosing(session)} />
      ) : (
        <OpenSessionForm />
      )}

      <Gate state={sales}>
        {(s) => (
          <>
            <div className="stat-grid">
              <StatCard
                label="Still preparing" value={s.preparingCount} tone="warn"
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
                {s.preparingOrders.length === 0 ? (
                  <p className="muted">No orders are waiting.</p>
                ) : (
                  <ul className="list">
                    {s.preparingOrders.map((o) => (
                      <li key={o.id}>
                        <span>
                          Order #{o.number}
                          <br />
                          <small className="muted">{itemsText(o.itemCount)}, {fmtDateTime(o.createdAt)}</small>
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
                    {running.slice(0, 6).map((i) => (
                      <li key={i.id}>
                        <span>{i.name}, {i.qtyUsable} {i.unit} left</span>
                        <StatusBadge tone={STOCK_BADGE[i.status].tone}>{STOCK_BADGE[i.status].label}</StatusBadge>
                      </li>
                    ))}
                  </ul>
                )}
                <Link to="/orders">Go to new order</Link>
              </div>

              <RecentOrders orders={s.recentOrders} />
            </div>
          </>
        )}
      </Gate>

      {closing && <CloseSessionModal session={closing} onClose={() => setClosing(null)} />}
    </section>
  );
}

/* ---------- Owner ---------- */
const resultBadge = (s) => {
  if (s.isOpen) return <StatusBadge tone="info">Open</StatusBadge>;
  if (s.cashDifference === 0) return <StatusBadge tone="ok">Balanced</StatusBadge>;
  return s.cashDifference < 0 ? (
    <StatusBadge tone="danger">Short {formatMoney(-s.cashDifference)}</StatusBadge>
  ) : (
    <StatusBadge tone="warn">Over {formatMoney(s.cashDifference)}</StatusBadge>
  );
};

function SessionsToday({ sessions }) {
  const onShift = sessions.filter((s) => s.isOpen);
  return (
    <>
      <p className="muted">
        {onShift.length === 0
          ? 'Nobody is on shift right now.'
          : `On shift now: ${onShift.map((s) => `${s.cashier} since ${fmtDayTime(s.openedAt)}`).join(', ')}.`}
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Cashier</th>
              <th>Time IN</th>
              <th>Time OUT</th>
              <th className="num">Orders</th>
              <th className="num">Net sales</th>
              <th className="num">Expected cash</th>
              <th className="num">Counted cash</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 && (
              <tr><td colSpan="8" className="empty">No sessions today.</td></tr>
            )}
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>{s.cashier}</td>
                <td>{fmtDayTime(s.openedAt)}</td>
                <td>{s.isOpen ? 'Still open' : fmtDayTime(s.closedAt)}</td>
                <td className="num">{s.orders}</td>
                <td className="num">{formatMoney(s.netSales)}</td>
                <td className="num">{formatMoney(s.expectedCash)}</td>
                <td className="num">{s.isOpen ? '-' : formatMoney(s.countedCash)}</td>
                <td>{resultBadge(s)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function OwnerOverview() {
  const sales = useAutoLoad(() => api.get('/dashboard/sales'), []);
  const sessions = useAutoLoad(() => api.get('/sessions?date=today'), []);
  return (
    <section>
      <h1>Dashboard</h1>
      <p className="muted">Sales and inventory overview for today.</p>

      <Gate state={sales}>
        {(s) => (
          <>
            <div className="stat-grid">
              <StatCard label="Sales today" value={formatMoney(s.todaySales)} tone="ok" to="/orders/history" />
              <StatCard label="Orders today" value={s.todayOrders} tone="info" to="/orders/history" />
              <StatCard label="Average order" value={formatMoney(s.averageOrder)} tone="info" to="/orders/history" />
              <StatCard
                label="Still preparing" value={s.preparingCount} tone="warn"
                to="/orders/history" hint="Not yet handed over"
              />
            </div>

            <div className="panels">
              <div className="card panel">
                <h2>Top sellers today</h2>
                {s.topSellers.length === 0 ? (
                  <p className="muted">No sales yet today.</p>
                ) : (
                  <ul className="list">
                    {s.topSellers.map((t) => (
                      <li key={t.name}>
                        <span>{t.name}</span>
                        <StatusBadge tone="muted">{t.qty} sold</StatusBadge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <RecentOrders orders={s.recentOrders} />
            </div>
          </>
        )}
      </Gate>

      <div className="section-head">
        <h2>Cashier sessions today</h2>
      </div>
      <Gate state={sessions}>{(d) => <SessionsToday sessions={d.sessions} />}</Gate>

      <div className="section-head">
        <h2>Inventory</h2>
      </div>
      <InventoryContent />
    </section>
  );
}

/* ---------- Inventory cards and panels (kitchen and owner) ---------- */
function InventoryContent() {
  const inv = useAutoLoad(() => api.get('/dashboard/inventory'), []);

  return (
    <Gate state={inv}>
      {(v) => (
        <>
          <div className="stat-grid">
            <StatCard
              label="Total items" value={v.totalItems} tone="info" to="/inventory"
              hint={`${v.ingredientCount} ingredients, ${v.menuItemCount} menu items`}
            />
            <StatCard label="Low or out of stock" value={v.lowOrOutCount} tone="warn" to="/inventory"
              hint="Needs restocking" />
            <StatCard label="Expiring soon" value={v.soonCount} tone="warn" to="/inventory/expiration"
              hint="Batches" />
            <StatCard label="Expired" value={v.expiredCount} tone="danger" to="/inventory/expiration"
              hint="Still on hand" />
            <StatCard label="Damaged or spoiled" value={v.losses7d} tone="danger" to="/inventory/damaged"
              hint="Entries in the last 7 days" />
          </div>

          <div className="panels">
            <div className="card panel">
              <h2>Needs restock</h2>
              {v.lowOrOut.length === 0 ? (
                <p className="muted">Everything is well stocked.</p>
              ) : (
                <ul className="list">
                  {v.lowOrOut.map((i) => (
                    <li key={i.id}>
                      <span>{i.name}, {i.stock} of {i.minLevel} {i.unit}</span>
                      <StatusBadge tone={STOCK_BADGE[i.status].tone}>{STOCK_BADGE[i.status].label}</StatusBadge>
                    </li>
                  ))}
                </ul>
              )}
              <Link to="/inventory">View inventory</Link>
            </div>

            <div className="card panel">
              <h2>Expiry alerts</h2>
              {v.expiryAlerts.length === 0 ? (
                <p className="muted">No batches are close to expiring.</p>
              ) : (
                <ul className="list">
                  {v.expiryAlerts.map((b) => (
                    <li key={`${b.batchCode}`}>
                      <span>
                        {b.itemName}, {b.qtyRemaining} {b.unit}
                        <br />
                        <small className="muted">
                          {b.itemType === 'ingredient' ? `${b.batchCode}, ` : ''}{fmtDate(b.expiryDate)}
                        </small>
                      </span>
                      <StatusBadge tone={EXPIRY_INFO[b.status].tone}>{EXPIRY_INFO[b.status].label}</StatusBadge>
                    </li>
                  ))}
                </ul>
              )}
              <Link to="/inventory/expiration">View expiration monitoring</Link>
            </div>

            <div className="card panel">
              <h2>Recent stock movements</h2>
              <ul className="list">
                {v.recentMovements.map((m) => (
                  <li key={m.id}>
                    <span>
                      {m.itemName}, {m.qty} {m.unit}
                      <br />
                      <small className="muted">
                        {m.itemType === 'ingredient' ? `${m.batchCode}, ` : ''}{fmtDateTime(m.createdAt)}
                      </small>
                    </span>
                    <StatusBadge tone={MOVE_TONE[m.type]}>{MOVE_LABEL[m.type]}</StatusBadge>
                  </li>
                ))}
              </ul>
              <Link to="/inventory/movements">View all logs</Link>
            </div>
          </div>
        </>
      )}
    </Gate>
  );
}