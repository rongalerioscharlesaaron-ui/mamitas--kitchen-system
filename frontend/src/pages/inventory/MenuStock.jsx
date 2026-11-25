import { useMemo, useState } from 'react';
import { useInventory } from '../../context/InventoryContext';
import StatusBadge from '../../components/StatusBadge';
import ConfirmDialog from '../../components/ConfirmDialog';
import AddMenuItemModal from '../../components/inventory/AddMenuItemModal';
import EditMenuItemModal from '../../components/inventory/EditMenuItemModal';
import StockInModal from '../../components/inventory/StockInModal';
import RecordLossModal from '../../components/inventory/RecordLossModal';
import AdjustStockModal from '../../components/inventory/AdjustStockModal';
import { stockStatus } from '../../utils/inventory';
import { expiryStatus } from '../../utils/dates';
import { formatMoney } from '../../utils/money';

const MENU_TYPES = ['food', 'food_tray'];

function MenuTable({ title, nameLabel, qtyLabel, showCategory, rows, available, expired, onAction, emptyText }) {
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
              <th className="num">Leftovers</th>
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
              const left = expired[i.id] || 0;
              return (
                <tr key={i.id}>
                  <td>{i.name}</td>
                  {showCategory && <td>{i.category}</td>}
                  <td className="num">{formatMoney(i.price)}</td>
                  <td className="num">{qty} {i.unit}</td>
                  <td className="num">{i.minLevel} {i.unit}</td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                      <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                      {i.isEnabled === false && <StatusBadge tone="danger">Disabled</StatusBadge>}
                    </div>
                  </td>
                  <td className="num">
                    {left > 0 ? <StatusBadge tone="danger">{left} {i.unit}</StatusBadge> : 'None'}
                  </td>
                  <td>
                    <div className="actions">
                      <button
                        className="btn btn-secondary btn-sm"
                        disabled={i.isEnabled === false}
                        title={i.isEnabled === false ? 'Disabled by the owner. Enable it in Administration > Menu Management.' : undefined}
                        onClick={() => onAction('stockin', i)}
                      >
                        Add trays
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => onAction('adjust', i)}>Adjust</button>
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
  const { items, batches, itemMap, usableStockByItem, writeOffExpiredMenu } = useInventory();
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null); // { kind, item? }
  const [notice, setNotice] = useState(null);
  const [confirmAll, setConfirmAll] = useState(false);

  // Servings and trays left over from an earlier day cannot be sold. They are counted here.
  const expired = useMemo(() => {
    const map = {};
    batches.forEach((b) => {
      const item = itemMap[b.itemId];
      if (item && item.type !== 'ingredient' && b.qty > 0 && b.expiry && expiryStatus(b.expiry) === 'expired') {
        map[b.itemId] = (map[b.itemId] || 0) + b.qty;
      }
    });
    return map;
  }, [batches, itemMap]);
  const expiredItems = Object.keys(expired).length;
  const expiredTotal = Object.values(expired).reduce((sum, n) => sum + n, 0);

  const match = (i) => i.name.toLowerCase().includes(search.trim().toLowerCase());
  const foods = items.filter((i) => i.type === 'food' && match(i));
  const trays = items.filter((i) => i.type === 'food_tray' && match(i));
  const close = () => setModal(null);
  const onAction = (kind, item) => setModal({ kind, item });

  const writeOffAll = async () => {
    setConfirmAll(false);
    setNotice(await writeOffExpiredMenu());
  };

  return (
    <div>
      <div className="page-head">
        <h1>Menu</h1>
        <button className="btn btn-primary" onClick={() => setModal({ kind: 'add' })}>+ Add menu item</button>
      </div>
      <p className="muted">
        Dishes are cooked fresh each day. Foods are added by the tray (1 tray = 10 servings), and adding
        trays takes the dish's ingredients out of inventory, oldest batch first. Servings added today are available
        until the end of the day, then they expire. Each item sold at the cashier takes one serving from
        here.
      </p>

      {expiredItems > 0 && (
        <div className="notice notice-error" role="status">
          <span>
            {expiredItems} {expiredItems === 1 ? 'item has' : 'items have'} expired leftovers from earlier days
            ({expiredTotal} in total). They cannot be sold.
          </span>
          <button className="btn btn-danger btn-sm" onClick={() => setConfirmAll(true)}>
            Write off all expired
          </button>
        </div>
      )}

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
        title="Foods" nameLabel="Food" qtyLabel="Servings" showCategory
        rows={foods} available={usableStockByItem} expired={expired}
        onAction={onAction} emptyText="No foods found."
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

      {confirmAll && (
        <ConfirmDialog
          title="Write off all expired?"
          message={`Write off ${expiredTotal} expired servings and trays from ${expiredItems} ${expiredItems === 1 ? 'item' : 'items'}. They are recorded in the movement log as Spoiled and this cannot be undone.`}
          confirmLabel="Write off all"
          onConfirm={writeOffAll}
          onCancel={() => setConfirmAll(false)}
        />
      )}
    </div>
  );
}