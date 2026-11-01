import { NavLink, Outlet } from 'react-router-dom';

const TABS = [
  { to: '/inventory', label: 'Inventory Stock', end: true },
  { to: '/inventory/movements', label: 'Stock Movement Logs' },
  { to: '/inventory/expiration', label: 'Expiration Monitoring' },
  { to: '/inventory/damaged', label: 'Damaged Goods' },
];

export default function InventoryLayout() {
  return (
    <section>
      <h1>Inventory</h1>
      <nav className="tabs" aria-label="Inventory sections">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) => (isActive ? 'tab active' : 'tab')}
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </section>
  );
}