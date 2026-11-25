import { useNow } from '../../hooks/useNow';
import { fmtClock, fmtDayTime, durationText } from '../../utils/time';
import { formatMoney } from '../../utils/money';

export default function SessionCard({ session, onClose }) {
  const now = useNow();
  const totalSales = Number(session.cashSales || 0) + Number(session.paynowSales || 0) + Number(session.cardSales || 0);
  const pct = (v) => (totalSales > 0 ? Math.round((Number(v || 0) / totalSales) * 100) : 0);
  const cashPct = pct(session.cashSales);
  const paynowPct = pct(session.paynowSales);
  const cardPct = totalSales > 0 ? Math.max(0, 100 - cashPct - paynowPct) : 0;

  return (
    <section className="card session-card" aria-label="Current session">
      <div className="session-head">
        <div>
          <h2>Current session</h2>
          <p className="muted" style={{ margin: 0 }}>
            Started at {fmtClock(session.openedAt)} · Open for {durationText(session.openedAt, now)}
          </p>
        </div>
        <button className="btn btn-primary" onClick={onClose}>Close session</button>
      </div>

      {!session.openedToday && (
        <div className="notice notice-error" role="status">
          <span>
            This session was opened on {fmtDayTime(session.openedAt)}. Close it, then start a new one for today.
          </span>
        </div>
      )}

      <div className="kv-grid">
        <div className="kv">
          <div className="kv-label">Time IN</div>
          <div className="kv-value">{fmtClock(session.openedAt)}</div>
        </div>
        <div className="kv">
          <div className="kv-label">Time OUT</div>
          <div className="kv-value">Active</div>
          <div className="kv-note">Recorded on close</div>
        </div>
        <div className="kv">
          <div className="kv-label">Opening cash</div>
          <div className="kv-value">{formatMoney(session.openingCash)}</div>
        </div>
        <div className="kv">
          <div className="kv-label">Shift orders</div>
          <div className="kv-value">{session.orders}</div>
        </div>
        <div className="kv">
          <div className="kv-label">Net sales</div>
          <div className="kv-value">{formatMoney(session.netSales)}</div>
        </div>
        <div className="kv kv-strong">
          <div className="kv-label">Estimated cash in drawer</div>
          <div className="kv-value">{formatMoney(session.expectedCash)}</div>
          <div className="kv-note">Opening + cash sales</div>
        </div>
      </div>

      <div className="pay-mix">
        <div className="pay-mix-head">
          <span>Payment breakdown</span>
          <div className="chart-legend">
            <span><i className="dot dot-ok" /> Cash {formatMoney(session.cashSales)} ({cashPct}%)</span>
            <span><i className="dot dot-info" /> PayNow {formatMoney(session.paynowSales)} ({paynowPct}%)</span>
            <span><i className="dot dot-warn" /> Card {formatMoney(session.cardSales)} ({cardPct}%)</span>
          </div>
        </div>
        <div className="stacked-track" role="img" aria-label="Payment method breakdown">
          {cashPct > 0 && <div className="seg seg-ok" style={{ width: `${cashPct}%` }} />}
          {paynowPct > 0 && <div className="seg seg-info" style={{ width: `${paynowPct}%` }} />}
          {cardPct > 0 && <div className="seg seg-warn" style={{ width: `${cardPct}%` }} />}
        </div>
      </div>
    </section>
  );
}