import { useMemo, useState } from 'react';
import { useInventory } from '../../context/InventoryContext';
import StatusBadge from '../../components/StatusBadge';
import AddItemModal from '../../components/inventory/AddItemModal';
import StockInModal from '../../components/inventory/StockInModal';
import RecordLossModal from '../../components/inventory/RecordLossModal';
import { stockStatus, TYPE_LABEL } from '../../utils/inventory';
import { fmtDate } from '../../utils/dates';

export default function InventoryStock() {
  const { items, batches, stockByItem } = useInventory();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
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
    (i) =>
      (typeFilter === 'all' || i.type === typeFilter) &&
      i.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  const close = () => setModal(null);

  return (
    <div>
      <div className="page-head">
        <h2>Inventory Stock</h2>
        <div className="actions">
          <button className="btn btn-primary" onClick={() => setModal({ kind: 'add' })}>+ Add Item</button>
          <button className="btn btn-secondary" onClick={() => setModal({ kind: 'stockin' })}>Stock In</button>
          <button className="btn btn-secondary" onClick={() => setModal({ kind: 'loss' })}>Record Damage</button>
        </div>
      </div>

      {notice && (
        <div className={`notice notice-${notice.ok ? 'ok' : 'error'}`} role="status">
          <span>{notice.message}</span>
          <button className="icon-btn" onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      <div className="toolbar">
        <input
          type="search" placeholder="Search item" aria-label="Search item"
          value={search} onChange={(e) => setSearch(e.target.value)}
        />
        <select aria-label="Filter by type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="all">All types</option>
          <option value="ingredient">Ingredients</option>
          <option value="food_tray">Food Trays</option>
        </select>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Item</th><th>Type</th><th className="num">In stock</th>
              <th className="num">Low-stock level</th><th>Status</th><th>Next expiry</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan="7" className="empty">No items found.</td></tr>
            )}
            {rows.map((i) => {
              const stock = stockByItem[i.id] || 0;
              const st = stockStatus(stock, i.minLevel);
              return (
                <tr key={i.id}>
                  <td>{i.name}</td>
                  <td>{TYPE_LABEL[i.type]}</td>
                  <td className="num">{stock} {i.unit}</td>
                  <td className="num">{i.minLevel} {i.unit}</td>
                  <td><StatusBadge tone={st.tone}>{st.label}</StatusBadge></td>
                  <td>{fmtDate(nextExpiry[i.id])}</td>
                  <td>
                    <div className="actions">
                      <button className="btn btn-secondary btn-sm" onClick={() => setModal({ kind: 'stockin', itemId: i.id })}>Stock In</button>
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
      {modal?.kind === 'stockin' && <StockInModal defaultItemId={modal.itemId} onClose={close} onDone={setNotice} />}
      {modal?.kind === 'loss' && <RecordLossModal defaultItemId={modal.itemId} onClose={close} onDone={setNotice} />}
    </div>
  );
}