import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Boxes, UtensilsCrossed, CalendarClock, TriangleAlert, ShoppingCart, Receipt,} from 'lucide-react';
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
const ORDER_TYPE_LABEL = {
  dine_in: 'Dine in',
  takeaway: 'Takeaway',
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
function CashierMenuReadiness({ menuItems }) {
  const total = menuItems.length;
  const available = menuItems.filter((i) => i.status === 'in').length;
  const low = menuItems.filter((i) => i.status === 'low').length;
  const out = menuItems.filter((i) => i.status === 'out').length;
  const pct = (n) => (total > 0 ? Math.round((n / total) * 100) : 0);

  const catMap = new Map();
  for (const item of menuItems) {
    const key = item.category || 'Uncategorized';
    if (!catMap.has(key)) catMap.set(key, { name: key, total: 0, ready: 0 });
    const entry = catMap.get(key);
    entry.total += 1;
    if (item.status !== 'out') entry.ready += 1;
  }
  const cats = [...catMap.values()];

  return (
    <div className="card panel">
      <div className="chart-head">
        <div>
          <h2>Menu Availability</h2>
          <p className="chart-sub">Live dish &amp; tray readiness for counter orders</p>
        </div>
        <div className="chart-legend">
          <span><i className="dot dot-ok" /> Ready ({available})</span>
          <span><i className="dot dot-warn" /> Low ({low})</span>
          <span><i className="dot dot-danger" /> Sold out ({out})</span>
        </div>
      </div>

      <div className="stacked-track" role="img" aria-label={`Menu availability: ${available} ready, ${low} low, ${out} out`}>
        {available > 0 && <div className="seg seg-ok" style={{ width: `${pct(available)}%` }} />}
        {low > 0 && <div className="seg seg-warn" style={{ width: `${pct(low)}%` }} />}
        {out > 0 && <div className="seg seg-danger" style={{ width: `${Math.max(0, 100 - pct(available) - pct(low))}%` }} />}
      </div>

      {cats.length > 0 && (
        <div className="cat-grid" style={{ marginTop: 14 }}>
          {cats.map((c) => {
            const allOut = c.ready === 0;
            return (
              <div className="cat-chip" key={c.name}>
                <span className="cat-name">{c.name}</span>
                <span className={`cat-stat ${allOut ? 'is-alert' : 'is-ok'}`}>
                  {c.ready} of {c.total} orderable
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

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
  const batches = useAutoLoad(() => api.get('/batches?inStock=true'), []);

  const refreshAll = () => {
    sales.reload();
    sessions.reload();
    batches.reload();
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
      <Gate state={sessions}>{(d) => <SessionsToday sessions={d.sessions} />}</Gate>

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
                      <td className="batch-id">{row.batchCode}</td>
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

/* ---------- Statistical Graphs ---------- */
function StockHealthChart({ health, categories }) {
  const rows = [
    { key: 'overall', label: 'All Inventory', data: health.overall },
    { key: 'ingredients', label: 'Ingredients', data: health.ingredients },
    { key: 'menu', label: 'Menu Items', data: health.menu },
  ];

  const pct = (part, total) => (total > 0 ? Math.round((part / total) * 100) : 0);

  return (
    <div className="card panel">
      <div className="chart-head">
        <div>
          <h2>Stock Health Breakdown</h2>
          <p className="chart-sub">Availability across ingredients and daily menu items</p>
        </div>
        <div className="chart-legend">
          <span><i className="dot dot-ok" /> In stock</span>
          <span><i className="dot dot-warn" /> Low</span>
          <span><i className="dot dot-danger" /> Out</span>
        </div>
      </div>

      <div className="health-bars">
        {rows.map(({ key, label, data }) => {
          const okPct = pct(data.inStock, data.total);
          const lowPct = pct(data.low, data.total);
          const outPct = Math.max(0, 100 - okPct - lowPct);
          return (
            <div className="health-row" key={key}>
              <div className="health-meta">
                <strong>{label}</strong>
                <span>
                  {data.inStock} ok · {data.low} low · {data.out} out ({data.total})
                </span>
              </div>
              <div className="stacked-track" role="img" aria-label={`${label}: ${data.inStock} in stock, ${data.low} low, ${data.out} out`}>
                {data.inStock > 0 && (
                  <div className="seg seg-ok" style={{ width: `${okPct}%` }} title={`In stock: ${data.inStock}`} />
                )}
                {data.low > 0 && (
                  <div className="seg seg-warn" style={{ width: `${lowPct}%` }} title={`Low stock: ${data.low}`} />
                )}
                {data.out > 0 && (
                  <div className="seg seg-danger" style={{ width: `${outPct}%` }} title={`Out of stock: ${data.out}`} />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {categories?.length > 0 && (
        <div className="cat-breakdown">
          <div className="cat-title">By Category (Attention Needed)</div>
          <div className="cat-grid">
            {categories.map((c) => {
              const alerts = c.low + c.out;
              return (
                <div className="cat-chip" key={c.category}>
                  <span className="cat-name">{c.category}</span>
                  <span className={`cat-stat ${alerts > 0 ? 'is-alert' : 'is-ok'}`}>
                    {alerts > 0 ? `${alerts} of ${c.total} low/out` : `${c.total}/${c.total} stocked`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function MovementActivityChart({ days }) {
  const maxVal = Math.max(1, ...days.map((d) => Math.max(d.in, d.used, d.waste)));
  const totalIn = days.reduce((s, d) => s + d.in, 0);
  const totalUsed = days.reduce((s, d) => s + d.used, 0);
  const totalWaste = days.reduce((s, d) => s + d.waste, 0);
  const totalMoves = totalIn + totalUsed + totalWaste;
  const wasteRate = totalMoves > 0 ? Math.round((totalWaste / totalMoves) * 100) : 0;
  const avgPerDay = (totalMoves / Math.max(1, days.length)).toFixed(1);

  const peakDay = days.reduce((best, curr) => {
    const currSum = curr.in + curr.used + curr.waste;
    const bestSum = best ? best.in + best.used + best.waste : -1;
    return currSum > bestSum ? curr : best;
  }, null);
  const peakSum = peakDay ? peakDay.in + peakDay.used + peakDay.waste : 0;

  return (
    <div className="card panel activity-card">
      <div>
        <div className="chart-head">
          <div>
            <h2>7-Day Stock Activity</h2>
            <p className="chart-sub">Daily count of stock-ins, kitchen usage, and waste entries</p>
          </div>
          <div className="chart-legend">
            <span><i className="dot dot-ok" /> In ({totalIn})</span>
            <span><i className="dot dot-info" /> Used ({totalUsed})</span>
            <span><i className="dot dot-danger" /> Waste ({totalWaste})</span>
          </div>
        </div>

        <div className="bar-chart" role="img" aria-label="7-day stock movement bar chart">
          {days.map((d) => (
            <div className="bar-col" key={d.date}>
              <div className="bar-group">
                <div
                  className="bar bar-ok"
                  style={{ height: `${Math.max(d.in > 0 ? 8 : 2, Math.round((d.in / maxVal) * 100))}%` }}
                  title={`${d.label} Stock In: ${d.in}`}
                >
                  {d.in > 0 && <span>{d.in}</span>}
                </div>
                <div
                  className="bar bar-info"
                  style={{ height: `${Math.max(d.used > 0 ? 8 : 2, Math.round((d.used / maxVal) * 100))}%` }}
                  title={`${d.label} Used: ${d.used}`}
                >
                  {d.used > 0 && <span>{d.used}</span>}
                </div>
                <div
                  className="bar bar-danger"
                  style={{ height: `${Math.max(d.waste > 0 ? 8 : 2, Math.round((d.waste / maxVal) * 100))}%` }}
                  title={`${d.label} Damaged/Spoiled: ${d.waste}`}
                >
                  {d.waste > 0 && <span>{d.waste}</span>}
                </div>
              </div>
              <span className="bar-label">{d.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="activity-foot">
        <div className="activity-kpis">
          <div className="activity-kpi">
            <span className="activity-kpi-label">7-Day Total</span>
            <strong className="activity-kpi-val">{totalMoves}</strong>
          </div>
          <div className="activity-kpi">
            <span className="activity-kpi-label">Daily Avg</span>
            <strong className="activity-kpi-val">{avgPerDay}</strong>
          </div>
          <div className="activity-kpi">
            <span className="activity-kpi-label">Waste Share</span>
            <strong className={`activity-kpi-val ${wasteRate >= 25 ? 'is-danger' : ''}`}>{wasteRate}%</strong>
          </div>
          <div className="activity-kpi">
            <span className="activity-kpi-label">Busiest Day</span>
            <strong className="activity-kpi-val">
              {peakSum > 0 ? `${peakDay.label} (${peakSum})` : 'None'}
            </strong>
          </div>
        </div>

        <div className="activity-days-list" aria-label="Daily movement totals">
          {days.map((d) => {
            const sum = d.in + d.used + d.waste;
            return (
              <div className="activity-day-row" key={d.date}>
                <span className="activity-day-name">{d.label}</span>
                <span className="activity-day-counts">
                  <em className="c-in">+{d.in}</em> · <em className="c-used">{d.used} used</em> · <em className="c-waste">{d.waste} waste</em>
                </span>
                <strong className="activity-day-total">{sum}</strong>
              </div>
            );
          })}
        </div>
      </div>
    </div>
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