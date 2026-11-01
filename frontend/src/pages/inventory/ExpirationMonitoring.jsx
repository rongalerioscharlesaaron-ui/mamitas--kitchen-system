import { useMemo, useState } from 'react';
import { useInventory } from '../../context/InventoryContext';
import StatusBadge from '../../components/StatusBadge';
import { EXPIRY_INFO, TYPE_LABEL } from '../../utils/inventory';
import {
  daysText, daysUntil, expiryStatus, fmtDate, EXPIRING_SOON_DAYS,
} from '../../utils/dates';

export default function ExpirationMonitoring() {
  const { batches, itemMap, writeOffBatch } = useInventory();
  const [filter, setFilter] = useState('all');
  const [notice, setNotice] = useState(null);

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

  const rows = all
    .filter((r) => filter === 'all' || r.status === filter)
    .sort((x, y) => x.b.expiry.localeCompare(y.b.expiry));

  const handleWriteOff = (r) => {
    const msg = `Write off ${r.b.qty} ${r.item.unit} of ${r.item.name} as expired? This will be recorded in the logs.`;
    if (!window.confirm(msg)) return;
    setNotice(writeOffBatch(r.b.id));
  };

  return (
    <div>
      <div className="page-head">
        <h2>Expiration Monitoring</h2>
        <div className="actions">
          <StatusBadge tone="danger">Expired: {counts.expired}</StatusBadge>
          <StatusBadge tone="warn">Expiring soon: {counts.soon}</StatusBadge>
          <StatusBadge tone="ok">OK: {counts.ok}</StatusBadge>
        </div>
      </div>
      <p className="muted">
        Expiring soon means within {EXPIRING_SOON_DAYS} days. Batches without an expiry date are not listed.
      </p>

      {notice && (
        <div className={`notice notice-${notice.ok ? 'ok' : 'error'}`} role="status">
          <span>{notice.message}</span>
          <button className="icon-btn" onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      <div className="toolbar">
        <select
          aria-label="Filter by expiry status"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All batches</option>
          <option value="expired">Expired</option>
          <option value="soon">Expiring soon</option>
          <option value="ok">OK</option>
        </select>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Type</th>
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
              <tr><td colSpan="8" className="empty">No batches found.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.b.id}>
                <td>{r.item.name}</td>
                <td>{TYPE_LABEL[r.item.type]}</td>
                <td>{fmtDate(r.b.received)}</td>
                <td className="num">{r.b.qty} {r.item.unit}</td>
                <td>{fmtDate(r.b.expiry)}</td>
                <td>{daysText(r.days)}</td>
                <td>
                  <StatusBadge tone={EXPIRY_INFO[r.status].tone}>
                    {EXPIRY_INFO[r.status].label}
                  </StatusBadge>
                </td>
                <td>
                  {r.status === 'expired' && (
                    <button className="btn btn-danger btn-sm" onClick={() => handleWriteOff(r)}>
                      Write off
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}