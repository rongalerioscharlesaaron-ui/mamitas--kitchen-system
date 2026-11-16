import { useState } from 'react';
import Modal from '../Modal';
import { useInventory } from '../../context/InventoryContext';
import { FOOD_CATEGORIES } from '../../utils/inventory';

export default function AddMenuItemModal({ onClose, onDone }) {
  const { addItem } = useInventory();
  const [form, setForm] = useState({
    type: 'food', name: '', category: FOOD_CATEGORIES[0], price: '', minLevel: '', qty: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const unit = form.type === 'food' ? 'servings' : 'trays';

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const result = await addItem(form);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    onDone(result);
    onClose();
  };

  return (
    <Modal title="Add menu item" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="info-box">
          Foods and trays are cooked fresh for the day, so no expiry date is needed. Whatever is not sold expires at
          the end of the day.
        </div>
        <div className="field">
          <label htmlFor="mi-type">Type</label>
          <select id="mi-type" value={form.type} onChange={set('type')}>
            <option value="food">Food (sold per serving)</option>
            <option value="food_tray">Food tray (sold per tray)</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="mi-name">Name</label>
          <input id="mi-name" value={form.name} onChange={set('name')} autoFocus />
        </div>
        {form.type === 'food' && (
          <div className="field">
            <label htmlFor="mi-cat">Category</label>
            <select id="mi-cat" value={form.category} onChange={set('category')}>
              {FOOD_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="mi-price">Price (SGD)</label>
          <input id="mi-price" type="number" min="0" step="0.01" value={form.price} onChange={set('price')} />
        </div>
        <div className="field">
          <label htmlFor="mi-min">Low-stock level ({unit})</label>
          <input id="mi-min" type="number" min="0" step="1" value={form.minLevel} onChange={set('minLevel')} />
          <span className="hint">An alert shows when available {unit} are at or below this number.</span>
        </div>
        <div className="field">
          <label htmlFor="mi-qty">{unit === 'trays' ? 'Trays' : 'Servings'} cooked today (optional)</label>
          <input id="mi-qty" type="number" min="0" step="1" value={form.qty} onChange={set('qty')} />
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving...' : 'Add menu item'}
          </button>
        </div>
      </form>
    </Modal>
  );
}