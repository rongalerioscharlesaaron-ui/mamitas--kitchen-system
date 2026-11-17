import { useNow } from '../../hooks/useNow';
import { fmtClock, fmtDayTime, durationText } from '../../utils/time';
import { formatMoney } from '../../utils/money';

export default function SessionCard({ session, onClose }) {
  const now = useNow();

  return (
    <section className="card session-card" aria-label="Current session">
      <div className="session-head">
        <div>
          <h2>Current session</h2>
          <p className="muted" style={{ margin: 0 }}>
            Started at {fmtClock(session.openedAt)}, open for {durationText(session.openedAt, now)}
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
          <div className="kv-value">Not yet</div>
          <div className="kv-note">Recorded when you close</div>
        </div>
        <div className="kv">
          <div className="kv-label">Opening cash</div>
          <div className="kv-value">{formatMoney(session.openingCash)}</div>
        </div>
        <div className="kv">
          <div className="kv-label">Orders</div>
          <div className="kv-value">{session.orders}</div>
        </div>
        <div className="kv">
          <div className="kv-label">Net sales</div>
          <div className="kv-value">{formatMoney(session.netSales)}</div>
        </div>
        <div className="kv kv-strong">
          <div className="kv-label">Estimated cash in drawer</div>
          <div className="kv-value">{formatMoney(session.expectedCash)}</div>
          <div className="kv-note">Opening cash + cash sales</div>
        </div>
      </div>

      <div className="split-row">
        <span>Cash {formatMoney(session.cashSales)}</span>
        <span>PayNow {formatMoney(session.paynowSales)}</span>
        <span>Card {formatMoney(session.cardSales)}</span>
      </div>
    </section>
  );
}