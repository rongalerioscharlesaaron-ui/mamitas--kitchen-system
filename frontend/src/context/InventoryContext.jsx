import { createContext, useContext, useMemo, useState } from 'react';
import { SEED_ITEMS, SEED_BATCHES, SEED_MOVEMENTS } from '../mock/inventory';
import { useAuth } from './AuthContext';
import { todayStr } from '../utils/dates';

const InventoryContext = createContext(null);

const uid = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const fail = (message) => ({ ok: false, message });
const done = (message) => ({ ok: true, message });

export function InventoryProvider({ children }) {
  const { user } = useAuth();
  const [items, setItems] = useState(SEED_ITEMS);
  const [batches, setBatches] = useState(SEED_BATCHES);
  const [movements, setMovements] = useState(SEED_MOVEMENTS);
  const actor = user?.name ?? 'System';

  const stockByItem = useMemo(() => {
    const map = {};
    batches.forEach((b) => {
      map[b.itemId] = (map[b.itemId] || 0) + b.qty;
    });
    return map;
  }, [batches]);

  const itemMap = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);

  const logMovement = (m) => ({
    id: uid('mv'),
    date: new Date().toISOString(),
    user: actor,
    ...m,
  });

  const addItem = ({ name, type, unit, minLevel, qty, expiry }) => {
    const clean = name.trim();
    if (!clean) return fail('Item name is required.');
    if (items.some((i) => i.name.toLowerCase() === clean.toLowerCase()))
      return fail('An item with this name already exists.');
    if (!unit.trim()) return fail('Unit is required.');
    const min = Number(minLevel);
    const q = Number(qty);
    if (Number.isNaN(min) || min < 0) return fail('Minimum level must be 0 or more.');
    if (Number.isNaN(q) || q < 0) return fail('Starting quantity must be 0 or more.');
    if (expiry && expiry < todayStr()) return fail('Expiry date cannot be in the past.');

    const item = { id: uid('item'), name: clean, type, unit: unit.trim(), minLevel: min };
    setItems((p) => [...p, item]);
    if (q > 0) {
      const batch = { id: uid('b'), itemId: item.id, qty: q, received: todayStr(), expiry: expiry || null };
      setBatches((p) => [...p, batch]);
      setMovements((p) => [
        logMovement({ itemId: item.id, batchId: batch.id, type: 'IN', qty: q, reason: 'Initial stock' }),
        ...p,
      ]);
    }
    return done(`${clean} was added.`);
  };

  const addStock = ({ itemId, qty, expiry }) => {
    const item = itemMap[itemId];
    const q = Number(qty);
    if (!item) return fail('Choose an item.');
    if (!(q > 0)) return fail('Quantity must be greater than 0.');
    if (expiry && expiry < todayStr()) return fail('Expiry date cannot be in the past.');

    const batch = { id: uid('b'), itemId, qty: q, received: todayStr(), expiry: expiry || null };
    setBatches((p) => [...p, batch]);
    setMovements((p) => [
      logMovement({ itemId, batchId: batch.id, type: 'IN', qty: q, reason: 'Stock in' }),
      ...p,
    ]);
    return done(`Added ${q} ${item.unit} to ${item.name}.`);
  };

  // Deducts oldest batches first (FIFO)
  const recordLoss = ({ itemId, qty, type, reason }) => {
    const item = itemMap[itemId];
    const q = Number(qty);
    if (!item) return fail('Choose an item.');
    if (!(q > 0)) return fail('Quantity must be greater than 0.');
    if (!reason.trim()) return fail('Please give a reason.');
    const available = stockByItem[itemId] || 0;
    if (q > available) return fail(`Only ${available} ${item.unit} available.`);

    let remaining = q;
    const updates = {};
    const newMoves = [];
    batches
      .filter((b) => b.itemId === itemId && b.qty > 0)
      .sort((a, b) => a.received.localeCompare(b.received))
      .forEach((b) => {
        if (remaining <= 0) return;
        const take = Math.min(b.qty, remaining);
        updates[b.id] = b.qty - take;
        newMoves.push(logMovement({ itemId, batchId: b.id, type, qty: take, reason: reason.trim() }));
        remaining -= take;
      });

    setBatches((p) => p.map((b) => (b.id in updates ? { ...b, qty: updates[b.id] } : b)));
    setMovements((p) => [...newMoves, ...p]);
    return done(`Recorded ${q} ${item.unit} of ${item.name} as ${type.toLowerCase()}.`);
  };

  const writeOffBatch = (batchId) => {
    const b = batches.find((x) => x.id === batchId);
    if (!b || b.qty <= 0) return fail('Nothing to write off.');
    const item = itemMap[b.itemId];
    setBatches((p) => p.map((x) => (x.id === batchId ? { ...x, qty: 0 } : x)));
    setMovements((p) => [
      logMovement({ itemId: b.itemId, batchId, type: 'SPOILED', qty: b.qty, reason: 'Expired' }),
      ...p,
    ]);
    return done(`${b.qty} ${item?.unit ?? ''} of ${item?.name ?? 'item'} written off as expired.`);
  };

  return (
    <InventoryContext.Provider
      value={{ items, batches, movements, stockByItem, itemMap, addItem, addStock, recordLoss, writeOffBatch }}
    >
      {children}
    </InventoryContext.Provider>
  );
}

export function useInventory() {
  return useContext(InventoryContext);
}