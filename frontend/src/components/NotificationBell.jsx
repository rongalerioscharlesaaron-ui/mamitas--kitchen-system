import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useInventory } from '../context/InventoryContext';
import StatusBadge from './StatusBadge';
import { stockStatus } from '../utils/inventory';
import { expiryStatus, fmtDate } from '../utils/dates';

export default function NotificationBell() {
  const { user } = useAuth();
  const { items, batches, stockByItem, itemMap } = useInventory();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const list = [];
  if (user.role === 'kitchen' || user.role === 'owner') {
    items.forEach((i) => {
      const stock = stockByItem[i.id] || 0;
      const s = stockStatus(stock, i.minLevel);
      if (s.key !== 'in') {
        list.push({
          id: `s-${i.id}`, tone: s.tone, badge: s.label, title: i.name,
          detail: `${stock} ${i.unit} left, minimum ${i.minLevel}`, to: '/inventory',
        });
      }
    });
    batches
      .filter((b) => b.qty > 0 && b.expiry)
      .forEach((b) => {
        const st = expiryStatus(b.expiry);
        if (st !== 'expired' && st !== 'soon') return;
        const item = itemMap[b.itemId];
        list.push({
          id: `e-${b.id}`,
          tone: st === 'expired' ? 'danger' : 'warn',
          badge: st === 'expired' ? 'Expired' : 'Expiring soon',
          title: item?.name ?? 'Item',
          detail: `${b.qty} ${item?.unit ?? ''}, expires ${fmtDate(b.expiry)}`,
          to: '/inventory/expiration',
        });
      });
    list.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'danger' ? -1 : 1));
  }

  const count = list.length;
  const go = (to) => {
    setOpen(false);
    navigate(to);
  };

  return (
    <div className="bell-wrap" ref={ref}>
      <button
        className="icon-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label={count ? `Notifications, ${count} alerts` : 'Notifications'}
        aria-expanded={open}
      >
        <Bell size={20} aria-hidden="true" />
      </button>
      {count > 0 && <span className="bell-count">{count > 9 ? '9+' : count}</span>}

      {open && (
        <div className="notif-panel" role="region" aria-label="Notifications">
          <div className="notif-head">Notifications</div>
          {count === 0 ? (
            <p className="notif-empty">No alerts. Everything is on track.</p>
          ) : (
            <ul className="notif-list">
              {list.map((n) => (
                <li key={n.id}>
                  <button className="notif-item" onClick={() => go(n.to)}>
                    <span>
                      <div className="notif-title">{n.title}</div>
                      <div className="notif-detail">{n.detail}</div>
                    </span>
                    <StatusBadge tone={n.tone}>{n.badge}</StatusBadge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}