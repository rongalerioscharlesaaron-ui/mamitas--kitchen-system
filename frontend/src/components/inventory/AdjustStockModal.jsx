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
  const { items, batches, adjustBatch } = useInventory();

  const batchesOf = (itemId) =>
    batches
      .filter((b) => b.itemId === Number(itemId) && b.qty > 0)
      .sort((a, b) => a.code.localeCompare(b.code));

  const [form, setForm] = useState(() => {
    const list = defaultItemId ? batchesOf(defaultItemId) : [];
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
  const list = item ? batchesOf(item.id) : [];
  const batch = list.find((b) => b.id === Number(form.batchId));
  const whole = item && item.type !== 'ingredient';
  const counted = form.counted === '' ? null : Number(form.counted);
  const diff =
    batch && counted !== null && !Number.isNaN(counted)
      ? Math.round((counted - batch.qty) * 1000) / 1000
      : null;

  const onItem = (e) => {
    const itemId = e.target.value;
    const options = itemId ? batchesOf(itemId) : [];
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
    setBusy(true);
    setError('');
    const result = await adjustBatch({
      batchId: Number(form.batchId) || null,
      countedQty: form.counted,
      reason: form.reason,
    });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    onDone(result);
    onClose();
  };

  return (
    <Modal title="Adjust stock" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="info-box">
          Use this after a real stock count. The batch is set to the quantity you counted, and the difference is
          saved in the movement log as an Adjustment.
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

        <div className="field">
          <label htmlFor="as-counted">3. Quantity you counted {item ? `(${item.unit})` : ''}</label>
          <input
            id="as-counted" type="number" min="0" step={whole ? '1' : 'any'}
            value={form.counted} onChange={set('counted')} disabled={!batch}
          />
          {diff !== null && (
            <span className="hint">
              {diff === 0
                ? 'Same as the system. Nothing to adjust.'
                : `The system shows ${batch.qty} ${item.unit}. Difference: ${diff > 0 ? '+' : ''}${diff} ${item.unit}.`}
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