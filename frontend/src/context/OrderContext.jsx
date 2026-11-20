import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from './AuthContext';
import { useInventory } from './InventoryContext';
import { useSession } from './SessionContext';
import { SHOP } from '../config/shop';
import { FOOD_CATEGORIES } from '../utils/inventory';
import { toCents, fromCents } from '../utils/money';
import { uuid } from '../utils/uuid';

const OrderContext = createContext(null);

const SALES_ROLES = ['cashier', 'owner']; // who can sell
const STAFF_ROLES = ['kitchen', 'owner']; // who can read inventory
const fail = (message, status) => ({ ok: false, message, status });

export function OrderProvider({ children }) {
  const { user } = useAuth();
  const inventory = useInventory();
  const refreshInventory = inventory.refresh;
  const { refresh: refreshSession } = useSession();
  const userId = user?.id ?? null;
  const active = Boolean(user && !user.mustChangePassword && SALES_ROLES.includes(user.role));
  const inventoryActive = Boolean(user && !user.mustChangePassword && STAFF_ROLES.includes(user.role));

  const [menuItems, setMenuItems] = useState([]);
  const [shop, setShop] = useState(SHOP);
  const [cart, setCart] = useState([]); // [{ itemId, qty }]
  const [orderType, setOrderTypeState] = useState('dine_in');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef(null); // the ID of the order being placed

  const loadMenu = useCallback(async () => {
    const data = await api.get('/menu');
    setMenuItems(data.items);
  }, []);

  // Load the menu and shop settings when a cashier or owner logs in; clear everything on logout
  useEffect(() => {
    let cancelled = false;
    setMenuItems([]);
    setCart([]);
    setError('');
    requestRef.current = null;
    if (!active) {
      setReady(true);
      return undefined;
    }
    setReady(false);
    Promise.all([loadMenu(), api.get('/shop').then((d) => !cancelled && setShop({ ...SHOP, ...d.shop }))])
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [active, userId, loadMenu]);

  // Stock changes while the cashier works, so refresh every 30 seconds and when the tab is focused
  useEffect(() => {
    if (!active) return undefined;
    const quiet = () => {
      if (document.visibilityState === 'visible') {
        loadMenu().then(() => setError('')).catch(() => {});
      }
    };
    const timer = setInterval(quiet, 30000);
    window.addEventListener('focus', quiet);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', quiet);
    };
  }, [active, loadMenu]);

  const refresh = useCallback(
    () => loadMenu().then(() => setError('')).catch((err) => setError(err.message)),
    [loadMenu]
  );

  const menuMap = useMemo(() => Object.fromEntries(menuItems.map((m) => [m.id, m])), [menuItems]);
  const categories = useMemo(
    () => [...FOOD_CATEGORIES, 'Food trays'].filter((c) => menuItems.some((m) => m.category === c)),
    [menuItems]
  );

  const cartLines = useMemo(
    () =>
      cart
        .filter((c) => menuMap[c.itemId])
        .map((c) => {
          const m = menuMap[c.itemId];
          return {
            itemId: m.id, name: m.name, unit: m.unit, price: m.price, qty: c.qty,
            lineTotal: fromCents(toCents(m.price) * c.qty),
          };
        }),
    [cart, menuMap]
  );

  // GST is already inside the prices. The server decides whether the business charges it.
  const cartTotals = useMemo(() => {
    const totalCents = cartLines.reduce((sum, l) => sum + toCents(l.price) * l.qty, 0);
    const gstCents = shop.gstRegistered
      ? Math.round((totalCents * shop.gstRate) / (1 + shop.gstRate))
      : 0;
    return {
      count: cartLines.reduce((sum, l) => sum + l.qty, 0),
      total: fromCents(totalCents),
      gst: fromCents(gstCents),
    };
  }, [cartLines, shop]);

  const inCart = (itemId) => cart.find((c) => c.itemId === itemId)?.qty || 0;
  const stockOf = (itemId) => menuMap[itemId]?.qtyUsable ?? 0; // servings or trays that can be sold
  const addable = (itemId) => Math.max(0, stockOf(itemId) - inCart(itemId));

  // Any change to the order makes it a different order, so it gets a new ID
  const touch = () => {
    requestRef.current = null;
  };

  const setOrderType = (type) => {
    touch();
    setOrderTypeState(type);
  };

  const addToCart = (itemId) => {
    const item = menuMap[itemId];
    if (!item) return fail('Item not found.');
    if (addable(itemId) < 1) return fail(`No more ${item.name} available.`);
    touch();
    setCart((prev) =>
      prev.some((c) => c.itemId === itemId)
        ? prev.map((c) => (c.itemId === itemId ? { ...c, qty: c.qty + 1 } : c))
        : [...prev, { itemId, qty: 1 }]
    );
    return { ok: true };
  };

  const setQty = (itemId, qty) => {
    const item = menuMap[itemId];
    const wanted = Math.floor(Number(qty));
    if (!item || Number.isNaN(wanted)) return fail('Enter a whole number.');
    touch();
    if (wanted <= 0) {
      setCart((prev) => prev.filter((c) => c.itemId !== itemId));
      return { ok: true };
    }
    const next = Math.min(wanted, inCart(itemId) + addable(itemId));
    setCart((prev) => prev.map((c) => (c.itemId === itemId ? { ...c, qty: next } : c)));
    return next < wanted ? fail(`Only ${next} ${item.name} available.`) : { ok: true };
  };

  const removeFromCart = (itemId) => {
    touch();
    setCart((prev) => prev.filter((c) => c.itemId !== itemId));
  };

  const clearCart = () => {
    touch();
    setCart([]);
  };

  // Places the order on the server. The same order ID is reused if the cashier retries
  // (for example after the connection dropped), so an order is never created twice.
  const placeOrder = async ({ method, tendered }) => {
    if (cart.length === 0) return fail('The order is empty.');
    if (!requestRef.current) requestRef.current = uuid();

    try {
      const data = await api.post('/orders', {
        type: orderType,
        lines: cart.map((c) => ({ itemId: c.itemId, qty: c.qty })),
        payment: method === 'cash' ? { method, tendered: Number(tendered) } : { method },
        requestId: requestRef.current,
      });
      requestRef.current = null;
      setCart([]);
      await Promise.all([
        loadMenu().catch(() => {}),
        inventoryActive ? refreshInventory() : null,
        refreshSession(),
      ]);
      return { ok: true, order: data.order, duplicate: data.duplicate };
    } catch (err) {
      loadMenu().catch(() => {}); // show the latest stock after a refused order
      if (err instanceof ApiError && err.status === 409) refreshSession(); // the session may have been closed elsewhere
      if (err instanceof ApiError) return fail(err.message, err.status);
      return fail('Something went wrong. Please try again.', -1);
    }
  };

  return (
    <OrderContext.Provider
      value={{
        menuItems, categories, shop, ready, error, refresh,
        cart, cartLines, cartTotals, orderType, setOrderType,
        inCart, stockOf, addable, addToCart, setQty, removeFromCart, clearCart, placeOrder,
      }}
    >
      {children}
    </OrderContext.Provider>
  );
}

export function useOrders() {
  return useContext(OrderContext);
}