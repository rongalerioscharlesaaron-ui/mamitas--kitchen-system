import { useState } from 'react';
import Modal from '../Modal';
import { useInventory } from '../../context/InventoryContext';

export default function EditMenuItemModal({ item, onClose, onDone }) {
  const { updateMenuItem } = useInventory();
  const [form, setForm] = useState({ price: String(item.price), minLevel: String(item.minLevel) });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = (e) => {
    e.preventDefault();
    const result = updateMenuItem(item.id, form);
    if (!result.ok) return setError(result.message);
    onDone(result);
    onClose();
  };

  return (
    <Modal title={`Edit ${item.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="em-price">Price (SGD)</label>
          <input id="em-price" type="number" min="0" step="0.01" value={form.price} onChange={set('price')} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="em-min">Low-stock level ({item.unit})</label>
          <input id="em-min" type="number" min="0" step="1" value={form.minLevel} onChange={set('minLevel')} />
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">Save changes</button>
        </div>
      </form>
    </Modal>
  );
}