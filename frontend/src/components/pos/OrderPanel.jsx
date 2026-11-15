import { useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import { useOrders } from '../../context/OrderContext';
import ConfirmDialog from '../ConfirmDialog';
import { ORDER_TYPES } from '../../config/shop';
import { formatMoney } from '../../utils/money';

export default function OrderPanel({ onCharge }) {
  const {
    cartLines, cartTotals, orderType, setOrderType, shop,
    addToCart, setQty, removeFromCart, clearCart, addable, stockOf,
  } = useOrders();
  const [confirmClear, setConfirmClear] = useState(false);
  const empty = cartLines.length === 0;
  const over = cartLines.filter((l) => l.qty > stockOf(l.itemId));

  return (
    <aside className="order-panel card" aria-label="Current order">
      <div className="order-head">
        <h2>Current order</h2>
        <span className="muted-inline">
          {cartTotals.count} {cartTotals.count === 1 ? 'item' : 'items'}
        </span>
      </div>

      <div className="segmented" role="radiogroup" aria-label="Order type">
        {ORDER_TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={orderType === t.id}
            onClick={() => setOrderType(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {empty ? (
        <p className="order-empty">No items yet. Tap a menu item to add it.</p>
      ) : (
        <ul className="order-lines">
          {cartLines.map((l) => (
            <li className="order-line" key={l.itemId}>
              <div>
                <div className="order-line-name">{l.name}</div>
                <div className="order-line-each">{formatMoney(l.price)} each</div>
                {l.qty > stockOf(l.itemId) && (
                  <div className="error" style={{ margin: 0, fontSize: '0.85rem' }}>
                    Only {stockOf(l.itemId)} available now
                  </div>
                )}
              </div>
              <div className="order-line-total">{formatMoney(l.lineTotal)}</div>
              <div className="stepper">
                <button
                  type="button"
                  onClick={() => setQty(l.itemId, l.qty - 1)}
                  aria-label={`Remove one ${l.name}`}
                >
                  <Minus size={16} aria-hidden="true" />
                </button>
                <output aria-label={`${l.qty} ${l.name}`}>{l.qty}</output>
                <button
                  type="button"
                  onClick={() => addToCart(l.itemId)}
                  disabled={addable(l.itemId) < 1}
                  title={addable(l.itemId) < 1 ? 'No more available' : undefined}
                  aria-label={`Add one ${l.name}`}
                >
                  <Plus size={16} aria-hidden="true" />
                </button>
              </div>
              <button
                type="button"
                className="icon-btn line-remove"
                onClick={() => removeFromCart(l.itemId)}
                aria-label={`Remove ${l.name} from order`}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="totals">
        {shop.gstRegistered && (
          <div className="totals-row">
            <span>GST included ({Math.round(shop.gstRate * 100)}%)</span>
            <span>{formatMoney(cartTotals.gst)}</span>
          </div>
        )}
        <div className="totals-total">
          <span>Total</span>
          <span>{formatMoney(cartTotals.total)}</span>
        </div>
      </div>

      {over.length > 0 && (
        <p className="error" role="alert" style={{ margin: 0 }}>
          Not enough stock for {over.map((l) => l.name).join(', ')}. Lower the quantity to continue.
        </p>
      )}

      <div className="order-actions">
        <button className="btn btn-primary btn-lg" disabled={empty || over.length > 0} onClick={onCharge}>
          {empty ? 'Charge' : `Charge ${formatMoney(cartTotals.total)}`}
        </button>
        <button className="btn btn-secondary" disabled={empty} onClick={() => setConfirmClear(true)}>
          Clear order
        </button>
      </div>

      {confirmClear && (
        <ConfirmDialog
          title="Clear this order?"
          message="All items will be removed from the current order. No stock is affected."
          confirmLabel="Clear order"
          onConfirm={() => {
            clearCart();
            setConfirmClear(false);
          }}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </aside>
  );
}