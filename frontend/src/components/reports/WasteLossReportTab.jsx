import { useMemo } from 'react';
import StatCard from '../StatCard';
import StatusBadge from '../StatusBadge';
import { MOVE_LABEL, MOVE_TONE } from '../../utils/inventory';
import { fmtDateTime } from '../../utils/dates';

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

export default function WasteLossReportTab({
  range = 'all',
  rangeLabel = 'All Time',
  movements = [],
  batches = [],
  invDash,
}) {
  const filteredMovements = useMemo(
    () =>
      Array.isArray(movements)
        ? movements.filter((m) => isInRange(m.createdAt ?? m.created_at ?? m.date, range))
        : [],
    [movements, range]
  );

  const losses = useMemo(
    () =>
      filteredMovements.filter((m) => {
        const kind = String(m.type ?? m.movement_type ?? '').toUpperCase();
        return kind === 'DAMAGED' || kind === 'SPOILED';
      }),
    [filteredMovements]
  );

  const damaged = losses.filter(
    (m) => String(m.type ?? m.movement_type ?? '').toUpperCase() === 'DAMAGED'
  ).length;
  const spoiled = losses.filter(
    (m) => String(m.type ?? m.movement_type ?? '').toUpperCase() === 'SPOILED'
  ).length;
  const totalLoss = Math.max(1, damaged + spoiled);

  const expiredOnHand = useMemo(
    () =>
      Array.isArray(batches)
        ? batches.filter((b) => Number(b.qty ?? b.qtyRemaining ?? 0) > 0 && b.expiry && new Date(b.expiry) < new Date()).length
        : 0,
    [batches]
  );

  const reasonBreakdown = useMemo(() => {
    const map = new Map();
    losses.forEach((m) => {
      const key = String(m.reason || 'Unspecified').trim() || 'Unspecified';
      map.set(key, (map.get(key) || 0) + 1);
    });
    return Array.from(map.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [losses]);

  const maxReason = Math.max(1, ...reasonBreakdown.map((r) => r.count));

  return (
    <>
      <div className="stat-grid">
        <StatCard
          label="Total loss entries"
          value={losses.length}
          tone="danger"
          hint={`${rangeLabel} · Damaged + Spoiled`}
        />
        <StatCard
          label="Damaged entries"
          value={damaged}
          tone="danger"
          hint={`${rangeLabel} · Prep & handling loss`}
        />
        <StatCard
          label="Spoiled entries"
          value={spoiled}
          tone="warn"
          hint={`${rangeLabel} · Expired / quality write-offs`}
        />
        <StatCard
          label="Unwritten expired batches"
          value={invDash?.expiredCount ?? expiredOnHand}
          tone="danger"
          hint="Pending write-off"
        />
      </div>

      <div className="charts-grid" style={{ marginBottom: 16 }}>
        <div className="card panel">
          <h2>Loss Classification Split ({rangeLabel})</h2>
          <p className="chart-sub">Physical damage vs. spoilage &amp; expiry write-offs</p>
          <div className="health-bars" style={{ marginTop: 14 }}>
            {[
              { label: 'Damaged Goods', val: damaged, cls: 'seg-danger' },
              { label: 'Spoiled / Expired', val: spoiled, cls: 'seg-warn' },
            ].map((row) => {
              const pct = damaged + spoiled > 0 ? Math.round((row.val / totalLoss) * 100) : 0;
              return (
                <div className="health-row" key={row.label}>
                  <div className="health-meta">
                    <strong>{row.label}</strong>
                    <span>{row.val} incidents ({pct}%)</span>
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
          <h2>Top Waste Reasons ({rangeLabel})</h2>
          <p className="chart-sub">Most frequent root causes logged by kitchen staff</p>
          {reasonBreakdown.length === 0 ? (
            <p className="muted">No waste reasons recorded in {rangeLabel.toLowerCase()}.</p>
          ) : (
            <div className="health-bars" style={{ marginTop: 14 }}>
              {reasonBreakdown.map((r) => {
                const pct = Math.round((r.count / maxReason) * 100);
                return (
                  <div className="health-row" key={r.reason}>
                    <div className="health-meta">
                      <strong>{r.reason}</strong>
                      <span>{r.count} {r.count === 1 ? 'entry' : 'entries'}</span>
                    </div>
                    <div className="stacked-track">
                      <div className="seg seg-danger" style={{ width: `${Math.max(8, pct)}%` }} />
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
            {losses.slice(0, 25).map((m, idx) => {
              const kind = String(m.type ?? m.movement_type ?? '').toUpperCase();
              const stamp = m.createdAt ?? m.created_at ?? m.date;
              return (
                <tr key={m.id ?? `${stamp}-${idx}`}>
                  <td>{fmtDateTime(stamp)}</td>
                  <td>{m.itemName ?? m.item_name ?? '-'}</td>
                  <td className="batch-id">{m.batchCode ?? m.batch_code ?? '-'}</td>
                  <td>
                    <StatusBadge tone={MOVE_TONE[kind] || 'warn'}>
                      {MOVE_LABEL[kind] || kind}
                    </StatusBadge>
                  </td>
                  <td className="num">{m.qty} {m.unit}</td>
                  <td>{m.reason || 'No reason noted'}</td>
                  <td>{m.recordedBy ?? m.recorded_by ?? m.user ?? '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}