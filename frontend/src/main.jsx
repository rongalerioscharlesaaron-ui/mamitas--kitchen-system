import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { InventoryProvider } from './context/InventoryContext';
import { SessionProvider } from './context/SessionContext';
import { OrderProvider } from './context/OrderContext';
import App from './App.jsx';
import './styles/index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <InventoryProvider>
          <SessionProvider>
            <OrderProvider>
              <App />
            </OrderProvider>
          </SessionProvider>
        </InventoryProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);