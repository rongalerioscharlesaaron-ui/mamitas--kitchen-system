import { useState } from 'react';
import Modal from '../Modal';
import { useAuth } from '../../context/AuthContext';
import { useInventory } from '../../context/InventoryContext';

export default function EditMenuItemModal({ item, onClose, onDone }) {
  const { user } = useAuth();
  const { updateMenuItem } = useInventory();
  const isOwner = user?.role === 'owner';
  const [form, setForm] = useState({ price: String(item.price), minLevel: String(item.minLevel) });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const result = await updateMenuItem(item.id, {
      price: isOwner && Number(form.price) !== Number(item.price) ? form.price : undefined,
      minLevel: Number(form.minLevel) !== Number(item.minLevel) ? form.minLevel : undefined,
    });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    onDone(result);
    onClose();
  };

  return (
    <Modal title={`Edit ${item.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="em-price">Price (SGD)</label>
          <input
            id="em-price" type="number" min="0" step="0.01" value={form.price}
            onChange={set('price')} disabled={!isOwner} autoFocus={isOwner}
          />
          {!isOwner && <span className="hint">Only the owner can change prices.</span>}
        </div>
        <div className="field">
          <label htmlFor="em-min">Low-stock level ({item.unit})</label>
          <input
            id="em-min" type="number" min="0" step="1" value={form.minLevel}
            onChange={set('minLevel')} autoFocus={!isOwner}
          />
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}