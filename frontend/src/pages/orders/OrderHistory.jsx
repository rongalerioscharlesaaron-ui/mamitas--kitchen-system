import { useState } from 'react';
import { useOrders } from '../../context/OrderContext';
import StatusBadge from '../../components/StatusBadge';
import ReceiptModal from '../../components/pos/ReceiptModal';
import { ORDER_TYPES, PAYMENT_METHODS } from '../../config/shop';
import { fmtDateTime } from '../../utils/dates';
import { formatMoney, fromCents, toCents } from '../../utils/money';

const STATUS = {
  preparing: { label: 'Preparing', tone: 'info' },
  completed: { label: 'Completed', tone: 'ok' },
};
const label = (list, id) => list.find((x) => x.id === id)?.label ?? id;
const isToday = (iso) => new Date(iso).toDateString() === new Date().toDateString();

export default function OrderHistory() {
  const { orders, completeOrder } = useOrders();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [day, setDay] = useState('all');
  const [receipt, setReceipt] = useState(null);
  const [notice, setNotice] = useState(null);

  const today = orders.filter((o) => isToday(o.createdAt));
  const salesToday = fromCents(today.reduce((s, o) => s + toCents(o.total), 0));
  const preparing = orders.filter((o) => o.status === 'preparing').length;

  const q = search.trim().replace('#', '');
  const rows = [...orders]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((o) => status === 'all' || o.status === status)
    .filter((o) => day === 'all' || isToday(o.createdAt))
    .filter((o) => !q || o.number.includes(q));

  const handleComplete = (o) => {
    completeOrder(o.id);
    setNotice({ ok: true, message: `Order #${o.number} marked as completed.` });
  };

  return (
    <div>
      <div className="page-head">
        <h1>Order history</h1>
      </div>

      <div className="stat-grid">
        <div className="stat stat-info">
          <div className="stat-label">Orders today</div>
          <div className="stat-value">{today.length}</div>
        </div>
        <div className="stat stat-ok">
          <div className="stat-label">Sales today</div>
          <div className="stat-value">{formatMoney(salesToday)}</div>
        </div>
        <div className="stat stat-warn">
          <div className="stat-label">Still preparing</div>
          <div className="stat-value">{preparing}</div>
          <div className="stat-hint">Not yet handed over</div>
        </div>
      </div>

      {notice && (
        <div className={`notice notice-${notice.ok ? 'ok' : 'error'}`} role="status">
          <span>{notice.message}</span>
          <button className="icon-btn" onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      <div className="toolbar">
        <input
          type="search" placeholder="Search order number" aria-label="Search order number"
          value={search} onChange={(e) => setSearch(e.target.value)}
        />
        <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="preparing">Preparing</option>
          <option value="completed">Completed</option>
        </select>
        <select aria-label="Filter by date" value={day} onChange={(e) => setDay(e.target.value)}>
          <option value="all">All dates</option>
          <option value="today">Today</option>
        </select>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Order</th><th>Date and time</th><th>Type</th><th className="num">Items</th>
              <th className="num">Total</th><th>Payment</th><th>Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan="8" className="empty">No orders found.</td></tr>
            )}
            {rows.map((o) => (
              <tr key={o.id}>
                <td>#{o.number}</td>
                <td>{fmtDateTime(o.createdAt)}</td>
                <td>{label(ORDER_TYPES, o.type)}</td>
                <td className="num">{o.lines.reduce((s, l) => s + l.qty, 0)}</td>
                <td className="num">{formatMoney(o.total)}</td>
                <td>{label(PAYMENT_METHODS, o.payment.method)}</td>
                <td>
                  <StatusBadge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</StatusBadge>
                </td>
                <td>
                  <div className="actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => setReceipt(o)}>Receipt</button>
                    {o.status === 'preparing' && (
                      <button className="btn btn-primary btn-sm" onClick={() => handleComplete(o)}>
                        Mark completed
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {receipt && <ReceiptModal order={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}