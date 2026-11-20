import { useMemo, useState } from 'react';
import { Download, RefreshCw, TrendingUp, Boxes, TriangleAlert, Award } from 'lucide-react';
import { api } from '../../api/client';
import { useAutoLoad } from '../../hooks/useAutoLoad';
import { useInventory } from '../../context/InventoryContext';
import StatCard from '../../components/StatCard';
import StatusBadge from '../../components/StatusBadge';
import { MOVE_LABEL, MOVE_TONE, TYPE_LABEL, stockStatus } from '../../utils/inventory';
import { fmtDate, fmtDateTime } from '../../utils/dates';
import { formatMoney } from '../../utils/money';

const TABS = [
  { id: 'sales', label: 'Sales & Financial', icon: TrendingUp },
  { id: 'inventory', label: 'Inventory & Usage', icon: Boxes },
  { id: 'waste', label: 'Waste & Loss', icon: TriangleAlert },
  { id: 'performance', label: 'Performance Analytics', icon: Award },
];

const RANGES = [
  { id: 'today', label: 'Today', days: 1 },
  { id: '7d', label: 'Last 7 Days', days: 7 },
  { id: '30d', label: 'Last 30 Days', days: 30 },
  { id: 'all', label: 'All Time', days: null },
];

function downloadCsv(filename, headers, rows) {
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Reports() {
  const [tab, setTab] = useState('sales');
  const [range, setRange] = useState('7d');

  const sales = useAutoLoad(() => api.get('/dashboard/sales'), []);
  const invDash = useAutoLoad(() => api.get('/dashboard/inventory'), []);
  const sessions = useAutoLoad(() => api.get('/sessions?date=today'), []);
  const ordersRes = useAutoLoad(() => api.get('/orders?limit=200').catch(() => ({ orders: [] })), []);
  const { items, batches, movements, refresh: refreshInv } = useInventory();

  const cutoff = useMemo(() => {
    const found = RANGES.find((r) => r.id === range);
    if (!found?.days) return null;
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (found.days - 1));
    return d;
  }, [range]);

  const filteredMovements = useMemo(() => {
    if (!cutoff) return movements;
    return movements.filter((m) => new Date(m.createdAt || m.date) >= cutoff);
  }, [movements, cutoff]);

  const filteredOrders = useMemo(() => {
    const list = ordersRes.data?.orders || [];
    if (!cutoff) return list;
    return list.filter((o) => new Date(o.createdAt || o.created_at) >= cutoff);
  }, [ordersRes.data, cutoff]);

  const handleRefresh = () => {
    sales.reload();
    invDash.reload();
    sessions.reload();
    ordersRes.reload();
    refreshInv();
  };

  const handleExport = () => {
    if (tab === 'sales') {
      const list = filteredOrders.length ? filteredOrders : (sales.data?.recentOrders || []);
      downloadCsv(
        `mamitas-sales-report-${range}.csv`,
        ['Order #', 'Type', 'Status', 'Total', 'Created At'],
        list.map((o) => [o.number || o.order_number, o.type || o.order_type || '-', o.status, o.total, o.createdAt || o.created_at])
      );
    } else if (tab === 'inventory') {
      downloadCsv(
        `mamitas-inventory-report-${range}.csv`,
        ['Item', 'Type', 'Category', 'On Hand', 'Usable', 'Unit', 'Min Level', 'Unit Price'],
        items.map((i) => [i.name, TYPE_LABEL[i.type], i.category, i.qtyOnHand, i.qtyUsable, i.unit, i.minLevel, i.price ?? 0])
      );
    } else if (tab === 'waste') {
      const losses = filteredMovements.filter((m) => m.type === 'DAMAGED' || m.type === 'SPOILED');
      downloadCsv(
        `mamitas-waste-report-${range}.csv`,
        ['Date', 'Item', 'Batch', 'Type', 'Qty', 'Unit', 'Reason', 'Recorded By'],
        losses.map((m) => [m.createdAt, m.itemName, m.batchCode, MOVE_LABEL[m.type], m.qty, m.unit, m.reason, m.recordedBy])
      );
    } else {
      const top = sales.data?.topSellers || [];
      downloadCsv(
        `mamitas-performance-report-${range}.csv`,
        ['Rank', 'Menu Item', 'Units Sold'],
        top.map((t, idx) => [idx + 1, t.name, t.qty])
      );
    }
  };

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Reports &amp; Analytics</h1>
          <p className="muted" style={{ margin: 0 }}>
            Financial summaries, stock consumption, spoilage tracking, and kitchen/counter performance.
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleRefresh}>
            <RefreshCw size={15} aria-hidden="true" /> Refresh
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={handleExport}>
            <Download size={15} aria-hidden="true" /> Export CSV
          </button>
        </div>
      </div>

      <div className="admin-bar">
        <div className="chips" role="tablist" aria-label="Report categories" style={{ marginBottom: 0 }}>
          {TABS.map((t) => {
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

        <div className="segmented" role="group" aria-label="Date range">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-checked={range === r.id}
              onClick={() => setRange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'sales' && (
        <SalesReport
          sales={sales.data}
          sessions={sessions.data?.sessions || []}
          orders={filteredOrders}
        />
      )}
      {tab === 'inventory' && (
        <InventoryUsageReport
          items={items}
          movements={filteredMovements}
          invDash={invDash.data}
        />
      )}
      {tab === 'waste' && (
        <WasteLossReport
          movements={filteredMovements}
          batches={batches}
          invDash={invDash.data}
        />
      )}
      {tab === 'performance' && (
        <PerformanceReport
          sales={sales.data}
          sessions={sessions.data?.sessions || []}
          invDash={invDash.data}
        />
      )}
    </section>
  );
}

function SalesReport({ sales, sessions, orders }) {
  const s = sales || { todaySales: 0, todayOrders: 0, averageOrder: 0, recentOrders: [] };
  const list = orders.length ? orders : s.recentOrders;
  const completed = list.filter((o) => o.status === 'completed');
  const rangeTotal = completed.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const displayRevenue = orders.length ? rangeTotal : s.todaySales;
  const displayCount = orders.length ? completed.length : s.todayOrders;
  const displayAvg = displayCount > 0 ? displayRevenue / displayCount : s.averageOrder;

  const cashTotal = sessions.reduce((sum, x) => sum + Number(x.cashSales || 0), 0);
  const paynowTotal = sessions.reduce((sum, x) => sum + Number(x.paynowSales || 0), 0);
  const cardTotal = sessions.reduce((sum, x) => sum + Number(x.cardSales || 0), 0);
  const paySum = Math.max(1, cashTotal + paynowTotal + cardTotal);

  return (
    <>
      <div className="stat-grid">
        <StatCard label="Gross sales" value={formatMoney(displayRevenue)} tone="ok" hint="Completed orders" />
        <StatCard label="Completed orders" value={displayCount} tone="info" hint="Paid transactions" />
        <StatCard label="Average ticket" value={formatMoney(displayAvg)} tone="info" hint="Per order" />
        <StatCard label="Active sessions" value={sessions.filter((x) => x.isOpen).length} tone="warn" hint="Open registers today" />
      </div>

      <div className="charts-grid">
        <div className="card panel">
          <h2>Payment Channel Mix (Today)</h2>
          <p className="chart-sub">Settlement breakdown across cash drawer and digital channels</p>
          <div className="health-bars" style={{ marginTop: 14 }}>
            {[
              { label: 'Cash', val: cashTotal, cls: 'seg-ok' },
              { label: 'PayNow', val: paynowTotal, cls: 'seg-info' },
              { label: 'Card', val: cardTotal, cls: 'seg-warn' },
            ].map((ch) => {
              const pct = cashTotal + paynowTotal + cardTotal > 0 ? Math.round((ch.val / paySum) * 100) : 0;
              return (
                <div className="health-row" key={ch.label}>
                  <div className="health-meta">
                    <strong>{ch.label}</strong>
                    <span>{formatMoney(ch.val)} ({pct}%)</span>
                  </div>
                  <div className="stacked-track">
                    <div className={`seg ${ch.cls}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card panel">
          <h2>Recent Financial Transactions</h2>
          {list.length === 0 ? (
            <p className="muted">No orders found in this period.</p>
          ) : (
            <ul className="list">
              {list.slice(0, 6).map((o) => (
                <li key={o.id}>
                  <span>
                    Order #{o.number || o.order_number} · <strong>{formatMoney(o.total)}</strong>
                    <br />
                    <small className="muted">{fmtDateTime(o.createdAt || o.created_at)}</small>
                  </span>
                  <StatusBadge tone={o.status === 'completed' ? 'ok' : 'info'}>
                    {o.status === 'completed' ? 'Completed' : 'Preparing'}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

function InventoryUsageReport({ items, movements, invDash }) {
  const inCount = movements.filter((m) => m.type === 'IN').length;
  const usedCount = movements.filter((m) => m.type === 'USED').length;
  const adjCount = movements.filter((m) => m.type === 'ADJUSTMENT').length;
  const menuValue = items
    .filter((i) => i.type !== 'ingredient')
    .reduce((sum, i) => sum + Number(i.qtyUsable || 0) * Number(i.price || 0), 0);

  return (
    <>
      <div className="stat-grid">
        <StatCard label="Stock-in entries" value={inCount} tone="ok" hint="In selected period" />
        <StatCard label="Usage entries" value={usedCount} tone="info" hint="Kitchen & POS deductions" />
        <StatCard label="Stock adjustments" value={adjCount} tone="warn" hint="Manual count corrections" />
        <StatCard label="Ready menu retail value" value={formatMoney(menuValue)} tone="ok" hint="Current usable servings & trays" />
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Type</th>
              <th>Category</th>
              <th className="num">On Hand</th>
              <th className="num">Usable</th>
              <th className="num">Min Level</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan="7" className="empty">No inventory items available.</td></tr>
            )}
            {items.slice(0, 25).map((i) => {
              const stock = i.type === 'ingredient' ? i.qtyOnHand : i.qtyUsable;
              const st = stockStatus(stock, i.minLevel);
              return (
                <tr key={i.id}>
                  <td>{i.name}</td>
                  <td>{TYPE_LABEL[i.type]}</td>
                  <td>{i.category}</td>
                  <td className="num">{i.qtyOnHand} {i.unit}</td>
                  <td className="num">{i.qtyUsable} {i.unit}</td>
                  <td className="num">{i.minLevel} {i.unit}</td>
                  <td><StatusBadge tone={st.tone}>{st.label}</StatusBadge></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {invDash?.categories?.length > 0 && (
        <p className="muted" style={{ marginTop: 10 }}>
          Showing top 25 active items across {invDash.categories.length} categories. Use Export CSV for the full ledger.
        </p>
      )}
    </>
  );
}

function WasteLossReport({ movements, batches, invDash }) {
  const losses = movements.filter((m) => m.type === 'DAMAGED' || m.type === 'SPOILED');
  const damaged = losses.filter((m) => m.type === 'DAMAGED').length;
  const spoiled = losses.filter((m) => m.type === 'SPOILED').length;
  const expiredOnHand = batches.filter((b) => b.qty > 0 && b.expiry && new Date(b.expiry) < new Date()).length;

  return (
    <>
      <div className="stat-grid">
        <StatCard label="Total loss entries" value={losses.length} tone="danger" hint="Damaged + Spoiled" />
        <StatCard label="Damaged entries" value={damaged} tone="danger" hint="Prep & handling loss" />
        <StatCard label="Spoiled entries" value={spoiled} tone="warn" hint="Expired / quality write-offs" />
        <StatCard label="Unwritten expired batches" value={invDash?.expiredCount ?? expiredOnHand} tone="danger" hint="Pending write-off" />
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Date &amp; Time</th>
              <th>Item</th>
              <th>Batch</th>
              <th>Loss Type</th>
              <th className="num">Quantity</th>
              <th>Reason</th>
              <th>Recorded By</th>
            </tr>
          </thead>
          <tbody>
            {losses.length === 0 && (
              <tr><td colSpan="7" className="empty">No damaged or spoiled entries in this period.</td></tr>
            )}
            {losses.slice(0, 25).map((m) => (
              <tr key={m.id}>
                <td>{fmtDateTime(m.createdAt)}</td>
                <td>{m.itemName}</td>
                <td className="batch-id">{m.batchCode || '-'}</td>
                <td><StatusBadge tone={MOVE_TONE[m.type]}>{MOVE_LABEL[m.type]}</StatusBadge></td>
                <td className="num">{m.qty} {m.unit}</td>
                <td>{m.reason || 'No reason noted'}</td>
                <td>{m.recordedBy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PerformanceReport({ sales, sessions, invDash }) {
  const top = sales?.topSellers || [];
  const maxQty = Math.max(1, ...top.map((t) => Number(t.qty || 0)));
  const readiness = invDash?.totalItems > 0
    ? Math.round(((invDash.totalItems - invDash.lowOrOutCount) / invDash.totalItems) * 100)
    : 100;

  return (
    <>
      <div className="stat-grid">
        <StatCard label="Stock readiness" value={`${readiness}%`} tone="ok" hint="Items above low-stock threshold" />
        <StatCard label="Top dish volume" value={top[0] ? `${top[0].qty} sold` : '0 sold'} tone="info" hint={top[0]?.name || 'No sales yet'} />
        <StatCard label="Shifts recorded today" value={sessions.length} tone="info" hint="Cashier drawer sessions" />
        <StatCard label="7-day loss incidents" value={invDash?.losses7d ?? 0} tone="warn" hint="Spoilage & damage count" />
      </div>

      <div className="charts-grid">
        <div className="card panel">
          <h2>Menu Item Sales Ranking</h2>
          <p className="chart-sub">Relative demand across top-selling dishes today</p>
          {top.length === 0 ? (
            <p className="muted">No dish sales recorded yet today.</p>
          ) : (
            <div className="health-bars" style={{ marginTop: 14 }}>
              {top.map((t) => {
                const pct = Math.round((Number(t.qty || 0) / maxQty) * 100);
                return (
                  <div className="health-row" key={t.name}>
                    <div className="health-meta">
                      <strong>{t.name}</strong>
                      <span>{t.qty} sold</span>
                    </div>
                    <div className="stacked-track">
                      <div className="seg seg-ok" style={{ width: `${Math.max(8, pct)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card panel">
          <h2>Cashier Shift Reconciliation</h2>
          {sessions.length === 0 ? (
            <p className="muted">No cashier shifts opened today.</p>
          ) : (
            <ul className="list">
              {sessions.map((s) => (
                <li key={s.id}>
                  <span>
                    <strong>{s.cashier}</strong> · {s.orders} orders ({formatMoney(s.netSales)})
                    <br />
                    <small className="muted">
                      Expected: {formatMoney(s.expectedCash)} · Counted: {s.isOpen ? 'Open' : formatMoney(s.countedCash)}
                    </small>
                  </span>
                  <StatusBadge tone={s.isOpen ? 'info' : s.cashDifference === 0 ? 'ok' : 'danger'}>
                    {s.isOpen ? 'Open' : s.cashDifference === 0 ? 'Balanced' : formatMoney(s.cashDifference)}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}