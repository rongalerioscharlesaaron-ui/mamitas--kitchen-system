import { useState } from 'react';
import { useInventory } from '../../context/InventoryContext';
import StatusBadge from '../../components/StatusBadge';
import RecordLossModal from '../../components/inventory/RecordLossModal';
import { MOVE_LABEL, MOVE_TONE, TYPE_LABEL } from '../../utils/inventory';
import { fmtDateTime } from '../../utils/dates';

export default function DamagedGoods() {
  const { movements, itemMap } = useInventory();
  const [type, setType] = useState('all');
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState(null);

  const losses = [...movements]
    .filter((m) => m.type === 'DAMAGED' || m.type === 'SPOILED')
    .sort((a, b) => b.date.localeCompare(a.date));
  const rows = losses.filter((m) => type === 'all' || m.type === type);

  return (
    <div>
      <div className="page-head">
        <h2>Damaged Goods Monitoring</h2>
        <button className="btn btn-danger" onClick={() => setOpen(true)}>
          Record Damaged / Spoiled
        </button>
      </div>

      <div className="actions" style={{ marginBottom: 16 }}>
        <StatusBadge tone="danger">
          Damaged entries: {losses.filter((m) => m.type === 'DAMAGED').length}
        </StatusBadge>
        <StatusBadge tone="warn">
          Spoiled entries: {losses.filter((m) => m.type === 'SPOILED').length}
        </StatusBadge>
      </div>

      {notice && (
        <div className={`notice notice-${notice.ok ? 'ok' : 'error'}`} role="status">
          <span>{notice.message}</span>
          <button className="icon-btn" onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      <div className="toolbar">
        <select
          aria-label="Filter by label"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="all">Damaged and spoiled</option>
          <option value="DAMAGED">Damaged only</option>
          <option value="SPOILED">Spoiled only</option>
        </select>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Date and time</th>
              <th>Item</th>
              <th>Type</th>
              <th>Label</th>
              <th className="num">Quantity</th>
              <th>Reason</th>
              <th>Recorded by</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan="7" className="empty">No damaged or spoiled goods recorded.</td></tr>
            )}
            {rows.map((m) => {
              const item = itemMap[m.itemId];
              return (
                <tr key={m.id}>
                  <td>{fmtDateTime(m.date)}</td>
                  <td>{item?.name ?? 'Unknown'}</td>
                  <td>{item ? TYPE_LABEL[item.type] : '—'}</td>
                  <td><StatusBadge tone={MOVE_TONE[m.type]}>{MOVE_LABEL[m.type]}</StatusBadge></td>
                  <td className="num">{m.qty} {item?.unit}</td>
                  <td>{m.reason}</td>
                  <td>{m.user}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {open && <RecordLossModal onClose={() => setOpen(false)} onDone={setNotice} />}
    </div>
  );
}