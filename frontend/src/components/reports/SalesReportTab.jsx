import { useMemo } from 'react';
import StatCard from '../StatCard';
import StatusBadge from '../StatusBadge';
import { buildTimeBuckets } from './reportCharts';
import { fmtDateTime } from '../../utils/dates';
import { formatMoney } from '../../utils/money';

export default function SalesReportTab({ range, rangeLabel, sales, sessions, orders }) {
  const s = sales || { todaySales: 0, todayOrders: 0, averageOrder: 0, recentOrders: [] };

  const list = orders;
  const completed = list.filter((o) => o.status === 'completed');

  const displayRevenue =
    range === 'today' && completed.length === 0 && Number(s.todaySales) > 0
      ? Number(s.todaySales)
      : completed.reduce((sum, o) => sum + Number(o.total || 0), 0);

  const displayCount =
    range === 'today' && completed.length === 0 && Number(s.todayOrders) > 0
      ? Number(s.todayOrders)
      : completed.length;

  const displayAvg =
    displayCount > 0
      ? displayRevenue / displayCount
      : range === 'today'
        ? Number(s.averageOrder || 0)
        : 0;

  const cashTotal = sessions.reduce((sum, x) => sum + Number(x.cashSales || 0), 0);
  const paynowTotal = sessions.reduce((sum, x) => sum + Number(x.paynowSales || 0), 0);
  const cardTotal = sessions.reduce((sum, x) => sum + Number(x.cardSales || 0), 0);
  const paySum = Math.max(1, cashTotal + paynowTotal + cardTotal);

  const buckets = useMemo(
    () => buildTimeBuckets(range, completed, (o) => o.createdAt || o.created_at, (o) => o.total),
    [range, completed]
  );
  const maxVal = Math.max(1, ...buckets.map((b) => b.value));

  return (
    <>
      <div className="stat-grid">
        <StatCard label="Gross sales" value={formatMoney(displayRevenue)} tone="ok" hint={`${rangeLabel} · Completed orders`} />
        <StatCard label="Completed orders" value={displayCount} tone="info" hint="Paid transactions" />
        <StatCard label="Average ticket" value={formatMoney(displayAvg)} tone="info" hint="Per completed order" />
        <StatCard label="Cashier sessions" value={sessions.length} tone="warn" hint={`${sessions.filter((x) => x.isOpen).length} open now`} />
      </div>

      <div className="card panel" style={{ marginBottom: 16 }}>
        <div className="chart-head">
          <div>
            <h2>Sales Revenue Trend ({rangeLabel})</h2>
            <p className="chart-sub">Completed order revenue and order count across the selected period</p>
          </div>
          <div className="chart-legend">
            <span><i className="dot dot-ok" /> Revenue ({formatMoney(displayRevenue)})</span>
          </div>
        </div>

        {buckets.length === 0 ? (
          <p className="muted">No sales data available for {rangeLabel.toLowerCase()}.</p>
        ) : (
          <div className="bar-chart" style={{ paddingTop: 26 }}>
            {buckets.map((b) => {
              const pct = Math.max(b.value > 0 ? 10 : 3, Math.min(100, Math.round((b.value / maxVal) * 100)));
              return (
                <div className="bar-col" key={b.key}>
                  <div className="bar-group">
                    <div
                      className="bar bar-ok"
                      style={{ height: `${pct}%`, minWidth: 22 }}
                      title={`${b.label}: ${formatMoney(b.value)} (${b.count} orders)`}
                    >
                      {b.value > 0 && <span style={{ fontSize: '0.68rem' }}>{Math.round(b.value)}</span>}
                    </div>
                  </div>
                  <span className="bar-label">{b.label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="charts-grid">
        <div className="card panel">
          <h2>Payment Channel Mix ({rangeLabel})</h2>
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
          <h2>Transactions ({rangeLabel})</h2>
          {list.length === 0 ? (
            <p className="muted">No orders found in {rangeLabel.toLowerCase()}.</p>
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