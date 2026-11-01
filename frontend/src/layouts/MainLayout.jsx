import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { NAV_ITEMS, ROLE_LABELS } from '../routes/navItems';

export default function MainLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const items = NAV_ITEMS.filter((i) => i.roles.includes(user.role));

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Mamitas’ Kitchen</div>
        <nav className="nav">
          {items.map((i) => (
            <NavLink
              key={i.path}
              to={i.path}
              end={i.path === '/'}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              {i.label}
            </NavLink>
          ))}
        </nav>
        <div className="user">
          <span>{user.name} · {ROLE_LABELS[user.role]}</span>
          <button className="btn btn-secondary" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}