import { useMemo } from 'react';
import StatCard from '../StatCard';
import StatusBadge from '../StatusBadge';
import { TYPE_LABEL, stockStatus } from '../../utils/inventory';
import { formatMoney } from '../../utils/money';

export default function InventoryUsageReportTab({ rangeLabel, items, movements, invDash }) {
  const inCount = movements.filter((m) => m.type === 'IN').length;
  const usedCount = movements.filter((m) => m.type === 'USED').length;
  const adjCount = movements.filter((m) => m.type === 'ADJUSTMENT').length;
  const totalMoves = Math.max(1, inCount + usedCount + adjCount);

  const menuValue = items
    .filter((i) => i.type !== 'ingredient')
    .reduce((sum, i) => sum + Number(i.qtyUsable || 0) * Number(i.price || 0), 0);

  const topUsedItems = useMemo(() => {
    const map = new Map();
    movements
      .filter((m) => m.type === 'USED')
      .forEach((m) => {
        const key = m.itemName;
        if (!map.has(key)) map.set(key, { name: key, unit: m.unit, qty: 0, count: 0 });
        const row = map.get(key);
        row.qty += Number(m.qty || 0);
        row.count += 1;
      });
    return Array.from(map.values())
      .sort((a, b) => b.count - a.count || b.qty - a.qty)
      .slice(0, 6);
  }, [movements]);

  const maxUsedCount = Math.max(1, ...topUsedItems.map((x) => x.count));

  return (
    <>
      <div className="stat-grid">
        <StatCard label="Stock-in entries" value={inCount} tone="ok" hint={rangeLabel} />
        <StatCard label="Usage entries" value={usedCount} tone="info" hint="Kitchen & POS deductions" />
        <StatCard label="Stock adjustments" value={adjCount} tone="warn" hint="Manual count corrections" />
        <StatCard label="Ready menu retail value" value={formatMoney(menuValue)} tone="ok" hint="Current usable servings & trays" />
      </div>

      <div className="charts-grid" style={{ marginBottom: 16 }}>
        <div className="card panel">
          <h2>Stock Movement Mix ({rangeLabel})</h2>
          <p className="chart-sub">Proportion of stock-ins, usage deductions, and count adjustments</p>
          <div className="health-bars" style={{ marginTop: 14 }}>
            {[
              { label: 'Stock In', val: inCount, cls: 'seg-ok' },
              { label: 'Used (Kitchen / POS)', val: usedCount, cls: 'seg-info' },
              { label: 'Adjustments', val: adjCount, cls: 'seg-warn' },
            ].map((row) => {
              const pct = inCount + usedCount + adjCount > 0 ? Math.round((row.val / totalMoves) * 100) : 0;
              return (
                <div className="health-row" key={row.label}>
                  <div className="health-meta">
                    <strong>{row.label}</strong>
                    <span>{row.val} entries ({pct}%)</span>
                  </div>
                  <div className="stacked-track">
                    <div className={`seg ${row.cls}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card panel">
          <h2>Most Consumed Items ({rangeLabel})</h2>
          <p className="chart-sub">Top items by kitchen &amp; counter usage frequency</p>
          {topUsedItems.length === 0 ? (
            <p className="muted">No usage deductions recorded in {rangeLabel.toLowerCase()}.</p>
          ) : (
            <div className="health-bars" style={{ marginTop: 14 }}>
              {topUsedItems.map((item) => {
                const pct = Math.round((item.count / maxUsedCount) * 100);
                return (
                  <div className="health-row" key={item.name}>
                    <div className="health-meta">
                      <strong>{item.name}</strong>
                      <span>{Math.round(item.qty * 100) / 100} {item.unit} ({item.count}x)</span>
                    </div>
                    <div className="stacked-track">
                      <div className="seg seg-info" style={{ width: `${Math.max(8, pct)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
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