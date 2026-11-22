import { useMemo, useState } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import { useOrders } from '../../context/OrderContext';
import { useSession } from '../../context/SessionContext';
import MenuTile from '../../components/pos/MenuTile';
import OrderPanel from '../../components/pos/OrderPanel';
import PaymentModal from '../../components/pos/PaymentModal';
import OpenSessionForm from '../../components/session/OpenSessionForm';
import { fmtDayTime } from '../../utils/time';
import { formatMoney } from '../../utils/money';

export default function Orders() {
  const { menuItems, categories, stockOf, refresh } = useOrders();
  const { session, activeSessions, ready } = useSession();
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [availableOnly, setAvailableOnly] = useState(false);
  const [paying, setPaying] = useState(false);
  const [lastOrder, setLastOrder] = useState(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return menuItems
      .filter((m) => {
        if (category !== 'all' && m.category !== category) return false;
        if (q && !m.name.toLowerCase().includes(q) && !(m.category || '').toLowerCase().includes(q)) {
          return false;
        }
        if (availableOnly && stockOf(m.id) <= 0) return false;
        return true;
      })
      .sort((a, b) => {
        const aOut = stockOf(a.id) <= 0 ? 1 : 0;
        const bOut = stockOf(b.id) <= 0 ? 1 : 0;
        if (aOut !== bOut) return aOut - bOut;
        return a.name.localeCompare(b.name);
      });
  }, [menuItems, category, search, availableOnly, stockOf]);

  if (!ready) return <p className="muted">Loading...</p>;

  // No orders can be taken until the cash drawer is opened
  if (!session) {
    return (
      <div>
        <div className="page-head">
          <h1>New order</h1>
        </div>

        {activeSessions.length > 0 && (
          <div className="card" style={{ maxWidth: 520, marginBottom: 18, borderLeft: '4px solid var(--ok)' }}>
            <h2 style={{ margin: '0 0 6px', fontSize: '1.05rem' }}>Active shift currently open</h2>
            <p className="muted" style={{ margin: '0 0 10px' }}>
              Another staff member already has an open register right now. Each user tracks their own drawer—start
              your own session below if you want to take orders as Owner.
            </p>
            <ul className="list" style={{ marginBottom: 0 }}>
              {activeSessions.map((s) => (
                <li key={s.id} style={{ padding: '6px 0', borderBottom: 'none' }}>
                  <span>
                    <strong>{s.cashier}</strong> · Started at {fmtDayTime(s.openedAt)} · Opening cash{' '}
                    {formatMoney(s.openingCash)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <OpenSessionForm />
      </div>
    );
  }

  const orderableInView = visible.filter((m) => stockOf(m.id) > 0).length;

  return (
    <div className="pos">
      <div className="pos-menu">
        <div className="page-head">
          <div>
            <h1>New order</h1>
            <p className="muted" style={{ margin: 0 }}>
              Tap an item to add it to the order · <strong>{orderableInView}</strong> of {visible.length} shown available
            </p>
          </div>
          <div className="actions">
            <button
              type="button"
              className={`chip ${availableOnly ? 'is-active-filter' : ''}`}
              aria-pressed={availableOnly}
              onClick={() => setAvailableOnly((prev) => !prev)}
            >
              Available only
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={refresh}>
              <RefreshCw size={15} aria-hidden="true" /> Refresh
            </button>
          </div>
        </div>

        {!session.openedToday && (
          <div className="notice notice-error" role="status">
            <span>
              Your session was opened on {fmtDayTime(session.openedAt)}. Close it from the Dashboard and start a new
              one for today.
            </span>
          </div>
        )}

        {lastOrder && (
          <div className="notice notice-ok" role="status">
            <span>
              Order #{lastOrder.number} placed. Total {formatMoney(lastOrder.total)}.
            </span>
            <button className="icon-btn" onClick={() => setLastOrder(null)} aria-label="Dismiss">×</button>
          </div>
        )}

        <div className="toolbar">
          <div className="pos-search-wrap">
            <Search size={17} className="pos-search-icon" aria-hidden="true" />
            <input
              type="search"
              placeholder="Search menu by name or category"
              aria-label="Search menu"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="pos-search-clear"
                onClick={() => setSearch('')}
                aria-label="Clear search"
              >
                <X size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        <div className="chips" role="group" aria-label="Menu categories">
          {['all', ...categories].map((c) => (
            <button
              key={c}
              type="button"
              className="chip"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
            >
              {c === 'all' ? 'All' : c}
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 28 }}>
            <p className="muted" style={{ marginBottom: 12 }}>
              {availableOnly ? 'No available menu items match this filter.' : 'No menu items match your search.'}
            </p>
            {(search || availableOnly || category !== 'all') && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setSearch('');
                  setAvailableOnly(false);
                  setCategory('all');
                }}
              >
                Reset filters
              </button>
            )}
          </div>
        ) : (
          <div className="tile-grid">
            {visible.map((m) => (
              <MenuTile key={m.id} item={m} />
            ))}
          </div>
        )}
      </div>

      <OrderPanel onCharge={() => setPaying(true)} />

      {paying && (
        <PaymentModal onClose={() => setPaying(false)} onPlaced={(o) => setLastOrder(o)} />
      )}
    </div>
  );
}