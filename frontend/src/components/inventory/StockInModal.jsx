import { useState } from 'react';
import Modal from '../Modal';
import { useInventory } from '../../context/InventoryContext';
import { todayStr } from '../../utils/dates';

export default function StockInModal({ defaultItemId = '', onClose, onDone }) {
  const { items, stockByItem, addStock } = useInventory();
  const [form, setForm] = useState({ itemId: defaultItemId, qty: '', expiry: '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const item = items.find((i) => i.id === form.itemId);

  const submit = (e) => {
    e.preventDefault();
    const result = addStock(form);
    if (!result.ok) return setError(result.message);
    onDone(result);
    onClose();
  };

  return (
    <Modal title="Stock In" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="si-item">Item</label>
          <select id="si-item" value={form.itemId} onChange={set('itemId')}>
            <option value="">Select item</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
          {item && <span className="hint">Current stock: {stockByItem[item.id] || 0} {item.unit}</span>}
        </div>
        <div className="field">
          <label htmlFor="si-qty">Quantity received {item ? `(${item.unit})` : ''}</label>
          <input id="si-qty" type="number" min="0" step="any" value={form.qty} onChange={set('qty')} />
        </div>
        <div className="field">
          <label htmlFor="si-exp">Expiry date (optional)</label>
          <input id="si-exp" type="date" min={todayStr()} value={form.expiry} onChange={set('expiry')} />
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">Save Stock In</button>
        </div>
      </form>
    </Modal>
  );
}