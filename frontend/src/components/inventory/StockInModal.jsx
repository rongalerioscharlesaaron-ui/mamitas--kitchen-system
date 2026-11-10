import { useState } from 'react';
import Modal from '../Modal';
import { useInventory } from '../../context/InventoryContext';
import { todayStr } from '../../utils/dates';

export default function StockInModal({
  defaultItemId = '', types = null, noExpiryOnly = false, onClose, onDone,
}) {
  const { items, stockByItem, addStock } = useInventory();
  const [form, setForm] = useState({ itemId: defaultItemId, qty: '', expiry: '' });
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
    const result = await addStock({ ...form, itemId: Number(form.itemId) });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    onDone(result);
    onClose();
  };

  return (
    <Modal title="Stock in" onClose={onClose}>
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
          {item && <span className="hint">Current stock: {stockByItem[item.id] || 0} {item.unit}</span>}
        </div>
        <div className="field">
          <label htmlFor="si-qty">Quantity received {item ? `(${item.unit})` : ''}</label>
          <input
            id="si-qty" type="number" min="0" step={isMenu ? '1' : 'any'}
            value={form.qty} onChange={set('qty')}
          />
        </div>
        {isMenu && (
          <div className="field">
            <label htmlFor="si-exp">Expiry date (optional)</label>
            <input id="si-exp" type="date" min={todayStr()} value={form.expiry} onChange={set('expiry')} />
            <span className="hint">Each entry gets its own batch ID.</span>
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving...' : 'Save stock in'}
          </button>
        </div>
      </form>
    </Modal>
  );
}