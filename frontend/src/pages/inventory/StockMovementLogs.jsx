import { useState } from 'react';
import { useInventory } from '../../context/InventoryContext';
import StatusBadge from '../../components/StatusBadge';
import { MOVE_LABEL, MOVE_TONE } from '../../utils/inventory';
import { fmtDateTime } from '../../utils/dates';

const qtyText = (m) => {
  const sign = m.type === 'IN' || (m.type === 'ADJUSTMENT' && m.qty > 0) ? '+' : m.type === 'ADJUSTMENT' ? '' : '-';
  return `${sign}${m.qty} ${m.unit}`;
};

function MovementTable({ title, rows, showBatch, emptyText }) {
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
              <th>Date and time</th>
              <th>Item</th>
              {showBatch && <th>Batch ID</th>}
              <th>Movement</th>
              <th className="num">Quantity</th>
              <th>Reason or reference</th>
              <th>Recorded by</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={showBatch ? 7 : 6} className="empty">{emptyText}</td></tr>
            )}
            {rows.map((m) => (
              <tr key={m.id}>
                <td>{fmtDateTime(m.date)}</td>
                <td>{m.itemName}</td>
                {showBatch && <td className="batch-id">{m.batchCode ?? 'None'}</td>}
                <td><StatusBadge tone={MOVE_TONE[m.type]}>{MOVE_LABEL[m.type]}</StatusBadge></td>
                <td className="num">{qtyText(m)}</td>
                <td>{m.reason}</td>
                <td>{m.user}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function StockMovementLogs() {
  const { movements } = useInventory();
  const [type, setType] = useState('all');
  const [search, setSearch] = useState('');

  const q = search.trim().toLowerCase();
  const filtered = [...movements]
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((m) => type === 'all' || m.type === type)
    .filter(
      (m) =>
        !q ||
        m.itemName.toLowerCase().includes(q) ||
        (m.itemType === 'ingredient' && (m.batchCode ?? '').toLowerCase().includes(q))
    );

  return (
    <div>
      <div className="page-head">
        <h1>Stock Movement Logs</h1>
      </div>
      <p className="muted">The latest 300 movements of ingredients, and the latest 300 of foods and food trays.</p>

      <div className="toolbar">
        <input
          type="search" placeholder="Search item or batch ID" aria-label="Search item or batch ID"
          value={search} onChange={(e) => setSearch(e.target.value)}
        />
        <select aria-label="Filter by movement type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">All movements</option>
          {Object.entries(MOVE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      <MovementTable
        title="Ingredients" showBatch
        rows={filtered.filter((m) => m.itemType === 'ingredient')}
        emptyText="No ingredient movements found."
      />
      <MovementTable
        title="Foods and food trays" showBatch={false}
        rows={filtered.filter((m) => m.itemType !== 'ingredient')}
        emptyText="No food or tray movements found."
      />
    </div>
  );
}