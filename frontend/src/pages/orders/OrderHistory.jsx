import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useAutoLoad } from '../../hooks/useAutoLoad';
import StatusBadge from '../../components/StatusBadge';
import ReceiptModal from '../../components/pos/ReceiptModal';
import { ORDER_TYPES, PAYMENT_METHODS } from '../../config/shop';
import { fmtDateTime } from '../../utils/dates';
import { formatMoney } from '../../utils/money';

const STATUS = {
  preparing: { label: 'Preparing', tone: 'info' },
  completed: { label: 'Completed', tone: 'ok' },
};
const label = (list, id) => list.find((x) => x.id === id)?.label ?? id;
const PAGE = 100;

export default function OrderHistory() {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [day, setDay] = useState('all');
  const [limit, setLimit] = useState(PAGE);
  const [receipt, setReceipt] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // Wait until the cashier stops typing before searching
  useEffect(() => {
    const t = setTimeout(() => setQ(search.replace(/\D/g, '')), 300);
    return () => clearTimeout(t);
  }, [search]);

  const list = useAutoLoad(() => {
    const p = new URLSearchParams({ limit: String(limit) });
    if (status !== 'all') p.set('status', status);
    if (day === 'today') p.set('date', 'today');
    if (q) p.set('q', q);
    return api.get(`/orders?${p}`);
  }, [status, day, q, limit]);
  const stats = useAutoLoad(() => api.get('/dashboard/sales'), []);

  const handleComplete = async (o) => {
    if (busyId) return;
    setBusyId(o.id);
    try {
      await api.patch(`/orders/${o.id}/complete`);
      setNotice({ ok: true, message: `Order #${o.number} marked as completed.` });
    } catch (err) {
      setNotice({ ok: false, message: err.message });
    }
    setBusyId(null);
    list.reload();
    stats.reload();
  };

  const orders = list.data?.orders ?? [];
  const total = list.data?.total ?? 0;
  const s = stats.data;

  return (
    <div>
      <div className="page-head">
        <h1>Order history</h1>
        <button className="btn btn-secondary" onClick={() => { list.reload(); stats.reload(); }}>
          Refresh
        </button>
      </div>

      <div className="stat-grid">
        <div className="stat stat-info">
          <div className="stat-label">Orders today</div>
          <div className="stat-value">{s ? s.todayOrders : '–'}</div>
        </div>
        <div className="stat stat-ok">
          <div className="stat-label">Sales today</div>
          <div className="stat-value">{s ? formatMoney(s.todaySales) : '–'}</div>
        </div>
        <div className="stat stat-warn">
          <div className="stat-label">Still preparing</div>
          <div className="stat-value">{s ? s.preparingCount : '–'}</div>
          <div className="stat-hint">Not yet handed over</div>
        </div>
      </div>

      {(list.error || stats.error) && (
        <div className="notice notice-error" role="alert">
          <span>{list.error || stats.error}</span>
          <button className="btn btn-secondary btn-sm" onClick={() => { list.reload(); stats.reload(); }}>
            Try again
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
          type="search" placeholder="Search order number" aria-label="Search order number"
          value={search} onChange={(e) => { setSearch(e.target.value); setLimit(PAGE); }}
        />
        <select aria-label="Filter by status" value={status}
          onChange={(e) => { setStatus(e.target.value); setLimit(PAGE); }}>
          <option value="all">All statuses</option>
          <option value="preparing">Preparing</option>
          <option value="completed">Completed</option>
        </select>
        <select aria-label="Filter by date" value={day}
          onChange={(e) => { setDay(e.target.value); setLimit(PAGE); }}>
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
            {list.data === null && (
              <tr><td colSpan="8" className="empty">{list.error ? 'Could not load orders.' : 'Loading...'}</td></tr>
            )}
            {list.data !== null && orders.length === 0 && (
              <tr><td colSpan="8" className="empty">No orders found.</td></tr>
            )}
            {orders.map((o) => (
              <tr key={o.id}>
                <td>#{o.number}</td>
                <td>{fmtDateTime(o.createdAt)}</td>
                <td>{label(ORDER_TYPES, o.type)}</td>
                <td className="num">{o.lines.reduce((sum, l) => sum + l.qty, 0)}</td>
                <td className="num">{formatMoney(o.total)}</td>
                <td>{label(PAYMENT_METHODS, o.payment.method)}</td>
                <td>
                  <StatusBadge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</StatusBadge>
                </td>
                <td>
                  <div className="actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => setReceipt(o)}>Receipt</button>
                    {o.status === 'preparing' && (
                      <button className="btn btn-primary btn-sm" disabled={busyId === o.id}
                        onClick={() => handleComplete(o)}>
                        {busyId === o.id ? 'Saving...' : 'Mark completed'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > orders.length && (
        <div className="actions" style={{ marginTop: 12, justifyContent: 'center' }}>
          <span className="muted-inline">Showing {orders.length} of {total}</span>
          <button className="btn btn-secondary btn-sm" onClick={() => setLimit((l) => l + PAGE)}>
            Load more
          </button>
        </div>
      )}

      {receipt && <ReceiptModal order={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}