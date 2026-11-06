import { useMemo, useState } from 'react';
import { useInventory } from '../../context/InventoryContext';
import StatusBadge from '../../components/StatusBadge';
import AddItemModal from '../../components/inventory/AddItemModal';
import StockInModal from '../../components/inventory/StockInModal';
import RecordLossModal from '../../components/inventory/RecordLossModal';
import { INGREDIENT_CATEGORIES, stockStatus } from '../../utils/inventory';
import { fmtDate } from '../../utils/dates';

const INGREDIENT = ['ingredient'];

function IngredientTable({ title, rows, batches, stockByItem, nextExpiry, onAction }) {
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
              const stock = stockByItem[i.id] || 0;
              const st = stockStatus(stock, i.minLevel);
              const count = batches.filter((b) => b.itemId === i.id && b.qty > 0).length;
              return (
                <tr key={i.id}>
                  <td>{i.name}</td>
                  <td className="num">{stock} {i.unit}</td>
                  <td className="num">{i.minLevel} {i.unit}</td>
                  <td><StatusBadge tone={st.tone}>{st.label}</StatusBadge></td>
                  <td className="num">{count}</td>
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
                      <button className="btn btn-secondary btn-sm" onClick={() => onAction('loss', i)}>
                        Damage
                      </button>
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

export default function InventoryStock() {
  const { items, batches, stockByItem } = useInventory();
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null); // { kind: 'add' | 'addbatch' | 'stockin' | 'loss', item? }
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
  const onAction = (kind, item) => setModal({ kind, item });

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
      <p className="muted">
        Ingredients with an expiry date are added as batches through Add ingredient. Stock in is for ingredients
        without an expiry date. Foods and food trays are managed in Menu.
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
          stockByItem={stockByItem}
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
    </div>
  );
}