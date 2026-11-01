import { useState } from 'react';
import { useInventory } from '../../context/InventoryContext';
import StatusBadge from '../../components/StatusBadge';
import StatCard from '../../components/StatCard';
import Modal from '../../components/Modal';
import { stockStatus, TYPE_LABEL } from '../../utils/inventory';

export default function Inventory() {
  const { items, stockByItem } = useInventory();
  const [open, setOpen] = useState(false);

  return (
    <section>
      <h1>Stage 2 preview</h1>
      <p className="muted">Temporary page. It checks the shared components and styles.</p>

      <div className="stat-grid">
        <StatCard label="Total Items" value={items.length} tone="info" to="/inventory" hint="From the mock data" />
        <StatCard label="Low Stock" value="4" tone="warn" to="/inventory" />
        <StatCard label="Expired" value="1" tone="danger" to="/inventory" />
      </div>

      <div className="page-head">
        <h2>Items</h2>
        <button className="btn btn-primary" onClick={() => setOpen(true)}>Open modal</button>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Item</th><th>Type</th><th className="num">In stock</th><th>Status</th></tr>
          </thead>
          <tbody>
            {items.map((i) => {
              const stock = stockByItem[i.id] || 0;
              const st = stockStatus(stock, i.minLevel);
              return (
                <tr key={i.id}>
                  <td>{i.name}</td>
                  <td>{TYPE_LABEL[i.type]}</td>
                  <td className="num">{stock} {i.unit}</td>
                  <td><StatusBadge tone={st.tone}>{st.label}</StatusBadge></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {open && (
        <Modal title="Test modal" onClose={() => setOpen(false)}>
          <p>The modal works. Press Esc, click outside, or click × to close it.</p>
          <div className="form-actions">
            <button className="btn btn-primary" onClick={() => setOpen(false)}>OK</button>
          </div>
        </Modal>
      )}
    </section>
  );
}