import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './routes/ProtectedRoute';
import MainLayout from './layouts/MainLayout';
import PagePlaceholder from './components/PagePlaceholder';
import Login from './pages/auth/Login';
import Dashboard from './pages/dashboard/Dashboard';
import Orders from './pages/orders/Orders';
import InventoryLayout from './pages/inventory/InventoryLayout';
import InventoryStock from './pages/inventory/InventoryStock';
import MenuPage from './pages/menu/MenuPage';
import Reports from './pages/reports/Reports';
import Admin from './pages/admin/Admin';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<MainLayout />}>
          <Route index element={<Dashboard />} />

          <Route element={<ProtectedRoute roles={['cashier', 'owner']} />}>
            <Route path="orders" element={<Orders />} />
          </Route>

          <Route element={<ProtectedRoute roles={['kitchen', 'owner']} />}>
            <Route path="inventory" element={<InventoryLayout />}>
              <Route index element={<InventoryStock />} />
              <Route
                path="movements"
                element={<PagePlaceholder title="Stock Movement Logs" description="This page is built in Stage 4." />}
              />
              <Route
                path="expiration"
                element={<PagePlaceholder title="Expiration Monitoring" description="This page is built in Stage 4." />}
              />
              <Route
                path="damaged"
                element={<PagePlaceholder title="Damaged Goods Monitoring" description="This page is built in Stage 4." />}
              />
            </Route>
          </Route>

          <Route element={<ProtectedRoute roles={['owner']} />}>
            <Route path="menu" element={<MenuPage />} />
            <Route path="reports" element={<Reports />} />
            <Route path="admin" element={<Admin />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}