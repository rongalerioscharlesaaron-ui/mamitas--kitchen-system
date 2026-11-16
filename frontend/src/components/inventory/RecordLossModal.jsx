import { useState } from 'react';
import Modal from '../Modal';
import { useInventory } from '../../context/InventoryContext';
import { expiryStatus, fmtDate } from '../../utils/dates';

const GROUPS = [
  ['ingredient', 'Ingredients'],
  ['food', 'Foods'],
  ['food_tray', 'Food trays'],
];

export default function RecordLossModal({ defaultItemId = '', types = null, onClose, onDone }) {
  const { items, batches, usableStockByItem, recordLoss, recordMenuLoss } = useInventory();

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
      qty: '',
      type: 'DAMAGED',
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
  const available = isMenu ? usableStockByItem[item.id] || 0 : batch?.qty;
  const whole = isMenu;

  const onItem = (e) => {
    const itemId = e.target.value;
    const chosen = items.find((i) => i.id === Number(itemId));
    const options = chosen && chosen.type === 'ingredient' ? batchesOf(itemId) : [];
    setForm({ ...form, itemId, batchId: options.length === 1 ? String(options[0].id) : '', qty: '' });
  };

  const batchLabel = (b) => {
    const when = b.expiry
      ? `${expiryStatus(b.expiry) === 'expired' ? 'expired' : 'expires'} ${fmtDate(b.expiry)}`
      : 'no expiry';
    return `${b.code}, ${b.qty} ${item.unit} left, ${when}`;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!item) return setError('Choose an item.');
    setBusy(true);
    setError('');
    const result = isMenu
      ? await recordMenuLoss({ itemId: item.id, qty: form.qty, type: form.type, reason: form.reason })
      : await recordLoss({ ...form, itemId: item.id, batchId: Number(form.batchId) || null });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    onDone(result);
    onClose();
  };

  return (
    <Modal title="Record damaged or spoiled goods" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="rl-item">1. Item</label>
          <select id="rl-item" value={form.itemId} onChange={onItem}>
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
          <div className="info-box">
            Damaged or spoiled {item.unit} are taken from today&apos;s stock. Available today: {available} {item.unit}.
          </div>
        ) : (
          <div className="field">
            <label htmlFor="rl-batch">2. Batch ID</label>
            <select id="rl-batch" value={form.batchId} onChange={set('batchId')} disabled={!item}>
              <option value="">
                {!item ? 'Select an item first' : list.length ? 'Select batch' : 'No batches in stock'}
              </option>
              {list.map((b) => (
                <option key={b.id} value={b.id}>{batchLabel(b)}</option>
              ))}
            </select>
            <span className="hint">
              {batch
                ? `Batch ${batch.code} has ${batch.qty} ${item.unit} left.`
                : 'Choose the batch the goods came from, so each batch stays separate.'}
            </span>
          </div>
        )}

        <div className="field">
          <label htmlFor="rl-type">Label as</label>
          <select id="rl-type" value={form.type} onChange={set('type')}>
            <option value="DAMAGED">Damaged</option>
            <option value="SPOILED">Spoiled</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="rl-qty">Quantity {item ? `(${item.unit})` : ''}</label>
          <input
            id="rl-qty" type="number" min="0" max={available} step={whole ? '1' : 'any'}
            value={form.qty} onChange={set('qty')}
          />
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
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-danger" disabled={busy}>
            {busy ? 'Saving...' : 'Record'}
          </button>
        </div>
      </form>
    </Modal>
  );
}