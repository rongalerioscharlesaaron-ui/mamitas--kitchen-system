import { useMemo, useState } from 'react';
import { useInventory } from '../../context/InventoryContext';
import StatusBadge from '../../components/StatusBadge';
import ConfirmDialog from '../../components/ConfirmDialog';
import { EXPIRY_INFO, TYPE_LABEL } from '../../utils/inventory';
import {
  daysText, daysUntil, expiryStatus, fmtDate, EXPIRING_SOON_DAYS,
} from '../../utils/dates';

function IngredientExpiryTable({ rows, all, onWriteOff }) {
  const expired = all.filter((r) => r.status === 'expired').length;
  const soon = all.filter((r) => r.status === 'soon').length;

  return (
    <section>
      <div className="section-head">
        <h2>Inventory items</h2>
        <StatusBadge tone="danger">Expired: {expired}</StatusBadge>
        <StatusBadge tone="warn">Expiring soon: {soon}</StatusBadge>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Batch ID</th>
              <th>Item</th>
              <th>Category</th>
              <th>Received</th>
              <th className="num">Qty left</th>
              <th>Expiry date</th>
              <th>Time left</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan="9" className="empty">No ingredient batches found.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.b.id}>
                <td className="batch-id">{r.b.code}</td>
                <td>{r.item.name}</td>
                <td>{r.item.category}</td>
                <td>{fmtDate(r.b.received)}</td>
                <td className="num">{r.b.qty} {r.item.unit}</td>
                <td>{fmtDate(r.b.expiry)}</td>
                <td>{daysText(r.days)}</td>
                <td>
                  <StatusBadge tone={EXPIRY_INFO[r.status].tone}>{EXPIRY_INFO[r.status].label}</StatusBadge>
                </td>
                <td>
                  {r.status === 'expired' && (
                    <button className="btn btn-danger btn-sm" onClick={() => onWriteOff(r)}>Write off</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MenuExpiryTable({ rows, expiredCount, onWriteOff, onWriteOffAll }) {
  return (
    <section>
      <div className="section-head">
        <h2>Menu items</h2>
        <StatusBadge tone="danger">Expired: {expiredCount}</StatusBadge>
        {expiredCount > 0 && (
          <button className="btn btn-danger btn-sm" onClick={onWriteOffAll}>Write off all expired</button>
        )}
      </div>
      <p className="muted">
        Foods and trays are cooked fresh for the day. Servings added today expire at the end of the day, and no batch
        is kept for them.
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Type</th>
              <th className="num">Servings or trays</th>
              <th>Expiry date</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan="6" className="empty">No menu items found.</td></tr>
            )}
            {rows.map((g) => (
              <tr key={g.key}>
                <td>{g.item.name}</td>
                <td>{TYPE_LABEL[g.item.type]}</td>
                <td className="num">{g.qty} {g.item.unit}</td>
                <td>{g.status === 'today' ? 'Today' : fmtDate(g.expiry)}</td>
                <td>
                  {g.status === 'expired' ? (
                    <StatusBadge tone="danger">Expired</StatusBadge>
                  ) : (
                    <StatusBadge tone="info">Expires today</StatusBadge>
                  )}
                </td>
                <td>
                  {g.status === 'expired' && (
                    <button className="btn btn-danger btn-sm" onClick={() => onWriteOff(g)}>Write off</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function ExpirationMonitoring() {
  const { batches, itemMap, writeOffBatch, writeOffExpiredMenu } = useInventory();
  const [filter, setFilter] = useState('all');
  const [notice, setNotice] = useState(null);
  const [pending, setPending] = useState(null); // an ingredient batch
  const [pendingMenu, setPendingMenu] = useState(null); // { item } for one item, {} for the whole menu

  const ingredientRows = useMemo(
    () =>
      batches
        .filter((b) => b.qty > 0 && b.expiry && itemMap[b.itemId]?.type === 'ingredient')
        .map((b) => ({
          b,
          item: itemMap[b.itemId],
          status: expiryStatus(b.expiry),
          days: daysUntil(b.expiry),
        })),
    [batches, itemMap]
  );

  // Foods and trays: one line per item and day, with no batch IDs
  const menuGroups = useMemo(() => {
    const map = {};
    batches.forEach((b) => {
      const item = itemMap[b.itemId];
      if (!item || item.type === 'ingredient' || b.qty <= 0 || !b.expiry) return;
      const key = `${b.itemId}|${b.expiry}`;
      if (!map[key]) {
        map[key] = {
          key, item, expiry: b.expiry, qty: 0,
          status: expiryStatus(b.expiry) === 'expired' ? 'expired' : 'today',
        };
      }
      map[key].qty += b.qty;
    });
    return Object.values(map).sort(
      (x, y) => x.expiry.localeCompare(y.expiry) || x.item.name.localeCompare(y.item.name)
    );
  }, [batches, itemMap]);

  const counts = {
    expired: ingredientRows.filter((r) => r.status === 'expired').length
      + menuGroups.filter((g) => g.status === 'expired').length,
    soon: ingredientRows.filter((r) => r.status === 'soon').length,
    ok: ingredientRows.filter((r) => r.status === 'ok').length,
  };

  const shownIngredients = ingredientRows
    .filter((r) => filter === 'all' || r.status === filter)
    .sort((x, y) => x.b.expiry.localeCompare(y.b.expiry));
  const shownMenu = menuGroups.filter(
    (g) =>
      filter === 'all' ||
      (filter === 'expired' && g.status === 'expired') ||
      (filter === 'soon' && g.status === 'today')
  );
  const menuExpiredCount = menuGroups.filter((g) => g.status === 'expired').length;
  const menuExpiredQty = menuGroups
    .filter((g) => g.status === 'expired')
    .reduce((sum, g) => sum + g.qty, 0);

  const confirmWriteOff = async () => {
    const result = await writeOffBatch(pending.b.id);
    setNotice(result);
    setPending(null);
  };
  const confirmWriteOffMenu = async () => {
    const result = await writeOffExpiredMenu(pendingMenu.item?.id);
    setNotice(result);
    setPendingMenu(null);
  };

  return (
    <div>
      <div className="page-head">
        <h1>Expiration Monitoring</h1>
        <div className="actions">
          <StatusBadge tone="danger">Expired: {counts.expired}</StatusBadge>
          <StatusBadge tone="warn">Expiring soon: {counts.soon}</StatusBadge>
          <StatusBadge tone="ok">OK: {counts.ok}</StatusBadge>
        </div>
      </div>
      <p className="muted">
        Ingredients expiring soon means within {EXPIRING_SOON_DAYS} days. Ingredient rows are single batches. Items
        without an expiry date are not listed.
      </p>

      {notice && (
        <div className={`notice notice-${notice.ok ? 'ok' : 'error'}`} role="status">
          <span>{notice.message}</span>
          <button className="icon-btn" onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      <div className="toolbar">
        <select aria-label="Filter by expiry status" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All</option>
          <option value="expired">Expired</option>
          <option value="soon">Expiring soon or today</option>
          <option value="ok">OK</option>
        </select>
      </div>

      <IngredientExpiryTable rows={shownIngredients} all={ingredientRows} onWriteOff={setPending} />
      <MenuExpiryTable
        rows={shownMenu}
        expiredCount={menuExpiredCount}
        onWriteOff={(g) => setPendingMenu({ item: g.item })}
        onWriteOffAll={() => setPendingMenu({})}
      />

      {pending && (
        <ConfirmDialog
          title="Write off expired stock?"
          message={`Write off ${pending.b.qty} ${pending.item.unit} of ${pending.item.name} (batch ${pending.b.code}) as expired. This is recorded in the movement logs and cannot be undone.`}
          confirmLabel="Write off"
          onConfirm={confirmWriteOff}
          onCancel={() => setPending(null)}
        />
      )}
      {pendingMenu && (
        <ConfirmDialog
          title="Write off expired servings?"
          message={
            pendingMenu.item
              ? `Write off all expired ${pendingMenu.item.unit} of ${pendingMenu.item.name}. This is recorded in the movement logs as Spoiled and cannot be undone.`
              : `Write off ${menuExpiredQty} expired servings and trays from ${menuExpiredCount} ${menuExpiredCount === 1 ? 'line' : 'lines'}. This is recorded in the movement logs as Spoiled and cannot be undone.`
          }
          confirmLabel="Write off"
          onConfirm={confirmWriteOffMenu}
          onCancel={() => setPendingMenu(null)}
        />
      )}
    </div>
  );
}