import { useState } from 'react';
import Modal from '../Modal';
import { useInventory } from '../../context/InventoryContext';

export default function EditIngredientModal({ item, onClose, onDone }) {
  const { updateMenuItem, stockByItem } = useInventory();
  const [minLevel, setMinLevel] = useState(String(item.minLevel));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (minLevel === '' || Number(minLevel) === Number(item.minLevel)) {
      setError('Enter a new low-stock level.');
      return;
    }
    setBusy(true);
    setError('');
    const result = await updateMenuItem(item.id, { minLevel });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    onDone(result);
    onClose();
  };

  return (
    <Modal title={`Edit ${item.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="ei-min">Low-stock level ({item.unit})</label>
          <input
            id="ei-min" type="number" min="0" step="any" value={minLevel}
            onChange={(e) => setMinLevel(e.target.value)} autoFocus
          />
          <span className="hint">
            An alert shows when stock is at or below this number. Stock now: {stockByItem[item.id] || 0} {item.unit}.
            A standard level is the average daily use multiplied by the days it takes to restock plus a few days of safety.
          </span>
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