import { createContext, useContext, useMemo, useState } from 'react';
import { SEED_ITEMS, SEED_BATCHES, SEED_MOVEMENTS } from '../mock/inventory';
import { useAuth } from './AuthContext';
import { todayStr } from '../utils/dates';
import { round3 } from '../utils/money';
import { INGREDIENT_CATEGORIES } from '../utils/inventory';

const InventoryContext = createContext(null);

const uid = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const fail = (message) => ({ ok: false, message });
const done = (message) => ({ ok: true, message });

// Unique, readable batch ID: B-0001, B-0002, ...
const nextBatchCode = (list) => {
  const max = Math.max(0, ...list.map((b) => parseInt(String(b.code).replace(/\D/g, ''), 10) || 0));
  return `B-${String(max + 1).padStart(4, '0')}`;
};

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
  const batchMap = useMemo(() => Object.fromEntries(batches.map((b) => [b.id, b])), [batches]);

  const logMovement = (m) => ({
    id: uid('mv'),
    date: new Date().toISOString(),
    user: actor,
    ...m,
  });

  const newBatch = (itemId, qty, expiry) => ({
    id: uid('b'),
    code: nextBatchCode(batches),
    itemId,
    qty,
    received: todayStr(),
    expiry: expiry || null,
  });

  // Ingredients. Perishable ingredients are added here, one batch at a time.
  // Typing the name of an existing perishable ingredient adds a new batch to it.
  const addIngredient = ({ name, category, unit, minLevel, qty, hasExpiry, expiry }) => {
    const clean = name.trim();
    const q = Number(qty);
    if (!clean) return fail('Ingredient name is required.');

    const existing = items.find(
      (i) => i.type === 'ingredient' && i.name.toLowerCase() === clean.toLowerCase()
    );
    if (!existing && items.some((i) => i.name.toLowerCase() === clean.toLowerCase())) {
      return fail('A menu item already uses this name.');
    }

    if (existing) {
      if (!existing.hasExpiry)
        return fail(`${existing.name} has no expiry date. Use Stock in to add more.`);
      if (!(q > 0)) return fail('Quantity must be greater than 0.');
      if (!expiry) return fail('Enter the expiry date of this batch.');
      if (expiry < todayStr()) return fail('Expiry date cannot be in the past.');
      const batch = newBatch(existing.id, q, expiry);
      setBatches((prev) => [...prev, batch]);
      setMovements((prev) => [
        logMovement({ itemId: existing.id, batchId: batch.id, type: 'IN', qty: q, reason: 'New batch' }),
        ...prev,
      ]);
      return done(`Added batch ${batch.code} of ${existing.name}.`);
    }

    const min = Number(minLevel);
    if (!INGREDIENT_CATEGORIES.includes(category)) return fail('Choose a category.');
    if (!unit.trim()) return fail('Unit is required.');
    if (minLevel === '' || Number.isNaN(min) || min < 0) return fail('Low-stock level must be 0 or more.');
    if (hasExpiry) {
      if (!(q > 0)) return fail('Enter the quantity received for this batch.');
      if (!expiry) return fail('Enter the expiry date.');
    } else if (qty !== '' && (Number.isNaN(q) || q < 0)) {
      return fail('Starting quantity must be 0 or more.');
    }
    if (expiry && expiry < todayStr()) return fail('Expiry date cannot be in the past.');

    const item = {
      id: uid('item'), name: clean, type: 'ingredient', category,
      unit: unit.trim(), minLevel: min, hasExpiry: Boolean(hasExpiry),
    };
    setItems((prev) => [...prev, item]);
    if (q > 0) {
      const batch = newBatch(item.id, q, hasExpiry ? expiry : null);
      setBatches((prev) => [...prev, batch]);
      setMovements((prev) => [
        logMovement({ itemId: item.id, batchId: batch.id, type: 'IN', qty: q, reason: 'Initial stock' }),
        ...prev,
      ]);
    }
    return done(`${clean} was added.`);
  };

  // Menu items (foods and food trays)
  const addItem = ({ name, type, unit, minLevel, qty, expiry, price, category }) => {
    const clean = name.trim();
    const min = Number(minLevel);
    const q = Number(qty);
    const p = Number(price);

    if (type === 'ingredient') return fail('Use Add ingredient for ingredients.');
    if (!clean) return fail('Name is required.');
    if (items.some((i) => i.name.toLowerCase() === clean.toLowerCase()))
      return fail('An item with this name already exists.');
    if (!unit.trim()) return fail('Unit is required.');
    if (!(p > 0)) return fail('Price must be greater than 0.');
    if (type === 'food' && !category) return fail('Choose a category.');
    if (Number.isNaN(min) || min < 0) return fail('Low-stock level must be 0 or more.');
    if (Number.isNaN(q) || q < 0) return fail('Starting quantity must be 0 or more.');
    if (!Number.isInteger(q)) return fail(`Enter a whole number of ${unit.trim()}.`);
    if (expiry && expiry < todayStr()) return fail('Expiry date cannot be in the past.');

    const item = {
      id: uid('item'), name: clean, type, unit: unit.trim(), minLevel: min,
      price: Math.round(p * 100) / 100,
      category: type === 'food_tray' ? 'Food trays' : category,
    };
    setItems((prev) => [...prev, item]);
    if (q > 0) {
      const batch = newBatch(item.id, q, expiry);
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

  // Stock in. Ingredients with an expiry date must use Add ingredient instead.
  const addStock = ({ itemId, qty, expiry }) => {
    const item = itemMap[itemId];
    const q = Number(qty);
    if (!item) return fail('Choose an item.');
    if (item.type === 'ingredient' && item.hasExpiry)
      return fail('This ingredient has an expiry date. Use Add ingredient to record a new batch.');
    if (!(q > 0)) return fail('Quantity must be greater than 0.');
    if (item.type !== 'ingredient' && !Number.isInteger(q))
      return fail(`Enter a whole number of ${item.unit}.`);
    if (item.type !== 'ingredient' && expiry && expiry < todayStr())
      return fail('Expiry date cannot be in the past.');

    const batch = newBatch(itemId, q, item.type === 'ingredient' ? null : expiry);
    setBatches((prev) => [...prev, batch]);
    setMovements((prev) => [
      logMovement({ itemId, batchId: batch.id, type: 'IN', qty: q, reason: 'Stock in' }),
      ...prev,
    ]);
    return done(`Added ${q} ${item.unit} to ${item.name} (batch ${batch.code}).`);
  };

  // Damaged or spoiled goods come off one specific batch
  const recordLoss = ({ itemId, batchId, qty, type, reason }) => {
    const item = itemMap[itemId];
    const batch = batchMap[batchId];
    const q = Number(qty);
    if (!item) return fail('Choose an item.');
    if (!batch || batch.itemId !== itemId) return fail('Choose the batch of this item.');
    if (!(q > 0)) return fail('Quantity must be greater than 0.');
    if (item.type !== 'ingredient' && !Number.isInteger(q))
      return fail(`Enter a whole number of ${item.unit}.`);
    if (!reason.trim()) return fail('Please give a reason.');
    if (q > batch.qty) return fail(`Only ${batch.qty} ${item.unit} left in batch ${batch.code}.`);

    setBatches((prev) =>
      prev.map((b) => (b.id === batchId ? { ...b, qty: round3(b.qty - q) } : b))
    );
    setMovements((prev) => [
      logMovement({ itemId, batchId, type, qty: q, reason: reason.trim() }),
      ...prev,
    ]);
    return done(
      `Recorded ${q} ${item.unit} of ${item.name} (batch ${batch.code}) as ${type.toLowerCase()}.`
    );
  };

  const writeOffBatch = (batchId) => {
    const b = batchMap[batchId];
    if (!b || b.qty <= 0) return fail('Nothing to write off.');
    const item = itemMap[b.itemId];
    setBatches((prev) => prev.map((x) => (x.id === batchId ? { ...x, qty: 0 } : x)));
    setMovements((prev) => [
      logMovement({ itemId: b.itemId, batchId, type: 'SPOILED', qty: b.qty, reason: 'Expired' }),
      ...prev,
    ]);
    return done(
      `${b.qty} ${item?.unit ?? ''} of ${item?.name ?? 'item'} (batch ${b.code}) written off as expired.`
    );
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
        items, batches, movements, stockByItem, usableStockByItem, itemMap, batchMap,
        addIngredient, addItem, updateMenuItem, addStock, recordLoss, writeOffBatch, consumeStock,
      }}
    >
      {children}
    </InventoryContext.Provider>
  );
}

export function useInventory() {
  return useContext(InventoryContext);
}