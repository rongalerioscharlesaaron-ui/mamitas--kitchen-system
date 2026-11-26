import { useState } from 'react';
import Modal from '../Modal';
import { useInventory } from '../../context/InventoryContext';
import { FOOD_CATEGORIES, INGREDIENT_CATEGORIES } from '../../utils/inventory';
import { todayStr } from '../../utils/dates';

let rowCounter = 0;
const newRow = () => ({
  key: ++rowCounter,
  name: '', qtyPerTray: '',
  // only used when the ingredient is not in Inventory yet
  unit: '', category: INGREDIENT_CATEGORIES[0], minLevel: '', hasExpiry: 'no', qty: '', expiry: '',
});

export default function AddMenuItemModal({ onClose, onDone }) {
  const { items, addItem, addMenuItemWithRecipe } = useInventory();
  const ingredients = items.filter((i) => i.type === 'ingredient');
  const [form, setForm] = useState({
    type: 'food', name: '', category: FOOD_CATEGORIES[0], price: '', minLevel: '', qty: '',
  });
  const [rows, setRows] = useState([newRow()]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setRow = (key, k) => (e) =>
    setRows(rows.map((r) => (r.key === key ? { ...r, [k]: e.target.value } : r)));
  const removeRow = (key) => setRows(rows.filter((r) => r.key !== key));
  const unit = form.type === 'food' ? 'servings' : 'trays';
  const isFood = form.type === 'food';
  const trays = Number(form.qty) || 0;

  const findExisting = (name) =>
    ingredients.find((i) => i.name.toLowerCase() === name.trim().toLowerCase());

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');

    let result;
    if (isFood) {
      const used = rows.filter((r) => r.name.trim() || r.qtyPerTray);
      result = await addMenuItemWithRecipe({
        name: form.name,
        category: form.category,
        price: form.price,
        minLevel: form.minLevel,
        trays: form.qty,
        ingredients: used.map((r) => {
          const existing = findExisting(r.name);
          return existing
            ? { name: existing.name, qtyPerTray: r.qtyPerTray }
            : {
                name: r.name, qtyPerTray: r.qtyPerTray,
                unit: r.unit, category: r.category, minLevel: r.minLevel,
                hasExpiry: r.hasExpiry === 'yes', qty: r.qty, expiry: r.expiry,
              };
        }),
      });
    } else {
      result = await addItem(form);
    }

    setBusy(false);
    if (!result.ok) return setError(result.message);
    onDone(result);
    onClose();
  };

  return (
    <Modal title="Add menu item" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="mi-type">Type</label>
          <select id="mi-type" value={form.type} onChange={set('type')}>
            <option value="food">Food (sold per serving)</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="mi-name">Name</label>
          <input id="mi-name" value={form.name} onChange={set('name')} autoFocus />
        </div>
        {isFood && (
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
        </div>

        {isFood && (
          <fieldset className="field">
            <legend>Recipe : ingredients for 1 platter (10 servings)</legend>
            <datalist id="recipe-ingredient-names">
              {ingredients.map((i) => (
                <option key={i.id} value={i.name} />
              ))}
            </datalist>

            {rows.map((r, idx) => {
              const existing = findExisting(r.name);
              const isNew = r.name.trim() && !existing;
              const need = (Number(r.qtyPerTray) || 0) * trays;
              const startQty = Number(r.qty) || 0;
              return (
                <div key={r.key} className="recipe-row">
                  <div className="field">
                    <label htmlFor={`mi-ing-${r.key}`}>Ingredient {idx + 1}</label>
                    <input
                      id={`mi-ing-${r.key}`} list="recipe-ingredient-names" autoComplete="off"
                      value={r.name} onChange={setRow(r.key, 'name')}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`mi-qpt-${r.key}`}>
                      Quantity per platter{existing ? ` (${existing.unit})` : r.unit ? ` (${r.unit})` : ''}
                    </label>
                    <input
                      id={`mi-qpt-${r.key}`} type="number" min="0" step="any"
                      value={r.qtyPerTray} onChange={setRow(r.key, 'qtyPerTray')}
                    />
                    {existing && (
                      <span className="hint">In stock: {existing.qtyUsable} {existing.unit}</span>
                    )}
                  </div>

                  {isNew && (
                    <div className="info-box">
                      <p>{r.name.trim()} is not in Inventory yet. It will be added when you save.</p>
                      <div className="field">
                        <label htmlFor={`mi-unit-${r.key}`}>Unit</label>
                        <input
                          id={`mi-unit-${r.key}`} value={r.unit} onChange={setRow(r.key, 'unit')}
                          placeholder="kg, L, pcs"
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`mi-icat-${r.key}`}>Category</label>
                        <select id={`mi-icat-${r.key}`} value={r.category} onChange={setRow(r.key, 'category')}>
                          {INGREDIENT_CATEGORIES.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor={`mi-imin-${r.key}`}>Low-stock level</label>
                        <input
                          id={`mi-imin-${r.key}`} type="number" min="0" step="any"
                          value={r.minLevel} onChange={setRow(r.key, 'minLevel')}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`mi-iexp-${r.key}`}>Expiry</label>
                        <select id={`mi-iexp-${r.key}`} value={r.hasExpiry} onChange={setRow(r.key, 'hasExpiry')}>
                          <option value="no">No expiry date</option>
                          <option value="yes">Has an expiry date</option>
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor={`mi-iqty-${r.key}`}>
                          {r.hasExpiry === 'yes' ? 'Quantity received' : 'Starting quantity (optional)'}
                        </label>
                        <input
                          id={`mi-iqty-${r.key}`} type="number" min="0" step="any"
                          value={r.qty} onChange={setRow(r.key, 'qty')}
                        />
                      </div>
                      {r.hasExpiry === 'yes' && (
                        <div className="field">
                          <label htmlFor={`mi-idate-${r.key}`}>Expiry date of this batch</label>
                          <input
                            id={`mi-idate-${r.key}`} type="date" min={todayStr()}
                            value={r.expiry} onChange={setRow(r.key, 'expiry')}
                          />
                        </div>
                      )}
                      {trays > 0 && startQty < need && (
                        <p className="hint">
                          {trays} {trays === 1 ? 'tray needs' : 'trays need'} {need} of this, so enter at least
                          that as the starting quantity or clear the platter below.
                        </p>
                      )}
                    </div>
                  )}

                  {rows.length > 1 && (
                    <button type="button" className="btn btn-secondary" onClick={() => removeRow(r.key)}>
                      Remove
                    </button>
                  )}
                </div>
              );
            })}

            <button type="button" className="btn btn-secondary" onClick={() => setRows([...rows, newRow()])}>
              + Add ingredient
            </button>
          </fieldset>
        )}

        <div className="field">
          <label htmlFor="mi-qty">Platters cooked today (optional)</label>
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