import { useState } from 'react';
import Modal from '../Modal';
import { useInventory } from '../../context/InventoryContext';
import { INGREDIENT_CATEGORIES } from '../../utils/inventory';
import { todayStr } from '../../utils/dates';

export default function AddItemModal({ defaultName = '', onClose, onDone }) {
  const { items, addIngredient } = useInventory();
  const ingredients = items.filter((i) => i.type === 'ingredient');
  const [form, setForm] = useState({
    name: defaultName,
    category: INGREDIENT_CATEGORIES[0],
    unit: '',
    minLevel: '',
    qty: '',
    hasExpiry: 'no',
    expiry: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const existing = ingredients.find(
    (i) => i.name.toLowerCase() === form.name.trim().toLowerCase()
  );
  const expires = existing ? existing.hasExpiry : form.hasExpiry === 'yes';
  const blocked = Boolean(existing && !existing.hasExpiry);
  const unit = existing ? existing.unit : form.unit.trim();

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const result = await addIngredient({ ...form, hasExpiry: form.hasExpiry === 'yes' });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    onDone(result);
    onClose();
  };

  return (
    <Modal title="Add ingredient" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="ai-name">Ingredient name</label>
          <input
            id="ai-name" list="ingredient-names" value={form.name}
            onChange={set('name')} autoFocus autoComplete="off"
          />
          <datalist id="ingredient-names">
            {ingredients.map((i) => (
              <option key={i.id} value={i.name} />
            ))}
          </datalist>
          <span className="hint">Choose an existing ingredient to add a new batch to it.</span>
        </div>

        {existing ? (
          <div className="info-box">
            {existing.name} is already in {existing.category}, measured in {existing.unit}.{' '}
            {existing.hasExpiry
              ? 'A new batch with its own expiry date will be added.'
              : 'It has no expiry date, so use Stock in to add more.'}
          </div>
        ) : (
          <>
            <div className="field">
              <label htmlFor="ai-cat">Category</label>
              <select id="ai-cat" value={form.category} onChange={set('category')}>
                {INGREDIENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ai-unit">Unit</label>
              <input id="ai-unit" value={form.unit} onChange={set('unit')} placeholder="kg, L, pcs" />
            </div>
            <div className="field">
              <label htmlFor="ai-min">Low-stock level</label>
              <input id="ai-min" type="number" min="0" step="any" value={form.minLevel} onChange={set('minLevel')} />
              <span className="hint">Alerts when stock is at or below this number.</span>
            </div>
            <div className="field">
              <label htmlFor="ai-exp-type">Expiry</label>
              <select id="ai-exp-type" value={form.hasExpiry} onChange={set('hasExpiry')}>
                <option value="no">No expiry date</option>
                <option value="yes">Has an expiry date</option>
              </select>
            </div>
          </>
        )}

        {!blocked && (
          <>
            <div className="field">
              <label htmlFor="ai-qty">
                {expires ? `Quantity received${unit ? ` (${unit})` : ''}` : 'Starting quantity (optional)'}
              </label>
              <input id="ai-qty" type="number" min="0" step="any" value={form.qty} onChange={set('qty')} />
              {expires && <span className="hint">A unique batch ID is assigned automatically.</span>}
            </div>
            {expires && (
              <div className="field">
                <label htmlFor="ai-exp">Expiry date of this batch</label>
                <input id="ai-exp" type="date" min={todayStr()} value={form.expiry} onChange={set('expiry')} />
              </div>
            )}
          </>
        )}

        {error && <p className="error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={blocked || busy}>
            {busy ? 'Saving...' : existing ? 'Add batch' : 'Add ingredient'}
          </button>
        </div>
      </form>
    </Modal>
  );
}