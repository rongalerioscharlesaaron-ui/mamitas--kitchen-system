import { useState } from 'react';
import Modal from '../Modal';
import { useInventory } from '../../context/InventoryContext';

export default function RecordLossModal({ defaultItemId = '', onClose, onDone }) {
  const { items, stockByItem, recordLoss } = useInventory();
  const [form, setForm] = useState({ itemId: defaultItemId, qty: '', type: 'DAMAGED', reason: '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const item = items.find((i) => i.id === form.itemId);

  const submit = (e) => {
    e.preventDefault();
    const result = recordLoss(form);
    if (!result.ok) return setError(result.message);
    onDone(result);
    onClose();
  };

  return (
    <Modal title="Record Damaged / Spoiled Goods" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="rl-item">Item</label>
          <select id="rl-item" value={form.itemId} onChange={set('itemId')}>
            <option value="">Select item</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
          {item && <span className="hint">Available: {stockByItem[item.id] || 0} {item.unit}</span>}
        </div>
        <div className="field">
          <label htmlFor="rl-type">Label as</label>
          <select id="rl-type" value={form.type} onChange={set('type')}>
            <option value="DAMAGED">Damaged</option>
            <option value="SPOILED">Spoiled</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="rl-qty">Quantity {item ? `(${item.unit})` : ''}</label>
          <input id="rl-qty" type="number" min="0" step="any" value={form.qty} onChange={set('qty')} />
        </div>
        <div className="field">
          <label htmlFor="rl-reason">Reason</label>
          <input id="rl-reason" list="loss-reasons" value={form.reason} onChange={set('reason')} />
          <datalist id="loss-reasons">
            <option value="Container leaked" />
            <option value="Dropped" />
            <option value="Packaging torn" />
            <option value="Spoiled (smell)" />
            <option value="Expired" />
          </datalist>
          <span className="hint">The oldest stock is deducted first (FIFO).</span>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-danger">Record</button>
        </div>
      </form>
    </Modal>
  );
}