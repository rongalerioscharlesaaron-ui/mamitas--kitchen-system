import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useInventory } from '../../context/InventoryContext';
import StatusBadge from '../../components/StatusBadge';
import Modal from '../../components/Modal';
import AddItemModal from '../../components/inventory/AddItemModal';
import StockInModal from '../../components/inventory/StockInModal';
import RecordLossModal from '../../components/inventory/RecordLossModal';
import AdjustStockModal from '../../components/inventory/AdjustStockModal';
import EditIngredientModal from '../../components/inventory/EditIngredientModal';
import { EXPIRY_INFO, INGREDIENT_CATEGORIES, stockStatus } from '../../utils/inventory';
import { fmtDate } from '../../utils/dates';

const INGREDIENT = ['ingredient'];

function EditBatchExpiryModal({ item, batch, onClose, onDone }) {
  const { updateBatchExpiry } = useInventory();
  const initialDate = batch.expiry ? String(batch.expiry).slice(0, 10) : '';
  const [expiry, setExpiry] = useState(initialDate);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!expiry) {
      setError('Choose an expiry date.');
      return;
    }
    setBusy(true);
    setError('');
    const res = await updateBatchExpiry({ batchId: batch.id, expiry });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    onDone?.(res);
    onClose();
  };

  return (
    <Modal title={`Edit Expiry — ${item.name} (${batch.code})`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="b-exp">Expiry date</label>
          <input
            id="b-exp"
            type="date"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            required
          />
          <span className="hint">
            Remaining stock in this batch: <strong>{batch.qty} {item.unit}</strong>
          </span>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving...' : 'Save Expiry Date'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function IngredientTable({ title, rows, batches, usableStockByItem, nextExpiry, onAction }) {
  const [expanded, setExpanded] = useState({});

  const toggleExpand = (id) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <section>
      <div className="section-head">
        <h2>{title}</h2>
        <StatusBadge tone="muted">{rows.length}</StatusBadge>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Ingredient</th>
              <th className="num">In stock</th>
              <th className="num">Low-stock level</th>
              <th>Status</th>
              <th className="num">Batches</th>
              <th>Next expiry</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan="7" className="empty">No ingredients found.</td></tr>
            )}
            {rows.map((i) => {
              const itemBatches = batches.filter((b) => b.itemId === i.id && b.qty > 0);
              const hasExpired = itemBatches.some((b) => b.expiryStatus === 'expired');
              const usable = usableStockByItem[i.id] ?? 0;
              const st = stockStatus(usable, i.minLevel, { hasExpired });
              const isOpen = Boolean(expanded[i.id]);

              return (
                <Fragment key={i.id}>
                  <tr>
                    <td>
                      <button
                        type="button"
                        onClick={() => toggleExpand(i.id)}
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? 'Hide' : 'Show'} batches for ${i.name}`}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          background: 'transparent',
                          border: 'none',
                          padding: 0,
                          font: 'inherit',
                          fontWeight: 600,
                          color: 'inherit',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        {isOpen ? (
                          <ChevronDown size={16} aria-hidden="true" />
                        ) : (
                          <ChevronRight size={16} aria-hidden="true" />
                        )}
                        <span>{i.name}</span>
                      </button>
                    </td>
                    <td className="num">
                      {usable} {i.unit}
                      {hasExpired && usable > 0 && (
                        <div className="muted" style={{ fontSize: '0.78rem' }}>
                          (+ expired batch)
                        </div>
                      )}
                    </td>
                    <td className="num">{i.minLevel} {i.unit}</td>
                    <td><StatusBadge tone={st.tone}>{st.label}</StatusBadge></td>
                    <td className="num">{itemBatches.length}</td>
                    <td>{i.hasExpiry ? fmtDate(nextExpiry[i.id]) : 'No expiry'}</td>
                    <td>
                      <div className="actions">
                        {i.hasExpiry ? (
                          <button className="btn btn-secondary btn-sm" onClick={() => onAction('addbatch', i)}>
                            Add batch
                          </button>
                        ) : (
                          <button className="btn btn-secondary btn-sm" onClick={() => onAction('stockin', i)}>
                            Stock in
                          </button>
                        )}
                        <button className="btn btn-secondary btn-sm" onClick={() => onAction('loss', i)}>Damage</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => onAction('adjust', i)}>Adjust</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => onAction('edit', i)}>Edit</button>
                      </div>
                    </td>
                  </tr>

                  {isOpen && (
                    <tr>
                      <td colSpan="7" style={{ background: 'var(--cream, #faf6f0)', padding: '10px 16px 14px 36px' }}>
                        {itemBatches.length === 0 ? (
                          <span className="muted">No active batches in stock for {i.name}.</span>
                        ) : (
                          <table className="table" style={{ margin: 0, background: '#fff' }}>
                            <thead>
                              <tr>
                                <th>Batch Code</th>
                                <th className="num">Remaining</th>
                                <th>Received Date</th>
                                <th>Expiry Date</th>
                                <th>Batch Status</th>
                                {i.hasExpiry && <th>Actions</th>}
                              </tr>
                            </thead>
                            <tbody>
                              {itemBatches.map((b) => {
                                const info = EXPIRY_INFO[b.expiryStatus] || EXPIRY_INFO.none;
                                return (
                                  <tr key={b.id}>
                                    <td><code>{b.code}</code></td>
                                    <td className="num"><strong>{b.qty} {i.unit}</strong></td>
                                    <td>{fmtDate(b.received)}</td>
                                    <td>{b.expiry ? fmtDate(b.expiry) : 'No expiry'}</td>
                                    <td><StatusBadge tone={info.tone}>{info.label}</StatusBadge></td>
                                    {i.hasExpiry && (
                                      <td>
                                        <button
                                          type="button"
                                          className="btn btn-secondary btn-sm"
                                          onClick={() => onAction('editexpiry', i, b)}
                                        >
                                          Edit expiry
                                        </button>
                                      </td>
                                    )}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function InventoryStock() {
  const { items, batches, usableStockByItem } = useInventory();
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null); // { kind, item?, batch? }
  const [notice, setNotice] = useState(null);

  const nextExpiry = useMemo(() => {
    const map = {};
    batches.forEach((b) => {
      if (b.qty > 0 && b.expiry && (!map[b.itemId] || b.expiry < map[b.itemId])) {
        map[b.itemId] = b.expiry;
      }
    });
    return map;
  }, [batches]);

  const match = (i) => i.name.toLowerCase().includes(search.trim().toLowerCase());
  const ingredients = items.filter((i) => i.type === 'ingredient' && match(i));
  const close = () => setModal(null);
  const onAction = (kind, item, batch = null) => setModal({ kind, item, batch });

  return (
    <div>
      <div className="page-head">
        <h1>Inventory Stock</h1>
        <div className="actions">
          <button className="btn btn-primary" onClick={() => setModal({ kind: 'add' })}>+ Add ingredient</button>
        </div>
      </div>
      <p className="muted">
        Ingredients with an expiry date are added as batches through Add ingredient. Stock in is for ingredients
        without an expiry date. Click an ingredient name to inspect its individual batches.
      </p>

      {notice && (
        <div className={`notice notice-${notice.ok ? 'ok' : 'error'}`} role="status">
          <span>{notice.message}</span>
          <button className="icon-btn" onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      <div className="toolbar">
        <input
          type="search" placeholder="Search ingredient" aria-label="Search ingredient"
          value={search} onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {INGREDIENT_CATEGORIES.map((cat) => (
        <IngredientTable
          key={cat}
          title={cat}
          rows={ingredients.filter((i) => i.category === cat)}
          batches={batches}
          usableStockByItem={usableStockByItem}
          nextExpiry={nextExpiry}
          onAction={onAction}
        />
      ))}

      {(modal?.kind === 'add' || modal?.kind === 'addbatch') && (
        <AddItemModal defaultName={modal.item?.name ?? ''} onClose={close} onDone={setNotice} />
      )}
      {modal?.kind === 'stockin' && (
        <StockInModal
          types={INGREDIENT} noExpiryOnly defaultItemId={modal.item?.id}
          onClose={close} onDone={setNotice}
        />
      )}
      {modal?.kind === 'loss' && (
        <RecordLossModal
          types={INGREDIENT} defaultItemId={modal.item?.id}
          onClose={close} onDone={setNotice}
        />
      )}
      {modal?.kind === 'adjust' && (
        <AdjustStockModal
          types={INGREDIENT} defaultItemId={modal.item?.id}
          onClose={close} onDone={setNotice}
        />
      )}
      {modal?.kind === 'edit' && (
        <EditIngredientModal item={modal.item} onClose={close} onDone={setNotice} />
      )}
      {modal?.kind === 'editexpiry' && modal.batch && (
        <EditBatchExpiryModal
          item={modal.item}
          batch={modal.batch}
          onClose={close}
          onDone={setNotice}
        />
      )}
    </div>
  );
}