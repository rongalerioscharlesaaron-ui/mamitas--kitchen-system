import { useState } from 'react';
import { useInventory } from '../../context/InventoryContext';
import StatusBadge from '../../components/StatusBadge';
import { MOVE_LABEL, MOVE_TONE } from '../../utils/inventory';
import { fmtDateTime } from '../../utils/dates';

export default function StockMovementLogs() {
  const { movements, itemMap } = useInventory();
  const [type, setType] = useState('all');
  const [search, setSearch] = useState('');

  const rows = [...movements]
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((m) => type === 'all' || m.type === type)
    .filter((m) =>
      (itemMap[m.itemId]?.name ?? '').toLowerCase().includes(search.trim().toLowerCase())
    );

  return (
    <div>
      <div className="page-head">
        <h2>Stock Movement Logs</h2>
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search item"
          aria-label="Search item"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Filter by movement type"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="all">All movements</option>
          {Object.entries(MOVE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Date and time</th>
              <th>Item</th>
              <th>Movement</th>
              <th className="num">Quantity</th>
              <th>Reason / Reference</th>
              <th>Recorded by</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan="6" className="empty">No movements found.</td></tr>
            )}
            {rows.map((m) => {
              const item = itemMap[m.itemId];
              return (
                <tr key={m.id}>
                  <td>{fmtDateTime(m.date)}</td>
                  <td>{item?.name ?? 'Unknown'}</td>
                  <td><StatusBadge tone={MOVE_TONE[m.type]}>{MOVE_LABEL[m.type]}</StatusBadge></td>
                  <td className="num">{m.type === 'IN' ? '+' : '-'}{m.qty} {item?.unit}</td>
                  <td>{m.reason}</td>
                  <td>{m.user}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}