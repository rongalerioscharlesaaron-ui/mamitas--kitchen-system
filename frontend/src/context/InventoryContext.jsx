import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from './AuthContext';

const InventoryContext = createContext(null);

const STAFF = ['kitchen', 'owner']; // cashiers cannot read inventory
const ok = (message) => ({ ok: true, message });
const fail = (message) => ({ ok: false, message });

// The pages were written before the API existed, so batches and movements are
// given the field names the pages already use.
const toBatch = (b) => ({ ...b, qty: b.qtyRemaining, received: b.receivedDate, expiry: b.expiryDate });
const toMovement = (m) => ({ ...m, date: m.createdAt, user: m.recordedBy });

export function InventoryProvider({ children }) {
  const { user } = useAuth();
  const active = Boolean(user && STAFF.includes(user.role));
  const userId = user?.id ?? null;

  const [items, setItems] = useState([]);
  const [batches, setBatches] = useState([]);
  const [movements, setMovements] = useState([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [it, ba, mv] = await Promise.all([
      api.get('/items'),
      api.get('/batches?inStock=true'),
      api.get('/movements?limit=500'),
    ]);
    setItems(it.items);
    setBatches(ba.batches.map(toBatch));
    setMovements(mv.movements.map(toMovement));
  }, []);

  // Load when a kitchen or owner account is logged in; clear everything on logout
  useEffect(() => {
    let cancelled = false;
    setItems([]);
    setBatches([]);
    setMovements([]);
    setError('');
    if (!active) {
      setReady(true);
      return undefined;
    }
    setReady(false);
    load()
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [active, userId, load]);

  // Sales made at the counter change stock, so refresh every 30 seconds and when the tab is focused
  useEffect(() => {
    if (!active) return undefined;
    const quiet = () => {
      if (document.visibilityState === 'visible') {
        load().then(() => setError('')).catch(() => {});
      }
    };
    const timer = setInterval(quiet, 30000);
    window.addEventListener('focus', quiet);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', quiet);
    };
  }, [active, load]);

  const refresh = useCallback(
    () => load().then(() => setError('')).catch((err) => setError(err.message)),
    [load]
  );

  const stockByItem = useMemo(
    () => Object.fromEntries(items.map((i) => [i.id, i.qtyOnHand])),
    [items]
  );
  const usableStockByItem = useMemo(
    () => Object.fromEntries(items.map((i) => [i.id, i.qtyUsable])),
    [items]
  );
  const itemMap = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);
  const batchMap = useMemo(() => Object.fromEntries(batches.map((b) => [b.id, b])), [batches]);

  // Runs one change on the server, then reloads. Always answers { ok, message }.
  const run = async (work) => {
    try {
      const message = await work();
      await refresh();
      return ok(message);
    } catch (err) {
      return fail(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    }
  };

  // Add an ingredient. An existing perishable ingredient gets a new batch instead.
  const addIngredient = ({ name, category, unit, minLevel, qty, hasExpiry, expiry }) => {
    const clean = name.trim();
    const existing = items.find(
      (i) => i.type === 'ingredient' && i.name.toLowerCase() === clean.toLowerCase()
    );
    if (existing) {
      if (!existing.hasExpiry) {
        return Promise.resolve(fail(`${existing.name} has no expiry date. Use Stock in to add more.`));
      }
      return run(async () => {
        const r = await api.post(`/items/${existing.id}/batches`, { qty, expiry: expiry || undefined });
        return `Added batch ${r.batch.code} of ${existing.name}.`;
      });
    }
    return run(async () => {
      await api.post('/items', {
        type: 'ingredient',
        name: clean,
        category,
        unit: unit.trim(),
        minLevel,
        hasExpiry,
        qty: qty === '' ? undefined : qty,
        expiry: expiry || undefined,
      });
      return `${clean} was added.`;
    });
  };

  // Add a menu item: a food (servings) or a food tray
  const addItem = ({ name, type, category, price, minLevel, qty, expiry }) =>
    run(async () => {
      await api.post('/items', {
        type,
        name: name.trim(),
        category,
        price,
        minLevel,
        qty: qty === '' ? undefined : qty,
        expiry: expiry || undefined,
      });
      return `${name.trim()} was added.`;
    });

  // Only fields that are given are sent. Only the owner can change a price.
  const updateMenuItem = (itemId, { price, minLevel }) => {
    const item = itemMap[itemId];
    const body = {};
    if (price !== undefined) body.price = price;
    if (minLevel !== undefined) body.minLevel = minLevel;
    return run(async () => {
      await api.patch(`/items/${itemId}`, body);
      return `${item?.name ?? 'Item'} was updated.`;
    });
  };

  const addStock = ({ itemId, qty, expiry }) => {
    const item = itemMap[itemId];
    if (!item) return Promise.resolve(fail('Choose an item.'));
    return run(async () => {
      const r = await api.post(`/items/${itemId}/batches`, { qty, expiry: expiry || undefined });
      return `Added ${qty} ${item.unit} to ${item.name} (batch ${r.batch.code}).`;
    });
  };

  // Damaged or spoiled goods come off one specific batch
  const recordLoss = ({ itemId, batchId, qty, type, reason }) => {
    if (!itemId) return Promise.resolve(fail('Choose an item.'));
    if (!batchId) return Promise.resolve(fail('Choose the batch of this item.'));
    return run(async () => {
      const { result } = await api.post(`/batches/${batchId}/loss`, { type, qty, reason });
      return `Recorded ${result.qty} ${result.unit} of ${result.itemName} (batch ${result.batchCode}) as ${result.type.toLowerCase()}.`;
    });
  };

  const writeOffBatch = (batchId) =>
    run(async () => {
      const { result } = await api.post(`/batches/${batchId}/write-off`);
      return `${result.qty} ${result.unit} of ${result.itemName} (batch ${result.batchCode}) written off as expired.`;
    });

  // The POS is connected in Part C. Until then the old order screen cannot sell.
  const consumeStock = () => ({ ok: false, message: 'The POS is connected in the next stage.' });

  return (
    <InventoryContext.Provider
      value={{
        items, batches, movements, stockByItem, usableStockByItem, itemMap, batchMap,
        ready, error, refresh,
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