import { useMemo, useState } from 'react';
import { useInventory } from '../../context/InventoryContext';
import StatusBadge from '../../components/StatusBadge';
import AddMenuItemModal from '../../components/inventory/AddMenuItemModal';
import EditMenuItemModal from '../../components/inventory/EditMenuItemModal';
import StockInModal from '../../components/inventory/StockInModal';
import RecordLossModal from '../../components/inventory/RecordLossModal';
import AdjustStockModal from '../../components/inventory/AdjustStockModal';
import { stockStatus } from '../../utils/inventory';
import { fmtDate } from '../../utils/dates';
import { formatMoney } from '../../utils/money';

const MENU_TYPES = ['food', 'food_tray'];

function MenuTable({ title, nameLabel, qtyLabel, showCategory, rows, available, nextExpiry, onAction, emptyText }) {
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
              <th>{nameLabel}</th>
              {showCategory && <th>Category</th>}
              <th className="num">Price</th>
              <th className="num">{qtyLabel}</th>
              <th className="num">Low-stock level</th>
              <th>Status</th>
              <th>Next expiry</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={showCategory ? 8 : 7} className="empty">{emptyText}</td></tr>
            )}
            {rows.map((i) => {
              const qty = available[i.id] || 0;
              const st = stockStatus(qty, i.minLevel);
              return (
                <tr key={i.id}>
                  <td>{i.name}</td>
                  {showCategory && <td>{i.category}</td>}
                  <td className="num">{formatMoney(i.price)}</td>
                  <td className="num">{qty} {i.unit}</td>
                  <td className="num">{i.minLevel} {i.unit}</td>
                  <td><StatusBadge tone={st.tone}>{st.label}</StatusBadge></td>
                  <td>{fmtDate(nextExpiry[i.id])}</td>
                  <td>
                    <div className="actions">
                      <button className="btn btn-secondary btn-sm" onClick={() => onAction('stockin', i)}>
                        {i.type === 'food' ? 'Add servings' : 'Add trays'}
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => onAction('loss', i)}>Damage</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => onAction('adjust', i)}>Adjust</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => onAction('edit', i)}>Edit</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function MenuStock() {
  const { items, batches, usableStockByItem } = useInventory();
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null); // { kind, item? }
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
  const foods = items.filter((i) => i.type === 'food' && match(i));
  const trays = items.filter((i) => i.type === 'food_tray' && match(i));
  const close = () => setModal(null);
  const onAction = (kind, item) => setModal({ kind, item });

  return (
    <div>
      <div className="page-head">
        <h1>Menu</h1>
        <button className="btn btn-primary" onClick={() => setModal({ kind: 'add' })}>+ Add menu item</button>
      </div>
      <p className="muted">
        Servings and trays available for sale. Each item sold at the cashier takes one serving or one tray from here.
        After a real count, use Adjust to correct a batch.
      </p>

      {notice && (
        <div className={`notice notice-${notice.ok ? 'ok' : 'error'}`} role="status">
          <span>{notice.message}</span>
          <button className="icon-btn" onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      <div className="toolbar">
        <input
          type="search" placeholder="Search menu" aria-label="Search menu"
          value={search} onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <MenuTable
        title="Foods" nameLabel="Food" qtyLabel="Servings available" showCategory
        rows={foods} available={usableStockByItem} nextExpiry={nextExpiry}
        onAction={onAction} emptyText="No foods found."
      />
      <MenuTable
        title="Food trays" nameLabel="Food tray" qtyLabel="Trays available" showCategory={false}
        rows={trays} available={usableStockByItem} nextExpiry={nextExpiry}
        onAction={onAction} emptyText="No food trays found."
      />

      {modal?.kind === 'add' && <AddMenuItemModal onClose={close} onDone={setNotice} />}
      {modal?.kind === 'stockin' && (
        <StockInModal types={MENU_TYPES} defaultItemId={modal.item.id} onClose={close} onDone={setNotice} />
      )}
      {modal?.kind === 'loss' && (
        <RecordLossModal types={MENU_TYPES} defaultItemId={modal.item.id} onClose={close} onDone={setNotice} />
      )}
      {modal?.kind === 'adjust' && (
        <AdjustStockModal types={MENU_TYPES} defaultItemId={modal.item.id} onClose={close} onDone={setNotice} />
      )}
      {modal?.kind === 'edit' && <EditMenuItemModal item={modal.item} onClose={close} onDone={setNotice} />}
    </div>
  );
}