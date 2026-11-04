import { useState } from 'react';
import { useOrders } from '../../context/OrderContext';
import MenuTile from '../../components/pos/MenuTile';
import OrderPanel from '../../components/pos/OrderPanel';
import PaymentModal from '../../components/pos/PaymentModal';
import { formatMoney } from '../../utils/money';

export default function Orders() {
  const { menuItems, categories } = useOrders();
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [paying, setPaying] = useState(false);
  const [lastOrder, setLastOrder] = useState(null);

  const visible = menuItems.filter(
    (m) =>
      (category === 'all' || m.category === category) &&
      m.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <div className="pos">
      <div className="pos-menu">
        <div className="page-head">
          <h1>New order</h1>
        </div>
        <p className="muted">Tap an item to add it to the order.</p>

        {lastOrder && (
          <div className="notice notice-ok" role="status">
            <span>
              Order #{lastOrder.number} placed. Total {formatMoney(lastOrder.total)}.
            </span>
            <button className="icon-btn" onClick={() => setLastOrder(null)} aria-label="Dismiss">×</button>
          </div>
        )}

        <div className="toolbar">
          <input
            type="search" placeholder="Search menu" aria-label="Search menu"
            value={search} onChange={(e) => setSearch(e.target.value)}
          />
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
          <p className="order-empty">No menu items match your search.</p>
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