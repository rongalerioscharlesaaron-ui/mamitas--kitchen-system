import { useMemo, useState } from 'react';
import { useInventory } from '../../context/InventoryContext';
import StatusBadge from '../../components/StatusBadge';
import AddItemModal from '../../components/inventory/AddItemModal';
import StockInModal from '../../components/inventory/StockInModal';
import RecordLossModal from '../../components/inventory/RecordLossModal';
import { stockStatus } from '../../utils/inventory';
import { fmtDate } from '../../utils/dates';

const INGREDIENT = ['ingredient'];

export default function InventoryStock() {
  const { items, batches, stockByItem } = useInventory();
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null); // { kind: 'add' | 'stockin' | 'loss', itemId? }
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

  const rows = items.filter(
    (i) => i.type === 'ingredient' && i.name.toLowerCase().includes(search.trim().toLowerCase())
  );
  const close = () => setModal(null);

  return (
    <div>
      <div className="page-head">
        <h1>Inventory Stock</h1>
        <div className="actions">
          <button className="btn btn-primary" onClick={() => setModal({ kind: 'add' })}>+ Add ingredient</button>
          <button className="btn btn-secondary" onClick={() => setModal({ kind: 'stockin' })}>Stock in</button>
          <button className="btn btn-secondary" onClick={() => setModal({ kind: 'loss' })}>Record damage</button>
        </div>
      </div>
      <p className="muted">Raw ingredients and supplies. Foods and food trays are managed in Menu.</p>

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

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Ingredient</th><th className="num">In stock</th><th className="num">Low-stock level</th>
              <th>Status</th><th>Next expiry</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan="6" className="empty">No ingredients found.</td></tr>
            )}
            {rows.map((i) => {
              const stock = stockByItem[i.id] || 0;
              const st = stockStatus(stock, i.minLevel);
              return (
                <tr key={i.id}>
                  <td>{i.name}</td>
                  <td className="num">{stock} {i.unit}</td>
                  <td className="num">{i.minLevel} {i.unit}</td>
                  <td><StatusBadge tone={st.tone}>{st.label}</StatusBadge></td>
                  <td>{fmtDate(nextExpiry[i.id])}</td>
                  <td>
                    <div className="actions">
                      <button className="btn btn-secondary btn-sm" onClick={() => setModal({ kind: 'stockin', itemId: i.id })}>Stock in</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setModal({ kind: 'loss', itemId: i.id })}>Damage</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modal?.kind === 'add' && <AddItemModal onClose={close} onDone={setNotice} />}
      {modal?.kind === 'stockin' && (
        <StockInModal types={INGREDIENT} defaultItemId={modal.itemId} onClose={close} onDone={setNotice} />
      )}
      {modal?.kind === 'loss' && (
        <RecordLossModal types={INGREDIENT} defaultItemId={modal.itemId} onClose={close} onDone={setNotice} />
      )}
    </div>
  );
}