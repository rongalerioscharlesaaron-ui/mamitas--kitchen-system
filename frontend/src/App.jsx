import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './routes/ProtectedRoute';
import MainLayout from './layouts/MainLayout';
import Login from './pages/auth/Login';
import Dashboard from './pages/dashboard/Dashboard';
import Orders from './pages/orders/Orders';
import OrderHistory from './pages/orders/OrderHistory';
import InventoryLayout from './pages/inventory/InventoryLayout';
import InventoryStock from './pages/inventory/InventoryStock';
import MenuStock from './pages/inventory/MenuStock';
import StockMovementLogs from './pages/inventory/StockMovementLogs';
import ExpirationMonitoring from './pages/inventory/ExpirationMonitoring';
import DamagedGoods from './pages/inventory/DamagedGoods';
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
            <Route path="orders/history" element={<OrderHistory />} />
          </Route>

          <Route element={<ProtectedRoute roles={['kitchen', 'owner']} />}>
            <Route path="inventory" element={<InventoryLayout />}>
              <Route index element={<InventoryStock />} />
              <Route path="menu" element={<MenuStock />} />
              <Route path="movements" element={<StockMovementLogs />} />
              <Route path="expiration" element={<ExpirationMonitoring />} />
              <Route path="damaged" element={<DamagedGoods />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute roles={['owner']} />}>
            <Route path="reports" element={<Reports />} />
            <Route path="admin" element={<Admin />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}