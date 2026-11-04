import { createContext, useContext, useMemo, useState } from 'react';
import { SEED_ITEMS, SEED_BATCHES, SEED_MOVEMENTS } from '../mock/inventory';
import { useAuth } from './AuthContext';
import { todayStr } from '../utils/dates';
import { round3 } from '../utils/money';

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

  // All stock on hand, including expired batches
  const stockByItem = useMemo(() => {
    const map = {};
    batches.forEach((b) => {
      map[b.itemId] = round3((map[b.itemId] || 0) + b.qty);
    });
    return map;
  }, [batches]);

  // Stock that can still be sold or used (expired batches left out)
  const usableStockByItem = useMemo(() => {
    const today = todayStr();
    const map = {};
    batches.forEach((b) => {
      if (b.qty > 0 && (!b.expiry || b.expiry >= today)) {
        map[b.itemId] = round3((map[b.itemId] || 0) + b.qty);
      }
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

  const addItem = ({ name, type, unit, minLevel, qty, expiry, price, category }) => {
    const clean = name.trim();
    const isMenu = type !== 'ingredient';
    const min = Number(minLevel);
    const q = Number(qty);
    const p = Number(price);

    if (!clean) return fail('Name is required.');
    if (items.some((i) => i.name.toLowerCase() === clean.toLowerCase()))
      return fail('An item with this name already exists.');
    if (!unit.trim()) return fail('Unit is required.');
    if (isMenu && !(p > 0)) return fail('Price must be greater than 0.');
    if (type === 'food' && !category) return fail('Choose a category.');
    if (Number.isNaN(min) || min < 0) return fail('Low-stock level must be 0 or more.');
    if (Number.isNaN(q) || q < 0) return fail('Starting quantity must be 0 or more.');
    if (isMenu && !Number.isInteger(q)) return fail(`Enter a whole number of ${unit.trim()}.`);
    if (expiry && expiry < todayStr()) return fail('Expiry date cannot be in the past.');

    const item = {
      id: uid('item'), name: clean, type, unit: unit.trim(), minLevel: min,
      ...(isMenu
        ? { price: Math.round(p * 100) / 100, category: type === 'food_tray' ? 'Food trays' : category }
        : {}),
    };
    setItems((prev) => [...prev, item]);
    if (q > 0) {
      const batch = { id: uid('b'), itemId: item.id, qty: q, received: todayStr(), expiry: expiry || null };
      setBatches((prev) => [...prev, batch]);
      setMovements((prev) => [
        logMovement({ itemId: item.id, batchId: batch.id, type: 'IN', qty: q, reason: 'Initial stock' }),
        ...prev,
      ]);
    }
    return done(`${clean} was added.`);
  };

  const updateMenuItem = (itemId, { price, minLevel }) => {
    const item = itemMap[itemId];
    const p = Number(price);
    const min = Number(minLevel);
    if (!item || item.type === 'ingredient') return fail('Menu item not found.');
    if (!(p > 0)) return fail('Price must be greater than 0.');
    if (Number.isNaN(min) || min < 0) return fail('Low-stock level must be 0 or more.');
    setItems((prev) =>
      prev.map((i) =>
        i.id === itemId ? { ...i, price: Math.round(p * 100) / 100, minLevel: min } : i
      )
    );
    return done(`${item.name} was updated.`);
  };

  const addStock = ({ itemId, qty, expiry }) => {
    const item = itemMap[itemId];
    const q = Number(qty);
    if (!item) return fail('Choose an item.');
    if (!(q > 0)) return fail('Quantity must be greater than 0.');
    if (item.type !== 'ingredient' && !Number.isInteger(q))
      return fail(`Enter a whole number of ${item.unit}.`);
    if (expiry && expiry < todayStr()) return fail('Expiry date cannot be in the past.');

    const batch = { id: uid('b'), itemId, qty: q, received: todayStr(), expiry: expiry || null };
    setBatches((prev) => [...prev, batch]);
    setMovements((prev) => [
      logMovement({ itemId, batchId: batch.id, type: 'IN', qty: q, reason: 'Stock in' }),
      ...prev,
    ]);
    return done(`Added ${q} ${item.unit} to ${item.name}.`);
  };

  // Deducts oldest batches first (FIFO)
  const recordLoss = ({ itemId, qty, type, reason }) => {
    const item = itemMap[itemId];
    const q = Number(qty);
    if (!item) return fail('Choose an item.');
    if (!(q > 0)) return fail('Quantity must be greater than 0.');
    if (item.type !== 'ingredient' && !Number.isInteger(q))
      return fail(`Enter a whole number of ${item.unit}.`);
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
        updates[b.id] = round3(b.qty - take);
        newMoves.push(logMovement({ itemId, batchId: b.id, type, qty: take, reason: reason.trim() }));
        remaining = round3(remaining - take);
      });

    setBatches((prev) => prev.map((b) => (b.id in updates ? { ...b, qty: updates[b.id] } : b)));
    setMovements((prev) => [...newMoves, ...prev]);
    return done(`Recorded ${q} ${item.unit} of ${item.name} as ${type.toLowerCase()}.`);
  };

  const writeOffBatch = (batchId) => {
    const b = batches.find((x) => x.id === batchId);
    if (!b || b.qty <= 0) return fail('Nothing to write off.');
    const item = itemMap[b.itemId];
    setBatches((prev) => prev.map((x) => (x.id === batchId ? { ...x, qty: 0 } : x)));
    setMovements((prev) => [
      logMovement({ itemId: b.itemId, batchId, type: 'SPOILED', qty: b.qty, reason: 'Expired' }),
      ...prev,
    ]);
    return done(`${b.qty} ${item?.unit ?? ''} of ${item?.name ?? 'item'} written off as expired.`);
  };

  // Used by the POS. lines = [{ itemId, qty }]. All-or-nothing, oldest batch first,
  // and expired batches are never used.
  const consumeStock = (lines, reference) => {
    const need = {};
    lines.forEach((l) => {
      need[l.itemId] = round3((need[l.itemId] || 0) + l.qty);
    });

    for (const [itemId, qty] of Object.entries(need)) {
      const available = usableStockByItem[itemId] || 0;
      if (qty > available) {
        const item = itemMap[itemId];
        return fail(
          `Not enough ${item?.name ?? 'stock'}: needs ${qty} ${item?.unit ?? ''}, only ${available} available.`
        );
      }
    }

    const today = todayStr();
    const updates = {};
    const newMoves = [];
    Object.entries(need).forEach(([itemId, qty]) => {
      let remaining = qty;
      batches
        .filter((b) => b.itemId === itemId && b.qty > 0 && (!b.expiry || b.expiry >= today))
        .sort((a, b) => a.received.localeCompare(b.received))
        .forEach((b) => {
          if (remaining <= 0) return;
          const take = Math.min(b.qty, remaining);
          updates[b.id] = round3(b.qty - take);
          newMoves.push(
            logMovement({ itemId, batchId: b.id, type: 'USED', qty: take, reason: reference, user: 'POS' })
          );
          remaining = round3(remaining - take);
        });
    });

    setBatches((prev) => prev.map((b) => (b.id in updates ? { ...b, qty: updates[b.id] } : b)));
    setMovements((prev) => [...newMoves, ...prev]);
    return done('Stock updated.');
  };

  return (
    <InventoryContext.Provider
      value={{
        items, batches, movements, stockByItem, usableStockByItem, itemMap,
        addItem, updateMenuItem, addStock, recordLoss, writeOffBatch, consumeStock,
      }}
    >
      {children}
    </InventoryContext.Provider>
  );
}

export function useInventory() {
  return useContext(InventoryContext);
}