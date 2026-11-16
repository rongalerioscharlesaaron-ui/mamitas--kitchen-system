import { useState } from 'react';
import Modal from '../Modal';
import { useInventory } from '../../context/InventoryContext';

export default function StockInModal({
  defaultItemId = '', types = null, noExpiryOnly = false, onClose, onDone,
}) {
  const { items, stockByItem, usableStockByItem, addStock } = useInventory();
  const [form, setForm] = useState({ itemId: defaultItemId ? String(defaultItemId) : '', qty: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const options = items.filter(
    (i) =>
      (!types || types.includes(i.type)) &&
      !(noExpiryOnly && i.type === 'ingredient' && i.hasExpiry)
  );
  const item = items.find((i) => i.id === Number(form.itemId));
  const isMenu = item && item.type !== 'ingredient';

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const result = await addStock({ itemId: Number(form.itemId), qty: form.qty });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    onDone(result);
    onClose();
  };

  return (
    <Modal title={isMenu ? 'Add servings' : 'Stock in'} onClose={onClose}>
      <form onSubmit={submit}>
        {noExpiryOnly && (
          <div className="info-box">
            Only ingredients without an expiry date are listed. For ingredients with an expiry date, use Add ingredient
            so each delivery gets its own batch ID.
          </div>
        )}
        <div className="field">
          <label htmlFor="si-item">Item</label>
          <select id="si-item" value={form.itemId} onChange={set('itemId')}>
            <option value="">Select item</option>
            {options.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
          {item && (
            <span className="hint">
              {isMenu
                ? `Available today: ${usableStockByItem[item.id] || 0} ${item.unit}`
                : `Current stock: ${stockByItem[item.id] || 0} ${item.unit}`}
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="si-qty">
            {isMenu ? `${item.unit === 'trays' ? 'Trays' : 'Servings'} added` : 'Quantity received'} {item && !isMenu ? `(${item.unit})` : ''}
          </label>
          <input
            id="si-qty" type="number" min="0" step={isMenu ? '1' : 'any'}
            value={form.qty} onChange={set('qty')}
          />
          {isMenu && (
            <span className="hint">
              Freshly cooked for the day. No expiry date is needed: these expire at the end of the day.
            </span>
          )}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving...' : isMenu ? 'Save' : 'Save stock in'}
          </button>
        </div>
      </form>
    </Modal>
  );
}