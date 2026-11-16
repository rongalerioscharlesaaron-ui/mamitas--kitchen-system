import { useState } from 'react';
import Modal from '../Modal';
import { useInventory } from '../../context/InventoryContext';
import { expiryStatus, fmtDate } from '../../utils/dates';

const GROUPS = [
  ['ingredient', 'Ingredients'],
  ['food', 'Foods'],
  ['food_tray', 'Food trays'],
];

export default function AdjustStockModal({ defaultItemId = '', types = null, onClose, onDone }) {
  const { items, batches, usableStockByItem, adjustBatch, adjustMenuStock } = useInventory();

  const batchesOf = (itemId) =>
    batches
      .filter((b) => b.itemId === Number(itemId) && b.qty > 0)
      .sort((a, b) => a.code.localeCompare(b.code));

  const [form, setForm] = useState(() => {
    const first = items.find((i) => i.id === Number(defaultItemId));
    const list = first && first.type === 'ingredient' ? batchesOf(first.id) : [];
    return {
      itemId: defaultItemId ? String(defaultItemId) : '',
      batchId: list.length === 1 ? String(list[0].id) : '',
      counted: '',
      reason: '',
    };
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const item = items.find((i) => i.id === Number(form.itemId));
  const isMenu = item && item.type !== 'ingredient';
  const list = item && !isMenu ? batchesOf(item.id) : [];
  const batch = list.find((b) => b.id === Number(form.batchId));
  const system = isMenu ? usableStockByItem[item.id] || 0 : batch?.qty;
  const counted = form.counted === '' ? null : Number(form.counted);
  const diff =
    system !== undefined && counted !== null && !Number.isNaN(counted)
      ? Math.round((counted - system) * 1000) / 1000
      : null;
  const ready = isMenu || Boolean(batch);

  const onItem = (e) => {
    const itemId = e.target.value;
    const chosen = items.find((i) => i.id === Number(itemId));
    const options = chosen && chosen.type === 'ingredient' ? batchesOf(itemId) : [];
    setForm({ ...form, itemId, batchId: options.length === 1 ? String(options[0].id) : '', counted: '' });
  };

  const batchLabel = (b) => {
    const when = b.expiry
      ? `${expiryStatus(b.expiry) === 'expired' ? 'expired' : 'expires'} ${fmtDate(b.expiry)}`
      : 'no expiry';
    return `${b.code}, ${b.qty} ${item.unit} in the system, ${when}`;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!item) return setError('Choose an item.');
    setBusy(true);
    setError('');
    const result = isMenu
      ? await adjustMenuStock({ itemId: item.id, countedQty: form.counted, reason: form.reason })
      : await adjustBatch({ batchId: Number(form.batchId) || null, countedQty: form.counted, reason: form.reason });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    onDone(result);
    onClose();
  };

  return (
    <Modal title="Adjust stock" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="info-box">
          Use this after a real count. The stock is set to the quantity you counted, and the difference is saved in the
          movement log as an Adjustment.
        </div>

        <div className="field">
          <label htmlFor="as-item">1. Item</label>
          <select id="as-item" value={form.itemId} onChange={onItem}>
            <option value="">Select item</option>
            {GROUPS.filter(([t]) => !types || types.includes(t)).map(([t, label]) => {
              const group = items.filter((i) => i.type === t);
              if (group.length === 0) return null;
              return (
                <optgroup key={t} label={label}>
                  {group.map((i) => (
                    <option key={i.id} value={i.id}>{i.name}</option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </div>

        {isMenu ? (
          <p className="hint" style={{ margin: '0 0 14px' }}>
            For foods and trays you count today&apos;s servings. No batch is needed.
          </p>
        ) : (
          <div className="field">
            <label htmlFor="as-batch">2. Batch ID</label>
            <select id="as-batch" value={form.batchId} onChange={set('batchId')} disabled={!item}>
              <option value="">
                {!item ? 'Select an item first' : list.length ? 'Select batch' : 'No batches in stock'}
              </option>
              {list.map((b) => (
                <option key={b.id} value={b.id}>{batchLabel(b)}</option>
              ))}
            </select>
            <span className="hint">Count each batch separately.</span>
          </div>
        )}

        <div className="field">
          <label htmlFor="as-counted">
            {isMenu ? '2.' : '3.'} Quantity you counted {item ? `(${item.unit})` : ''}
          </label>
          <input
            id="as-counted" type="number" min="0" step={isMenu ? '1' : 'any'}
            value={form.counted} onChange={set('counted')} disabled={!ready}
          />
          {diff !== null && (
            <span className="hint">
              {diff === 0
                ? 'Same as the system. Nothing to adjust.'
                : `The system shows ${system} ${item.unit}. Difference: ${diff > 0 ? '+' : ''}${diff} ${item.unit}.`}
            </span>
          )}
        </div>

        <div className="field">
          <label htmlFor="as-reason">Reason</label>
          <input id="as-reason" list="adjust-reasons" value={form.reason} onChange={set('reason')} />
          <datalist id="adjust-reasons">
            <option value="Stock count" />
            <option value="Opening count correction" />
            <option value="Recount" />
            <option value="Supplier short delivery" />
            <option value="Found extra stock" />
            <option value="Measuring error" />
          </datalist>
        </div>

        {error && <p className="error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || diff === 0}>
            {busy ? 'Saving...' : 'Save adjustment'}
          </button>
        </div>
      </form>
    </Modal>
  );
}