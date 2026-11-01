import { useState } from 'react';
import Modal from '../Modal';
import { useInventory } from '../../context/InventoryContext';
import { todayStr } from '../../utils/dates';

export default function AddItemModal({ onClose, onDone }) {
  const { addItem } = useInventory();
  const [form, setForm] = useState({
    name: '', type: 'ingredient', unit: '', minLevel: '', qty: '', expiry: '',
  });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = (e) => {
    e.preventDefault();
    const result = addItem(form);
    if (!result.ok) return setError(result.message);
    onDone(result);
    onClose();
  };

  return (
    <Modal title="Add New Item" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="ai-name">Item name</label>
          <input id="ai-name" value={form.name} onChange={set('name')} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="ai-type">Type</label>
          <select id="ai-type" value={form.type} onChange={set('type')}>
            <option value="ingredient">Ingredient</option>
            <option value="food_tray">Food Tray</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="ai-unit">Unit</label>
          <input id="ai-unit" value={form.unit} onChange={set('unit')} placeholder="kg, L, pcs, trays" />
        </div>
        <div className="field">
          <label htmlFor="ai-min">Low-stock level</label>
          <input id="ai-min" type="number" min="0" step="any" value={form.minLevel} onChange={set('minLevel')} />
          <span className="hint">An alert shows when stock is at or below this number.</span>
        </div>
        <div className="field">
          <label htmlFor="ai-qty">Starting quantity (optional)</label>
          <input id="ai-qty" type="number" min="0" step="any" value={form.qty} onChange={set('qty')} />
        </div>
        <div className="field">
          <label htmlFor="ai-exp">Expiry date (optional)</label>
          <input id="ai-exp" type="date" min={todayStr()} value={form.expiry} onChange={set('expiry')} />
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">Add Item</button>
        </div>
      </form>
    </Modal>
  );
}