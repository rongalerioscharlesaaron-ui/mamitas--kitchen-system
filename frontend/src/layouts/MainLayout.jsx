import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ChefHat, LogOut, PanelLeft } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useInventory } from '../context/InventoryContext';
import { useOrders } from '../context/OrderContext';
import { NAV_GROUPS, ROLE_LABELS } from '../routes/navItems';
import NotificationBell from '../components/NotificationBell';

export default function MainLayout() {
  const { user, logout } = useAuth();
  const inv = useInventory();
  const ord = useOrders();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const groups = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => i.roles.includes(user.role)) }))
    .filter((g) => g.items.length > 0);

  const toggle = () => {
    if (window.matchMedia('(max-width: 900px)').matches) setMobileOpen((o) => !o);
    else setCollapsed((c) => !c);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // Cashiers load the menu, kitchen staff load inventory, the owner loads both
  const retry = () => {
    if (user.role !== 'cashier') inv.refresh();
    if (user.role !== 'kitchen') ord.refresh();
  };
  const problem = inv.error || ord.error;
  const loading = inv.ready === false || ord.ready === false;

  const initials = user.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className={`shell${collapsed ? ' is-collapsed' : ''}`}>
      {mobileOpen && <div className="scrim" onClick={() => setMobileOpen(false)} />}

      <aside className={`sidebar${mobileOpen ? ' is-open' : ''}`} aria-label="Main navigation">
        <div className="sidebar-brand">
          <span className="brand-mark"><ChefHat size={20} aria-hidden="true" /></span>
          <span className="brand-text">
            <strong>Mamitas’ Kitchen</strong>
            <small>Singapore</small>
          </span>
        </div>

        <nav className="sidebar-nav">
          {groups.map((g) => (
            <div className="nav-group" key={g.title}>
              <div className="nav-title">{g.title}</div>
              {g.items.map((i) => {
                const Icon = i.icon;
                return (
                  <NavLink
                    key={i.path}
                    to={i.path}
                    end={i.end}
                    title={i.label}
                    className={({ isActive }) => (isActive ? 'side-link active' : 'side-link')}
                    onClick={() => setMobileOpen(false)}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span className="side-label">{i.label}</span>
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="icon-btn" onClick={toggle} aria-label="Show or hide navigation">
            <PanelLeft size={20} aria-hidden="true" />
          </button>
          <div className="topbar-title">Mamitas’ Kitchen Management System</div>
          <div className="topbar-actions">
            <NotificationBell />
            <div className="profile">
              <span className="avatar" aria-hidden="true">{initials}</span>
              <span className="profile-text">
                <strong>{user.name}</strong>
                <small>{ROLE_LABELS[user.role]}</small>
              </span>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={handleLogout}>
              <LogOut size={16} aria-hidden="true" /> Log out
            </button>
          </div>
        </header>

        <main className="content">
          {problem && (
            <div className="notice notice-error" role="alert">
              <span>{problem}</span>
              <button className="btn btn-secondary btn-sm" onClick={retry}>Try again</button>
            </div>
          )}
          {loading ? <p className="muted">Loading...</p> : <Outlet />}
        </main>
      </div>
    </div>
  );
}