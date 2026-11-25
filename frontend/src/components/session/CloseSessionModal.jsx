import { useState } from 'react';
import Modal from '../Modal';
import { useSession } from '../../context/SessionContext';
import { SHOP } from '../../config/shop';
import { fmtClock, fmtDayTime, durationText } from '../../utils/time';
import { formatMoney, fromCents, toCents } from '../../utils/money';

const resultWord = (diff) => (diff === 0 ? 'Balanced' : diff < 0 ? 'Short' : 'Over');

// Printable shift summary (the print style shows only this sheet)
function Summary({ s }) {
  return (
    <div className="receipt-sheet">
      <div className="receipt-head">
        <div className="receipt-shop">{SHOP.name}</div>
        <div>Cashier session summary</div>
      </div>
      <div className="receipt-block">
        <div className="receipt-row"><span>Cashier</span><span>{s.cashier}</span></div>
        <div className="receipt-row"><span>Time IN</span><span>{fmtDayTime(s.openedAt)}</span></div>
        <div className="receipt-row"><span>Time OUT</span><span>{fmtDayTime(s.closedAt)}</span></div>
        <div className="receipt-row"><span>Open for</span><span>{durationText(s.openedAt, s.closedAt)}</span></div>
      </div>
      <div className="receipt-block">
        <div className="receipt-row"><span>Orders</span><span>{s.orders}</span></div>
        <div className="receipt-row"><span>Net sales</span><span>{formatMoney(s.netSales)}</span></div>
        <div className="receipt-row"><span>Cash</span><span>{formatMoney(s.cashSales)}</span></div>
        <div className="receipt-row"><span>PayNow</span><span>{formatMoney(s.paynowSales)}</span></div>
        <div className="receipt-row"><span>Card</span><span>{formatMoney(s.cardSales)}</span></div>
      </div>
      <div className="receipt-block">
        <div className="receipt-row"><span>Opening cash</span><span>{formatMoney(s.openingCash)}</span></div>
        <div className="receipt-row"><span>Expected cash in drawer</span><span>{formatMoney(s.expectedCash)}</span></div>
        <div className="receipt-row"><span>Counted cash</span><span>{formatMoney(s.countedCash)}</span></div>
        <div className="receipt-row receipt-total">
          <span>{resultWord(s.cashDifference)}</span>
          <span>{formatMoney(Math.abs(s.cashDifference))}</span>
        </div>
      </div>
      {s.closeNote && <div className="receipt-block">Note: {s.closeNote}</div>}
    </div>
  );
}

export default function CloseSessionModal({ session, onClose }) {
  const { closeSession } = useSession();
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const expectedCents = toCents(session.expectedCash);
  const hasCount = counted !== '' && !Number.isNaN(Number(counted));
  const diffCents = hasCount ? toCents(counted) - expectedCents : null;
  const safeClose = busy ? () => {} : onClose;

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!hasCount) {
      setError('Enter the cash you counted in the drawer.');
      return;
    }
    if (diffCents !== 0 && !note.trim()) {
      setError('The count is different from the expected cash. Add a note to explain the difference.');
      return;
    }
    setBusy(true);
    setError('');
    const result = await closeSession({ countedCash: counted, note });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setDone(result.session);
  };

  if (done) {
    return (
      <Modal title="Session closed" onClose={onClose}>
        <Summary s={done} />
        <div className="form-actions no-print">
          <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
            Print summary
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Close session" onClose={safeClose}>
      <form onSubmit={submit}>
        <div className="pay-total">
          <span>Expected cash in drawer</span>
          <strong>{formatMoney(session.expectedCash)}</strong>
        </div>
        <p className="hint" style={{ marginTop: 0 }}>
          Opening cash {formatMoney(session.openingCash)} + cash sales {formatMoney(session.cashSales)}.
          PayNow and card sales are not in the drawer.
        </p>

        <div className="field">
          <label htmlFor="cs-counted">Cash you counted in the drawer (SGD)</label>
          <input
            id="cs-counted" type="number" min="0" step="0.01" autoFocus disabled={busy}
            value={counted} onChange={(e) => setCounted(e.target.value)}
          />
        </div>

        {diffCents !== null && (
          <div className={`change-box ${diffCents === 0 ? 'change-ok' : 'change-short'}`} role="status">
            <span>{resultWord(diffCents)}</span>
            <span>{formatMoney(fromCents(Math.abs(diffCents)))}</span>
          </div>
        )}

        <div className="field" style={{ marginTop: 14 }}>
          <label htmlFor="cs-note">
            Note {diffCents !== null && diffCents !== 0 ? '(required)' : '(optional)'}
          </label>
          <input
            id="cs-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200}
            disabled={busy} placeholder="For example: gave change from the drawer"
          />
        </div>

        {error && <p className="error" role="alert">{error}</p>}

        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={safeClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Closing...' : 'Close session and record Time OUT'}
          </button>
        </div>
      </form>
    </Modal>
  );
}