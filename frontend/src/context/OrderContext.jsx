import { createContext, useContext, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { useInventory } from './InventoryContext';
import { SEED_ORDERS } from '../mock/orders';
import { FOOD_CATEGORIES } from '../utils/inventory';
import { toCents, fromCents, gstIncluded } from '../utils/money';

const OrderContext = createContext(null);
const fail = (message) => ({ ok: false, message });

export function OrderProvider({ children }) {
  const { user } = useAuth();
  const { items, usableStockByItem, consumeStock } = useInventory();
  const [cart, setCart] = useState([]); // [{ itemId, qty }]
  const [orderType, setOrderType] = useState('dine_in');
  const [orders, setOrders] = useState(SEED_ORDERS);

  // The menu is every food and food tray that has a price
  const menuItems = useMemo(
    () => items.filter((i) => i.type !== 'ingredient' && i.price != null),
    [items]
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
            itemId: m.id, name: m.name, unit: m.unit, type: m.type, price: m.price, qty: c.qty,
            lineTotal: fromCents(toCents(m.price) * c.qty),
          };
        }),
    [cart, menuMap]
  );

  const cartTotals = useMemo(() => {
    const totalCents = cartLines.reduce((s, l) => s + toCents(l.price) * l.qty, 0);
    return {
      count: cartLines.reduce((s, l) => s + l.qty, 0),
      total: fromCents(totalCents),
      gst: fromCents(gstIncluded(totalCents)),
    };
  }, [cartLines]);

  const inCart = (itemId) => cart.find((c) => c.itemId === itemId)?.qty || 0;
  const stockOf = (itemId) => usableStockByItem[itemId] || 0; // servings or trays that can be sold
  const addable = (itemId) => Math.max(0, stockOf(itemId) - inCart(itemId));

  const addToCart = (itemId) => {
    const item = menuMap[itemId];
    if (!item) return fail('Item not found.');
    if (addable(itemId) < 1) return fail(`No more ${item.name} available.`);
    setCart((p) =>
      p.some((c) => c.itemId === itemId)
        ? p.map((c) => (c.itemId === itemId ? { ...c, qty: c.qty + 1 } : c))
        : [...p, { itemId, qty: 1 }]
    );
    return { ok: true };
  };

  const setQty = (itemId, qty) => {
    const item = menuMap[itemId];
    const wanted = Math.floor(Number(qty));
    if (!item || Number.isNaN(wanted)) return fail('Enter a whole number.');
    if (wanted <= 0) {
      setCart((p) => p.filter((c) => c.itemId !== itemId));
      return { ok: true };
    }
    const next = Math.min(wanted, inCart(itemId) + addable(itemId));
    setCart((p) => p.map((c) => (c.itemId === itemId ? { ...c, qty: next } : c)));
    return next < wanted ? fail(`Only ${next} ${item.name} available.`) : { ok: true };
  };

  const removeFromCart = (itemId) => setCart((p) => p.filter((c) => c.itemId !== itemId));
  const clearCart = () => setCart([]);

  // payment = { method: 'cash' | 'paynow' | 'card', tendered }
  const placeOrder = ({ method, tendered }) => {
    if (cart.length === 0) return fail('The order is empty.');

    const totalCents = cartLines.reduce((s, l) => s + toCents(l.price) * l.qty, 0);
    const total = fromCents(totalCents);
    let paid = total;
    let change = 0;
    if (method === 'cash') {
      paid = Number(tendered);
      if (Number.isNaN(paid) || toCents(paid) < totalCents) {
        return fail('Cash received is less than the total.');
      }
      change = fromCents(toCents(paid) - totalCents);
    }

    const number = String(Math.max(0, ...orders.map((o) => Number(o.number))) + 1).padStart(4, '0');

    // Each item sold takes servings or trays out of the Menu stock
    const stock = consumeStock(
      cartLines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
      `Order #${number}`
    );
    if (!stock.ok) return stock;

    const order = {
      id: `o${Date.now().toString(36)}`,
      number,
      createdAt: new Date().toISOString(),
      cashier: user?.name ?? 'Cashier',
      type: orderType,
      lines: cartLines.map((l) => ({ itemId: l.itemId, name: l.name, price: l.price, qty: l.qty })),
      total,
      gst: fromCents(gstIncluded(totalCents)),
      payment: { method, tendered: paid, change },
      status: 'preparing',
      completedAt: null,
    };
    setOrders((p) => [order, ...p]);
    setCart([]);
    return { ok: true, order };
  };

  const completeOrder = (id) =>
    setOrders((p) =>
      p.map((o) =>
        o.id === id ? { ...o, status: 'completed', completedAt: new Date().toISOString() } : o
      )
    );

  return (
    <OrderContext.Provider
      value={{
        menuItems, categories, cart, cartLines, cartTotals, orderType, setOrderType, orders,
        inCart, stockOf, addable,
        addToCart, setQty, removeFromCart, clearCart, placeOrder, completeOrder,
      }}
    >
      {children}
    </OrderContext.Provider>
  );
}

export function useOrders() {
  return useContext(OrderContext);
}