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

// What to tell the person after trays of a dish were added: the servings, and what came off inventory
function foodAddedMessage(item, r) {
  const trays = `${r.trays} ${r.trays === 1 ? 'tray' : 'trays'}`;
  const head = `Added ${trays} (${r.servings} servings) of ${item.name} for today.`;
  if (!r.hasRecipe) return `${head} This dish has no recipe yet, so no ingredients were deducted.`;
  const used = r.used.map((u) => `${u.name} ${u.qty} ${u.unit}`).join(', ');
  return `${head} Ingredients deducted (oldest batch first): ${used}.`;
}

export function InventoryProvider({ children }) {
  const { user } = useAuth();
  const active = Boolean(user && !user.mustChangePassword && STAFF.includes(user.role));
  const userId = user?.id ?? null;

  const [items, setItems] = useState([]);
  const [batches, setBatches] = useState([]);
  const [movements, setMovements] = useState([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    // Ingredients and menu items are loaded separately, so a busy day of sales
    // never pushes the ingredient history out of the list
    const [it, ba, mvIng, mvMenu] = await Promise.all([
      api.get('/items'),
      api.get('/batches?inStock=true'),
      api.get('/movements?kind=ingredient&limit=300'),
      api.get('/movements?kind=menu&limit=300'),
    ]);
    setItems(it.items);
    setBatches(ba.batches.map(toBatch));
    setMovements([...mvIng.movements, ...mvMenu.movements].map(toMovement));
  }, []);

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

  // Add a menu item: a food (cooked by the tray) or a food tray. No expiry date: it is cooked fresh for the day.
  const addItem = ({ name, type, category, price, minLevel, qty }) =>
    run(async () => {
      const start = qty === '' ? undefined : qty;
      await api.post('/items', {
        type,
        name: name.trim(),
        category,
        price,
        minLevel,
        // A food starts with trays (1 tray = 10 servings). A food tray starts with a quantity.
        ...(type === 'food' ? { trays: start } : { qty: start }),
      });
      return `${name.trim()} was added.`;
    });

  // Add a new food together with its recipe, in one all-or-nothing request.
  // Each ingredient line is { name, qtyPerTray } for one already in Inventory, or also
  // { unit, category, minLevel, hasExpiry, qty, expiry } for a new one (it is added to Inventory).
  // If trays are given, they are cooked now, so the recipe's ingredients are deducted.
  const addMenuItemWithRecipe = ({ name, category, price, minLevel, trays, ingredients }) =>
    run(async () => {
      const clean = name.trim();
      const r = await api.post('/items/with-recipe', {
        name: clean,
        category,
        price,
        minLevel,
        trays: trays === '' ? undefined : trays,
        ingredients: ingredients.map((l) => ({
          ...l,
          name: l.name.trim(),
          qty: l.qty === '' ? undefined : l.qty,
          expiry: l.expiry || undefined,
        })),
      });

      const count = r.recipe.length;
      let msg = `${clean} was added with a recipe of ${count} ${count === 1 ? 'ingredient' : 'ingredients'}.`;
      if (r.createdIngredients?.length) {
        msg += ` Added to Inventory: ${r.createdIngredients.join(', ')}.`;
      }
      if (r.trays) {
        msg += ` ${foodAddedMessage({ name: clean }, { ...r, hasRecipe: true })}`;
      }
      return msg;
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

  // Owner only: switch a menu item on or off. A disabled item leaves the POS and cannot get new stock,
  // but its servings, history and recipe stay.
  const setMenuEnabled = (itemId, enabled) => {
    const item = itemMap[itemId];
    return run(async () => {
      const { item: r } = await api.patch(`/admin/menu/${itemId}`, { enabled });
      const name = item?.name ?? r.name ?? 'Item';
      if (!r.changed) return `${name} was already ${enabled ? 'enabled' : 'disabled'}.`;
      if (enabled) return `${name} is enabled again. It is back on the POS and in stock-in.`;
      const left = Number(r.qtyUsable) > 0 ? ` ${r.qtyUsable} ${r.unit} still in stock is kept but cannot be sold.` : '';
      return `${name} is disabled. It is hidden from the POS and cannot get new stock.${left}`;
    });
  };

  // Ingredients without an expiry date, trays of a dish, and food trays for the day
  const addStock = ({ itemId, qty }) => {
    const item = itemMap[itemId];
    if (!item) return Promise.resolve(fail('Choose an item.'));
    const isMenu = item.type !== 'ingredient';
    return run(async () => {
      // A dish is added by the tray: its recipe's ingredients come off inventory, oldest batch first
      if (item.type === 'food') {
        const f = await api.post(`/items/${itemId}/batches`, { trays: qty });
        return foodAddedMessage(item, f);
      }
      const r = await api.post(`/items/${itemId}/batches`, { qty });
      return isMenu
        ? `Added ${qty} ${item.unit} of ${item.name} for today.`
        : `Added ${qty} ${item.unit} to ${item.name} (batch ${r.batch.code}).`;
    });
  };

  // Damaged or spoiled ingredients come off one specific batch
  const recordLoss = ({ itemId, batchId, qty, type, reason }) => {
    if (!itemId) return Promise.resolve(fail('Choose an item.'));
    if (!batchId) return Promise.resolve(fail('Choose the batch of this item.'));
    return run(async () => {
      const { result } = await api.post(`/batches/${batchId}/loss`, { type, qty, reason });
      return `Recorded ${result.qty} ${result.unit} of ${result.itemName} (batch ${result.batchCode}) as ${result.type.toLowerCase()}.`;
    });
  };

  // Damaged or spoiled servings come off today's stock
  const recordMenuLoss = ({ itemId, qty, type, reason }) => {
    if (!itemId) return Promise.resolve(fail('Choose an item.'));
    return run(async () => {
      const { result } = await api.post(`/items/${itemId}/loss`, { type, qty, reason });
      return `Recorded ${result.qty} ${result.unit} of ${result.itemName} as ${result.type.toLowerCase()}.`;
    });
  };

  const writeOffBatch = (batchId) =>
    run(async () => {
      const { result } = await api.post(`/batches/${batchId}/write-off`);
      return `${result.qty} ${result.unit} of ${result.itemName} (batch ${result.batchCode}) written off as expired.`;
    });

  // Writes off expired servings and trays: of one item, or of the whole menu
  const writeOffExpiredMenu = (itemId) =>
    run(async () => {
      const { result } = await api.post('/items/write-off-expired', itemId ? { itemId } : {});
      if (result.batches === 0) return 'Nothing had expired.';
      return `Wrote off ${result.servings} expired ${result.servings === 1 ? 'serving or tray' : 'servings and trays'} from ${result.items} ${result.items === 1 ? 'item' : 'items'}.`;
    });

  // Sets an ingredient batch to the quantity that was really counted
  const adjustBatch = ({ batchId, countedQty, reason }) => {
    if (!batchId) return Promise.resolve(fail('Choose the batch you counted.'));
    return run(async () => {
      const { result } = await api.post(`/batches/${batchId}/adjust`, { countedQty, reason });
      const sign = result.diff > 0 ? '+' : '';
      return `Batch ${result.batchCode} of ${result.itemName} is now ${result.to} ${result.unit} (${sign}${result.diff}).`;
    });
  };

  // Sets today's servings to the quantity that was really counted
  const adjustMenuStock = ({ itemId, countedQty, reason }) => {
    if (!itemId) return Promise.resolve(fail('Choose an item.'));
    return run(async () => {
      const { result } = await api.post(`/items/${itemId}/adjust`, { countedQty, reason });
      const sign = result.diff > 0 ? '+' : '';
      return `${result.itemName} is now ${result.to} ${result.unit} for today (${sign}${result.diff}).`;
    });
  };

  // Updates a batch's expiry date
  const updateBatchExpiry = ({ batchId, expiry }) => {
    if (!batchId) return Promise.resolve(fail('Choose a batch.'));
    if (!expiry) return Promise.resolve(fail('Enter an expiry date.'));
    return run(async () => {
      const { result } = await api.patch(`/batches/${batchId}`, { expiry });
      return `Updated expiry date of ${result.itemName} (batch ${result.batchCode}) to ${result.to}.`;
    });
  };

  return (
    <InventoryContext.Provider
      value={{
        items, batches, movements, stockByItem, usableStockByItem, itemMap, batchMap,
        ready, error, refresh,
        addIngredient, addItem, addMenuItemWithRecipe, updateMenuItem, setMenuEnabled, addStock,
        recordLoss, recordMenuLoss,
        writeOffBatch, writeOffExpiredMenu, adjustBatch, adjustMenuStock, updateBatchExpiry,
      }}
    >
      {children}
    </InventoryContext.Provider>
  );
}

export function useInventory() {
  return useContext(InventoryContext);
}