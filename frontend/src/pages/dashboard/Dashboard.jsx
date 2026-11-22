import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  RefreshCw,
  Boxes,
  UtensilsCrossed,
  CalendarClock,
  TriangleAlert,
  ShoppingCart,
  Receipt,
} from 'lucide-react';
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
import CashierMenuReadiness from '../../components/dashboard/CashierMenuReadiness';
import StockHealthChart from '../../components/dashboard/StockHealthChart';
import MovementActivityChart from '../../components/dashboard/MovementActivityChart';
import { MOVE_LABEL, MOVE_TONE, EXPIRY_INFO } from '../../utils/inventory';
import { fmtDate, fmtDateTime } from '../../utils/dates';
import { fmtDayTime } from '../../utils/time';
import { formatMoney } from '../../utils/money';

const ORDER_STATUS = {
  preparing: { label: 'Preparing', tone: 'info' },
  completed: { label: 'Completed', tone: 'ok' },
};
const ORDER_TYPE_LABEL = {
  dine_in: 'Dine in',
  takeaway: 'Takeaway',
};
const STOCK_BADGE = {
  out: { label: 'Out of stock', tone: 'danger' },
  low: { label: 'Low stock', tone: 'warn' },
};
const itemsText = (n) => `${n} ${n === 1 ? 'item' : 'items'}`;

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
  return <KitchenOverview user={user} />;
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
                Order #{o.number} · {formatMoney(o.total)}
                {o.type && ORDER_TYPE_LABEL[o.type] ? ` (${ORDER_TYPE_LABEL[o.type]})` : ''}
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
  const { menuItems, refresh: refreshMenu } = useOrders();
  const { session, ready, refresh: refreshSession } = useSession();
  const [closing, setClosing] = useState(null);

  const running = menuItems
    .filter((i) => i.status !== 'in')
    .sort((a, b) => (a.status === 'out' ? -1 : 1) - (b.status === 'out' ? -1 : 1));
  const orderableCount = menuItems.filter((i) => i.status !== 'out').length;

  const handleRefresh = () => {
    sales.reload();
    refreshMenu();
    refreshSession();
  };

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Cashier Dashboard</h1>
          <p className="muted" style={{ margin: 0 }}>
            Welcome back, {user.name}. {session ? 'Your register is open and ready for orders.' : 'Open your cash drawer to start taking orders.'}
          </p>
        </div>
        <div className="actions">
          {session && (
            <Link to="/orders" className="btn btn-primary btn-sm">
              <ShoppingCart size={16} aria-hidden="true" /> New Order
            </Link>
          )}
          <Link to="/orders/history" className="btn btn-secondary btn-sm">
            <Receipt size={16} aria-hidden="true" /> Order History
          </Link>
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleRefresh}>
            <RefreshCw size={15} aria-hidden="true" /> Refresh
          </button>
        </div>
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
                label={session ? 'Shift sales' : 'Sales today'}
                value={formatMoney(session ? session.netSales : s.todaySales)}
                tone="ok"
                to="/orders/history"
                hint={session ? `${session.orders} orders this shift` : `${s.todayOrders} orders today`}
              />
              <StatCard
                label="Still preparing"
                value={s.preparingCount}
                tone="warn"
                to="/orders/history"
                hint="Not yet handed over"
              />
              <StatCard
                label="Menu orderable"
                value={`${orderableCount} / ${menuItems.length}`}
                tone="info"
                to="/orders"
                hint="Available to sell right now"
              />
              <StatCard
                label="Menu running low"
                value={running.length}
                tone="warn"
                to="/orders"
                hint="Low or sold out"
              />
            </div>

            {menuItems.length > 0 && (
              <div className="charts-grid">
                <CashierMenuReadiness menuItems={menuItems} />
                <div className="card panel">
                  <div className="chart-head">
                    <div>
                      <h2>Top Sellers Today</h2>
                      <p className="chart-sub">Most ordered dishes across the counter</p>
                    </div>
                  </div>
                  {s.topSellers.length === 0 ? (
                    <p className="muted">No sales recorded yet today.</p>
                  ) : (
                    <ul className="list">
                      {s.topSellers.map((t, idx) => (
                        <li key={t.name}>
                          <span>
                            <strong>#{idx + 1}</strong> {t.name}
                          </span>
                          <StatusBadge tone="ok">{t.qty} sold</StatusBadge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

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
                          {o.type && ORDER_TYPE_LABEL[o.type] ? ` · ${ORDER_TYPE_LABEL[o.type]}` : ''}
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

function SessionsToday({ sessions, onCloseSession }) {
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
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 && (
              <tr><td colSpan="9" className="empty">No sessions today.</td></tr>
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
                <td>
                  {s.isOpen ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => onCloseSession(s)}
                    >
                      Close session
                    </button>
                  ) : (
                    <span className="muted">-</span>
                  )}
                </td>
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
  const batches = useAutoLoad(() => api.get('/batches?inStock=true'), []);
  const { refresh: refreshSession } = useSession();
  const [closingSession, setClosingSession] = useState(null);

  const refreshAll = () => {
    sales.reload();
    sessions.reload();
    batches.reload();
    refreshSession();
  };

  const handleCloseModalDone = () => {
    setClosingSession(null);
    refreshAll();
  };

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Unified Operational View</h1>
          <p className="muted" style={{ margin: 0 }}>
            Real-time overview across counter sales, active orders, cashier shifts, and kitchen inventory.
          </p>
        </div>
        <div className="actions">
          <Link to="/reports" className="btn btn-primary btn-sm">Reports &amp; Analytics</Link>
          <Link to="/admin" className="btn btn-secondary btn-sm">Administration</Link>
          <button type="button" className="btn btn-secondary btn-sm" onClick={refreshAll}>
            <RefreshCw size={15} aria-hidden="true" /> Refresh All
          </button>
        </div>
      </div>

      <Gate state={sales}>
        {(s) => (
          <>
            <div className="stat-grid">
              <StatCard label="Sales today" value={formatMoney(s.todaySales)} tone="ok" to="/orders/history" />
              <StatCard label="Orders today" value={s.todayOrders} tone="info" to="/orders/history" />
              <StatCard label="Average order" value={formatMoney(s.averageOrder)} tone="info" to="/reports" />
              <StatCard
                label="Active / preparing" value={s.preparingCount} tone="warn"
                to="/orders/history" hint="In kitchen queue right now"
              />
            </div>

            <div className="panels">
              <div className="card panel">
                <h2>Active orders queue</h2>
                {s.preparingOrders.length === 0 ? (
                  <p className="muted">No orders currently preparing.</p>
                ) : (
                  <ul className="list">
                    {s.preparingOrders.map((o) => (
                      <li key={o.id}>
                        <span>
                          Order #{o.number}
                          {o.type && ORDER_TYPE_LABEL[o.type] ? ` · ${ORDER_TYPE_LABEL[o.type]}` : ''}
                          <br />
                          <small className="muted">{itemsText(o.itemCount)} · {fmtDateTime(o.createdAt)}</small>
                        </span>
                        <StatusBadge tone="info">Preparing</StatusBadge>
                      </li>
                    ))}
                  </ul>
                )}
                <Link to="/orders/history">Manage active orders</Link>
              </div>

              <div className="card panel">
                <h2>Top sellers today</h2>
                {s.topSellers.length === 0 ? (
                  <p className="muted">No sales yet today.</p>
                ) : (
                  <ul className="list">
                    {s.topSellers.map((t, idx) => (
                      <li key={t.name}>
                        <span><strong>#{idx + 1}</strong> {t.name}</span>
                        <StatusBadge tone="ok">{t.qty} sold</StatusBadge>
                      </li>
                    ))}
                  </ul>
                )}
                <Link to="/reports">View full sales report</Link>
              </div>

              <RecentOrders orders={s.recentOrders} />
            </div>
          </>
        )}
      </Gate>

      <div className="section-head">
        <h2>Live cashier sessions today</h2>
      </div>
      <Gate state={sessions}>
        {(d) => <SessionsToday sessions={d.sessions} onCloseSession={setClosingSession} />}
      </Gate>

      {closingSession && (
        <CloseSessionModal session={closingSession} onClose={handleCloseModalDone} />
      )}

      <div className="section-head">
        <h2>Active stock batches</h2>
      </div>
      <Gate state={batches}>
        {(b) => {
          const list = (b.batches || []).slice(0, 6);
          return (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Batch</th>
                    <th>Item</th>
                    <th>Category</th>
                    <th className="num">Remaining</th>
                    <th>Received</th>
                    <th>Expiry</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {list.length === 0 && (
                    <tr><td colSpan="7" className="empty">No active batches in stock.</td></tr>
                  )}
                  {list.map((row) => (
                    <tr key={row.id}>
                      <td className="batch-id">{row.code || row.batchCode || '-'}</td>
                      <td>{row.itemName}</td>
                      <td>{row.category}</td>
                      <td className="num">{row.qtyRemaining} {row.unit}</td>
                      <td>{fmtDate(row.receivedDate)}</td>
                      <td>{row.expiryDate ? fmtDate(row.expiryDate) : 'No expiry'}</td>
                      <td>
                        <StatusBadge tone={EXPIRY_INFO[row.expiryStatus]?.tone || 'ok'}>
                          {EXPIRY_INFO[row.expiryStatus]?.label || 'OK'}
                        </StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }}
      </Gate>

      <div className="section-head">
        <h2>Inventory levels &amp; alerts</h2>
      </div>
      <InventoryContent />
    </section>
  );
}

/* ---------- Kitchen ---------- */
function KitchenOverview({ user }) {
  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Kitchen Dashboard</h1>
          <p className="muted" style={{ margin: 0 }}>
            Welcome back, {user.name}. Track prep stock, batch expirations, and kitchen usage.
          </p>
        </div>
        <div className="actions">
          <Link to="/inventory" className="btn btn-primary btn-sm">
            <Boxes size={16} aria-hidden="true" /> Inventory Stock
          </Link>
          <Link to="/inventory/menu" className="btn btn-secondary btn-sm">
            <UtensilsCrossed size={16} aria-hidden="true" /> Menu Stock
          </Link>
          <Link to="/inventory/expiration" className="btn btn-secondary btn-sm">
            <CalendarClock size={16} aria-hidden="true" /> Expirations
          </Link>
          <Link to="/inventory/damaged" className="btn btn-secondary btn-sm">
            <TriangleAlert size={16} aria-hidden="true" /> Record Loss
          </Link>
        </div>
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
      {(v) => {
        const healthyCount = Math.max(0, v.totalItems - v.lowOrOutCount);
        const healthyPct = v.totalItems > 0 ? Math.round((healthyCount / v.totalItems) * 100) : 100;

        return (
          <>
            <div className="dash-toolbar">
              <span className="muted-inline">
                Stock readiness: <strong>{healthyPct}%</strong> ({healthyCount} of {v.totalItems} items well stocked)
              </span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={inv.reload}>
                <RefreshCw size={15} aria-hidden="true" /> Refresh
              </button>
            </div>

            <div className="stat-grid">
              <StatCard
                label="Total items" value={v.totalItems} tone="info" to="/inventory"
                hint={`${v.ingredientCount} ingredients, ${v.menuItemCount} menu items`}
              />
              <StatCard
                label="Low or out of stock" value={v.lowOrOutCount} tone="warn" to="/inventory"
                hint="Needs restocking"
              />
              <StatCard
                label="Expiring soon" value={v.soonCount} tone="warn" to="/inventory/expiration"
                hint="Within 3 days"
              />
              <StatCard
                label="Expired" value={v.expiredCount} tone="danger" to="/inventory/expiration"
                hint="Still on hand"
              />
              <StatCard
                label="Damaged or spoiled" value={v.losses7d} tone="danger" to="/inventory/damaged"
                hint="Entries in the last 7 days"
              />
            </div>

            {v.stockHealth && v.dailyMovements && (
              <div className="charts-grid">
                <StockHealthChart health={v.stockHealth} categories={v.categories} />
                <MovementActivityChart days={v.dailyMovements} />
              </div>
            )}

            <div className="panels">
              <div className="card panel">
                <h2>Needs restock</h2>
                {v.lowOrOut.length === 0 ? (
                  <p className="muted">Everything is well stocked.</p>
                ) : (
                  <ul className="list">
                    {v.lowOrOut.map((i) => {
                      const ratio = i.minLevel > 0 ? Math.min(100, Math.round((i.stock / i.minLevel) * 100)) : 0;
                      return (
                        <li key={i.id}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div>{i.name}, {i.stock} of {i.minLevel} {i.unit}</div>
                            <div className="mini-meter">
                              <span
                                className={i.status === 'out' ? 'is-out' : 'is-low'}
                                style={{ width: `${i.stock <= 0 ? 100 : Math.max(12, ratio)}%` }}
                              />
                            </div>
                          </div>
                          <StatusBadge tone={STOCK_BADGE[i.status].tone}>{STOCK_BADGE[i.status].label}</StatusBadge>
                        </li>
                      );
                    })}
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
                      <li key={b.batchCode}>
                        <span>
                          {b.itemName}, {b.qtyRemaining} {b.unit}
                          <br />
                          <small className="muted">
                            {b.itemType === 'ingredient' ? `${b.batchCode} · ` : ''}
                            {fmtDate(b.expiryDate)}
                            {typeof b.daysLeft === 'number'
                              ? b.daysLeft < 0
                                ? ` (${Math.abs(b.daysLeft)}d overdue)`
                                : b.daysLeft === 0
                                  ? ' (Today)'
                                  : ` (${b.daysLeft}d left)`
                              : ''}
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
                {v.recentMovements.length === 0 ? (
                  <p className="muted">No recent stock movements.</p>
                ) : (
                  <ul className="list">
                    {v.recentMovements.map((m) => (
                      <li key={m.id}>
                        <span>
                          {m.itemName}, {m.qty} {m.unit}
                          <br />
                          <small className="muted">
                            {m.itemType === 'ingredient' ? `${m.batchCode} · ` : ''}{fmtDateTime(m.createdAt)}
                          </small>
                        </span>
                        <StatusBadge tone={MOVE_TONE[m.type]}>{MOVE_LABEL[m.type]}</StatusBadge>
                      </li>
                    ))}
                  </ul>
                )}
                <Link to="/inventory/movements">View all logs</Link>
              </div>
            </div>
          </>
        );
      }}
    </Gate>
  );
}