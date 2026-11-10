import { useMemo, useState } from 'react';
import { useInventory } from '../../context/InventoryContext';
import StatusBadge from '../../components/StatusBadge';
import ConfirmDialog from '../../components/ConfirmDialog';
import { EXPIRY_INFO, TYPE_LABEL } from '../../utils/inventory';
import {
  daysText, daysUntil, expiryStatus, fmtDate, EXPIRING_SOON_DAYS,
} from '../../utils/dates';

function ExpiryTable({ title, kindLabel, kindOf, rows, all, onWriteOff, emptyText }) {
  const expired = all.filter((r) => r.status === 'expired').length;
  const soon = all.filter((r) => r.status === 'soon').length;

  return (
    <section>
      <div className="section-head">
        <h2>{title}</h2>
        <StatusBadge tone="danger">Expired: {expired}</StatusBadge>
        <StatusBadge tone="warn">Expiring soon: {soon}</StatusBadge>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Batch ID</th>
              <th>Item</th>
              <th>{kindLabel}</th>
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
              <tr><td colSpan="9" className="empty">{emptyText}</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.b.id}>
                <td className="batch-id">{r.b.code}</td>
                <td>{r.item.name}</td>
                <td>{kindOf(r.item)}</td>
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

export default function ExpirationMonitoring() {
  const { batches, itemMap, writeOffBatch } = useInventory();
  const [filter, setFilter] = useState('all');
  const [notice, setNotice] = useState(null);
  const [pending, setPending] = useState(null);

  const all = useMemo(
    () =>
      batches
        .filter((b) => b.qty > 0 && b.expiry && itemMap[b.itemId])
        .map((b) => ({
          b,
          item: itemMap[b.itemId],
          status: expiryStatus(b.expiry),
          days: daysUntil(b.expiry),
        })),
    [batches, itemMap]
  );

  const counts = {
    expired: all.filter((r) => r.status === 'expired').length,
    soon: all.filter((r) => r.status === 'soon').length,
    ok: all.filter((r) => r.status === 'ok').length,
  };

  const inventoryAll = all.filter((r) => r.item.type === 'ingredient');
  const menuAll = all.filter((r) => r.item.type !== 'ingredient');
  const show = (list) =>
    list
      .filter((r) => filter === 'all' || r.status === filter)
      .sort((x, y) => x.b.expiry.localeCompare(y.b.expiry));

  const confirmWriteOff = async () => {
    const result = await writeOffBatch(pending.b.id);
    setNotice(result);
    setPending(null);
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
        Expiring soon means within {EXPIRING_SOON_DAYS} days. Each row is one batch. Batches without an expiry date are
        not listed.
      </p>

      {notice && (
        <div className={`notice notice-${notice.ok ? 'ok' : 'error'}`} role="status">
          <span>{notice.message}</span>
          <button className="icon-btn" onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      <div className="toolbar">
        <select aria-label="Filter by expiry status" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All batches</option>
          <option value="expired">Expired</option>
          <option value="soon">Expiring soon</option>
          <option value="ok">OK</option>
        </select>
      </div>

      <ExpiryTable
        title="Inventory items" kindLabel="Category" kindOf={(i) => i.category}
        rows={show(inventoryAll)} all={inventoryAll} onWriteOff={setPending}
        emptyText="No ingredient batches found."
      />
      <ExpiryTable
        title="Menu items" kindLabel="Type" kindOf={(i) => TYPE_LABEL[i.type]}
        rows={show(menuAll)} all={menuAll} onWriteOff={setPending}
        emptyText="No menu item batches found."
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
    </div>
  );
}