import { useMemo } from 'react';
import StatCard from '../StatCard';
import StatusBadge from '../StatusBadge';
import { formatMoney } from '../../utils/money';

function isInRange(dateValue, range) {
  if (!range || range === 'all' || !dateValue) return true;
  const ts = new Date(dateValue).getTime();
  if (Number.isNaN(ts)) return true;

  const now = new Date();
  if (range === 'today') {
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return ts >= startOfDay;
  }

  const days = range === '7d' ? 7 : range === '30d' ? 30 : null;
  if (!days) return true;
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  return ts >= cutoff;
}

export default function PerformanceReportTab({
  range = 'all',
  rangeLabel = 'All Time',
  sales,
  orders = [],
  movements = [],
  sessions = [],
  invDash,
}) {
  const filteredOrders = useMemo(
    () => (Array.isArray(orders) ? orders.filter((o) => isInRange(o.createdAt || o.created_at, range)) : []),
    [orders, range]
  );

  const filteredSessions = useMemo(
    () => (Array.isArray(sessions) ? sessions.filter((s) => isInRange(s.openedAt || s.opened_at, range)) : []),
    [sessions, range]
  );

  const filteredMovements = useMemo(
    () => (Array.isArray(movements) ? movements.filter((m) => isInRange(m.createdAt || m.date || m.created_at, range)) : []),
    [movements, range]
  );

  // Compute period-specific dish ranking from filtered orders (supporting both `items` and `lines`, and non-cancelled statuses)
  const topDishes = useMemo(() => {
    const map = new Map();
    filteredOrders
      .filter((o) => o.status !== 'cancelled' && o.status !== 'void')
      .forEach((o) => {
        const lines = Array.isArray(o.items) ? o.items : Array.isArray(o.lines) ? o.lines : [];
        lines.forEach((line) => {
          const name = line.itemName || line.name || line.item_name;
          if (!name) return;
          const qty = Number(line.qty ?? line.quantity ?? 0);
          if (qty > 0) {
            map.set(name, (map.get(name) || 0) + qty);
          }
        });
      });

    if (map.size > 0) {
      return Array.from(map.entries())
        .map(([name, qty]) => ({ name, qty }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 6);
    }

    if (Array.isArray(sales?.topSellers) && sales.topSellers.length > 0 && range === 'today') {
      return sales.topSellers.slice(0, 6);
    }
    return [];
  }, [filteredOrders, sales, range]);

  const maxQty = Math.max(1, ...topDishes.map((t) => Number(t.qty || 0)));
  const readiness =
    invDash?.totalItems > 0
      ? Math.round(((invDash.totalItems - invDash.lowOrOutCount) / invDash.totalItems) * 100)
      : 100;

  const periodLosses = filteredMovements.filter((m) => m.type === 'DAMAGED' || m.type === 'SPOILED').length;

  const cashierTotals = useMemo(() => {
    const map = new Map();
    filteredSessions.forEach((s) => {
      const key = s.cashier || s.cashierName || 'Unknown';
      if (!map.has(key)) {
        map.set(key, { cashier: key, sales: 0, orders: 0, shifts: 0 });
      }
      const row = map.get(key);
      row.sales += Number(s.netSales ?? s.net_sales ?? 0);
      row.orders += Number(s.orders ?? s.orderCount ?? 0);
      row.shifts += 1;
    });
    return Array.from(map.values()).sort((a, b) => b.sales - a.sales);
  }, [filteredSessions]);

  const maxCashierSales = Math.max(1, ...cashierTotals.map((c) => c.sales));

  return (
    <>
      <div className="stat-grid">
        <StatCard
          label="Stock readiness"
          value={`${readiness}%`}
          tone="ok"
          hint="Items above low-stock threshold"
        />
        <StatCard
          label="Top dish volume"
          value={topDishes[0] ? `${topDishes[0].qty} sold` : '0 sold'}
          tone="info"
          hint={topDishes[0]?.name || `No sales in ${rangeLabel.toLowerCase()}`}
        />
        <StatCard
          label="Shifts recorded"
          value={filteredSessions.length}
          tone="info"
          hint={`${rangeLabel} · Drawer sessions`}
        />
        <StatCard
          label="Loss incidents"
          value={periodLosses}
          tone="warn"
          hint={`${rangeLabel} · Spoilage & damage`}
        />
      </div>

      <div className="charts-grid">
        <div className="card panel">
          <h2>Menu Item Sales Ranking ({rangeLabel})</h2>
          <p className="chart-sub">Relative demand across top-selling dishes in the selected period</p>
          {topDishes.length === 0 ? (
            <p className="muted">No dish sales recorded in {rangeLabel.toLowerCase()}.</p>
          ) : (
            <div className="health-bars" style={{ marginTop: 14 }}>
              {topDishes.map((t) => {
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
          <h2>Cashier Sales Comparison ({rangeLabel})</h2>
          <p className="chart-sub">Net sales handled per cashier across shifts in this period</p>
          {cashierTotals.length === 0 ? (
            <p className="muted">No cashier shifts recorded in {rangeLabel.toLowerCase()}.</p>
          ) : (
            <div className="health-bars" style={{ marginTop: 14 }}>
              {cashierTotals.map((c) => {
                const pct = c.sales > 0 ? Math.round((c.sales / maxCashierSales) * 100) : 0;
                return (
                  <div className="health-row" key={c.cashier}>
                    <div className="health-meta">
                      <strong>{c.cashier}</strong>
                      <span>
                        {formatMoney(c.sales)} · {c.orders} orders ({c.shifts} {c.shifts === 1 ? 'shift' : 'shifts'})
                      </span>
                    </div>
                    <div className="stacked-track">
                      <div className="seg seg-info" style={{ width: `${Math.max(c.sales > 0 ? 8 : 0, pct)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {filteredSessions.length > 0 && (
            <ul className="list" style={{ marginTop: 14 }}>
              {filteredSessions.slice(0, 5).map((s) => {
                const net = Number(s.netSales ?? s.net_sales ?? 0);
                const ordCount = Number(s.orders ?? s.orderCount ?? 0);
                const diff = Number(s.cashDifference ?? s.cash_difference ?? 0);
                return (
                  <li key={s.id}>
                    <span>
                      <strong>{s.cashier || s.cashierName || 'Unknown'}</strong> · {ordCount} orders ({formatMoney(net)})
                      <br />
                      <small className="muted">
                        Expected: {formatMoney(s.expectedCash ?? s.expected_cash ?? 0)} · Counted:{' '}
                        {s.isOpen ? 'Open' : formatMoney(s.countedCash ?? s.counted_cash ?? 0)}
                      </small>
                    </span>
                    <StatusBadge tone={s.isOpen ? 'info' : diff === 0 ? 'ok' : 'danger'}>
                      {s.isOpen ? 'Open' : diff === 0 ? 'Balanced' : formatMoney(diff)}
                    </StatusBadge>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}