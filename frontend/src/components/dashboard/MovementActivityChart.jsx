import { useState } from 'react';
import { Maximize2 } from 'lucide-react';

function ChartContent({ days, expanded = false }) {
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
    <>
      <div className="chart-legend" style={{ marginBottom: 12, fontSize: expanded ? '0.95rem' : undefined }}>
        <span><i className="dot dot-ok" /> In ({totalIn})</span>
        <span><i className="dot dot-info" /> Used ({totalUsed})</span>
        <span><i className="dot dot-danger" /> Waste ({totalWaste})</span>
      </div>

      <div
        className="bar-chart"
        role="img"
        aria-label="7-day stock movement bar chart"
        style={{
          paddingTop: expanded ? 30 : 24,
          minHeight: expanded ? 340 : undefined,
          gap: expanded ? 20 : undefined,
        }}
      >
        {days.map((d) => (
          <div
            className="bar-col"
            key={d.date}
            style={{
              flex: expanded ? 1 : undefined,
              minWidth: expanded ? 0 : 36,
            }}
          >
            <div
              className="bar-group"
              style={{
                height: expanded ? 270 : undefined,
                gap: expanded ? 8 : undefined,
              }}
            >
              <div
                className="bar bar-ok"
                style={{
                  height: `${Math.max(d.in > 0 ? 10 : 3, Math.min(100, Math.round((d.in / maxVal) * 100)))}%`,
                  minWidth: expanded ? 22 : undefined,
                  fontSize: expanded ? '0.82rem' : d.in >= 100 ? '0.68rem' : undefined,
                }}
                title={`${d.label} Stock In: ${d.in}`}
              >
                {d.in > 0 && <span>{d.in}</span>}
              </div>
              <div
                className="bar bar-info"
                style={{
                  height: `${Math.max(d.used > 0 ? 10 : 3, Math.min(100, Math.round((d.used / maxVal) * 100)))}%`,
                  minWidth: expanded ? 22 : undefined,
                  fontSize: expanded ? '0.82rem' : d.used >= 100 ? '0.68rem' : undefined,
                }}
                title={`${d.label} Used: ${d.used}`}
              >
                {d.used > 0 && <span>{d.used}</span>}
              </div>
              <div
                className="bar bar-danger"
                style={{
                  height: `${Math.max(d.waste > 0 ? 10 : 3, Math.min(100, Math.round((d.waste / maxVal) * 100)))}%`,
                  minWidth: expanded ? 22 : undefined,
                  fontSize: expanded ? '0.82rem' : d.waste >= 100 ? '0.68rem' : undefined,
                }}
                title={`${d.label} Damaged/Spoiled: ${d.waste}`}
              >
                {d.waste > 0 && <span>{d.waste}</span>}
              </div>
            </div>
            <span className="bar-label" style={{ fontSize: expanded ? '0.88rem' : undefined }}>
              {d.label}
            </span>
          </div>
        ))}
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
    </>
  );
}

export default function MovementActivityChart({ days }) {
  const [fullOpen, setFullOpen] = useState(false);

  return (
    <div className="card panel activity-card">
      <div>
        <div className="chart-head" style={{ alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h2>7-Day Stock Activity</h2>
            <p className="chart-sub">Daily count of stock-ins, kitchen usage, and waste entries</p>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setFullOpen(true)}
          >
            <Maximize2 size={14} aria-hidden="true" /> Show full graph
          </button>
        </div>

        <ChartContent days={days} />
      </div>

      {fullOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="7-Day Stock Activity — Full View"
          onClick={() => setFullOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(15, 23, 42, 0.55)',
            display: 'grid',
            placeItems: 'center',
            padding: 20,
            overflowY: 'auto',
          }}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(980px, 95vw)',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: 24,
              borderRadius: 14,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                marginBottom: 14,
              }}
            >
              <div>
                <h2 style={{ margin: 0 }}>7-Day Stock Activity — Full View</h2>
                <p className="chart-sub" style={{ margin: '4px 0 0' }}>
                  Expanded view of daily stock-ins, kitchen usage, and waste entries
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setFullOpen(false)}
              >
                Close
              </button>
            </div>

            <ChartContent days={days} expanded />
          </div>
        </div>
      )}
    </div>
  );
}