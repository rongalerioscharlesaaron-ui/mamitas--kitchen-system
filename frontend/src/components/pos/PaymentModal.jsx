import { useState } from 'react';
import Modal from '../Modal';
import ReceiptModal from './ReceiptModal';
import { useOrders } from '../../context/OrderContext';
import { ORDER_TYPES, PAYMENT_METHODS } from '../../config/shop';
import { formatMoney, fromCents, toCents } from '../../utils/money';

const NOTES = [5, 10, 50, 100];
const label = (list, id) => list.find((x) => x.id === id)?.label ?? id;

export default function PaymentModal({ onClose, onPlaced }) {
  const { cartTotals, orderType, placeOrder } = useOrders();
  // The order is saved when it is placed and the cart is then cleared, so keep what was on screen
  const [snapshot] = useState(() => ({ total: cartTotals.total, count: cartTotals.count, type: orderType }));
  const [method, setMethod] = useState('cash');
  const [tendered, setTendered] = useState('');
  const [error, setError] = useState('');
  const [lostConnection, setLostConnection] = useState(false);
  const [busy, setBusy] = useState(false);
  const [placed, setPlaced] = useState(null);
  const [showReceipt, setShowReceipt] = useState(false);

  const total = snapshot.total;
  const enough = tendered !== '' && toCents(tendered) >= toCents(total);
  const diff = tendered === '' ? 0 : fromCents(Math.abs(toCents(tendered) - toCents(total)));
  const quick = NOTES.filter((n) => n >= total).slice(0, 3);
  const canConfirm = method !== 'cash' || enough;
  const safeClose = busy ? () => {} : onClose;

  const submit = async (e) => {
    e.preventDefault();
    if (placed || busy) return;
    setBusy(true);
    setError('');
    setLostConnection(false);
    const result = await placeOrder({ method, tendered });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      setLostConnection(result.status === 0);
      return;
    }
    setPlaced(result.order);
    onPlaced(result.order);
  };

  if (placed && showReceipt) {
    return <ReceiptModal order={placed} closeLabel="Start next order" onClose={onClose} />;
  }

  if (placed) {
    return (
      <Modal title="Order placed" onClose={onClose}>
        <div className="done-box">
          <p className="muted" style={{ margin: 0 }}>Order #{placed.number} is paid</p>
          <div className="big">
            {placed.payment.method === 'cash'
              ? `Change ${formatMoney(placed.payment.change)}`
              : formatMoney(placed.total)}
          </div>
          <p className="muted" style={{ margin: '8px 0 0' }}>
            {label(ORDER_TYPES, placed.type)}, paid by {label(PAYMENT_METHODS, placed.payment.method)}
            {placed.payment.method === 'cash' && `, received ${formatMoney(placed.payment.tendered)}`}
          </p>
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setShowReceipt(true)}>
            View receipt
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>Start next order</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Payment" onClose={safeClose}>
      <form onSubmit={submit}>
        <div className="pay-total">
          <span>{label(ORDER_TYPES, snapshot.type)}, {snapshot.count} {snapshot.count === 1 ? 'item' : 'items'}</span>
          <strong>{formatMoney(total)}</strong>
        </div>

        <div className="segmented" role="radiogroup" aria-label="Payment method" style={{ marginBottom: 16 }}>
          {PAYMENT_METHODS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={method === m.id}
              disabled={busy}
              onClick={() => {
                setMethod(m.id);
                setError('');
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        {method === 'cash' ? (
          <div className="field">
            <label htmlFor="pay-cash">Cash received (SGD)</label>
            <input
              id="pay-cash" type="number" min="0" step="0.01" autoFocus disabled={busy}
              value={tendered} onChange={(e) => setTendered(e.target.value)}
            />
            <div className="quick">
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy}
                onClick={() => setTendered(total.toFixed(2))}>
                Exact
              </button>
              {quick.map((n) => (
                <button key={n} type="button" className="btn btn-secondary btn-sm" disabled={busy}
                  onClick={() => setTendered(String(n))}>
                  {formatMoney(n)}
                </button>
              ))}
            </div>
            {tendered !== '' && (
              <div className={`change-box ${enough ? 'change-ok' : 'change-short'}`} role="status">
                <span>{enough ? 'Change due' : 'Short by'}</span>
                <span>{formatMoney(diff)}</span>
              </div>
            )}
          </div>
        ) : (
          <p className="muted">
            Confirm only after the {label(PAYMENT_METHODS, method)} payment has been received. This system records
            the payment and does not process it.
          </p>
        )}

        {error && <p className="error" role="alert">{error}</p>}
        {lostConnection && (
          <p className="hint" role="status">
            If the order was already saved, pressing Confirm payment again will not create a second order.
          </p>
        )}

        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={safeClose} disabled={busy}>
            Back to order
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canConfirm || busy}>
            {busy ? 'Placing order...' : 'Confirm payment'}
          </button>
        </div>
      </form>
    </Modal>
  );
}