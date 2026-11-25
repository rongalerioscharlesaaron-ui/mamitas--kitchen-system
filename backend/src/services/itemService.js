import { query, withTransaction } from '../config/db.js';
import { badRequest, notFound, conflict, forbidden } from '../utils/httpError.js';
import { number, date, oneOf, text, bool, parseId } from '../utils/validate.js';
import { todaySG } from '../utils/dates.js';
import { insertBatch } from './batchService.js';
import { addFoodTrays, MAX_TRAYS } from './menuStockService.js';

const statusOf = (qty, min) => (qty <= 0 ? 'out' : qty <= min ? 'low' : 'in');

// Ingredients are judged by everything on hand; foods and trays by what can still be sold
function mapItem(r) {
  const stock = r.item_type === 'ingredient' ? r.qty_on_hand : r.qty_usable;
  return {
    id: r.item_id,
    name: r.name,
    type: r.item_type,
    category: r.category,
    unit: r.unit,
    minLevel: r.min_level,
    price: r.price,
    hasExpiry: r.has_expiry,
    qtyOnHand: r.qty_on_hand,
    qtyUsable: r.qty_usable,
    openBatches: r.open_batches,
    nextExpiry: r.next_expiry,
    servingsPerTray: r.servings_per_tray, // foods are cooked by the tray: 1 tray = 10 servings
    isEnabled: r.is_enabled, // the owner can disable a menu item: hidden from the POS, cannot be sold or cooked
    status: statusOf(stock, r.min_level),
  };
}

export async function listItems(type = null) {
  const params = [];
  let where = '';
  if (type) {
    params.push(type);
    where = 'WHERE item_type = $1';
  }
  const { rows } = await query(
    `SELECT * FROM v_item_stock ${where} ORDER BY item_type, category, name`,
    params
  );
  return rows.map(mapItem);
}

// What the cashier sells: foods and food trays that are enabled (a disabled item is hidden from the POS)
export async function listMenu() {
  const { rows } = await query(
    `SELECT * FROM v_item_stock WHERE item_type <> 'ingredient' AND is_enabled ORDER BY category, name`
  );
  return rows.map(mapItem);
}

export async function getItem(id) {
  const { rows } = await query('SELECT * FROM v_item_stock WHERE item_id = $1', [id]);
  if (!rows[0]) throw notFound('Item not found.');
  return mapItem(rows[0]);
}

export async function listCategories() {
  const { rows } = await query('SELECT id, name, kind FROM categories ORDER BY kind, id');
  return rows;
}

export async function createItem(user, body) {
  return withTransaction((db) => createItemTx(db, user, body));
}

// The body of createItem, running inside a transaction that the caller owns. This lets
// createMenuItemWithRecipe create ingredients, the dish and its recipe in ONE all-or-nothing transaction.
export async function createItemTx(db, user, body) {
  const b = body ?? {};
  const type = oneOf(b.type, 'Type', ['ingredient', 'food', 'food_tray']);
  const isIngredient = type === 'ingredient';
  const isFood = type === 'food';

  const name = text(b.name, 'Name', { max: 100 });
  const unit =
    type === 'food' ? 'servings' : type === 'food_tray' ? 'trays' : text(b.unit, 'Unit', { max: 20 });
  const minLevel = number(b.minLevel, 'Low-stock level', {
    min: 0,
    max: 1000000,
    integer: !isIngredient,
  });
  const hasExpiry = isIngredient ? bool(b.hasExpiry, 'Has expiry') : false;
  const price = isIngredient
    ? null
    : number(b.price, 'Price', { min: 0.01, max: 100000, decimals: 2 });
  const categoryName =
    type === 'food_tray' ? 'Food trays' : text(b.category, 'Category', { max: 50 });
  // Foods start with trays (1 tray = 10 servings). Ingredients and food trays start with a quantity.
  if (isFood && b.qty !== undefined && b.qty !== null && b.qty !== '') {
    throw badRequest('Foods are added by the tray. Send the number of trays, not a quantity.');
  }
  const qty = isFood
    ? 0
    : number(b.qty, 'Starting quantity', {
        min: 0,
        max: 1000000,
        integer: !isIngredient,
        allowEmpty: true,
      }) ?? 0;
  const trays = isFood
    ? number(b.trays, 'Trays cooked today', {
        min: 0,
        max: MAX_TRAYS,
        integer: true,
        allowEmpty: true,
      }) ?? 0
    : 0;
  // Foods and trays are cooked fresh for the day, so no expiry date is entered for them
  const expiry = isIngredient ? date(b.expiry, 'Expiry date', { allowEmpty: true }) : null;

  if (isIngredient && hasExpiry) {
    if (!(qty > 0)) throw badRequest('Enter the quantity received for this batch.');
    if (!expiry) throw badRequest('Enter the expiry date.');
  }
  if (isIngredient && !hasExpiry && expiry) {
    throw badRequest('This ingredient has no expiry date, so a batch cannot have one.');
  }
  if (expiry && expiry < todaySG()) throw badRequest('Expiry date cannot be in the past.');

  const cat = await db.query('SELECT id FROM categories WHERE name = $1 AND kind = $2', [
    categoryName,
    type,
  ]);
  if (!cat.rows[0]) throw badRequest('Choose a valid category.');

  const dup = await db.query('SELECT 1 FROM items WHERE lower(name) = lower($1)', [name]);
  if (dup.rows[0]) throw conflict('An item with this name already exists.');

  const inserted = await db.query(
    `INSERT INTO items (name, item_type, category_id, unit, min_level, has_expiry, price)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [name, type, cat.rows[0].id, unit, minLevel, hasExpiry, price]
  );
  const itemId = inserted.rows[0].id;

  let batch = null;
  if (isFood && trays > 0) {
    // Plain createItem has no recipe yet, so only the servings are added (nothing is taken from inventory).
    // Use createMenuItemWithRecipe to add a dish with a recipe and cook it in one go.
    const food = await addFoodTrays(db, {
      itemId, trays, userId: user.id, reason: 'Initial stock',
    });
    batch = { id: food.batchId, code: food.batchCode };
  } else if (qty > 0) {
    batch = await insertBatch(db, {
      itemId,
      qty,
      expiry: expiry ?? null,
      userId: user.id,
      reason: 'Initial stock',
    });
  }
  return { itemId, batch };
}

// Add a new dish together with its recipe, all in one transaction:
//   1. every recipe ingredient that is not in Inventory yet is added to it (with its starting stock, if given)
//   2. the dish is created
//   3. the recipe is saved
//   4. if trays were entered, they are cooked through fn_add_menu_trays, so the recipe-based
//      deduction runs exactly as it does for any other platter
// If anything fails (for example an ingredient is short for the trays), NOTHING is saved.
//
// Body: { name, category, price, minLevel, trays?,
//   ingredients: [{ name, qtyPerTray,
//     // used only when the ingredient is not in Inventory yet:
//     unit, category, minLevel, hasExpiry, qty, expiry }] }
export async function createMenuItemWithRecipe(user, body) {
  const b = body ?? {};
  const lines = Array.isArray(b.ingredients) ? b.ingredients : [];
  if (lines.length === 0) throw badRequest('Add at least one ingredient to the recipe.');
  if (lines.length > 50) throw badRequest('A recipe can have at most 50 ingredients.');

  const trays =
    number(b.trays, 'Trays cooked today', {
      min: 0,
      max: MAX_TRAYS,
      integer: true,
      allowEmpty: true,
    }) ?? 0;

  const done = await withTransaction(async (db) => {
    const recipe = [];
    const createdIngredients = [];
    const seen = new Set();

    for (const raw of lines) {
      const l = raw ?? {};
      const name = text(l.name, 'Ingredient name', { max: 100 });
      const qtyPerTray = number(l.qtyPerTray, `Quantity per tray of ${name}`, {
        min: 0.001,
        max: 1000000,
        decimals: 3,
      });

      const found = await db.query(
        'SELECT id, name, item_type, unit, is_active FROM items WHERE lower(name) = lower($1)',
        [name]
      );
      let ing = found.rows[0];

      if (ing) {
        if (ing.item_type !== 'ingredient') {
          throw conflict(`"${ing.name}" is already a menu item, so it cannot be used as an ingredient.`);
        }
        if (!ing.is_active) throw conflict(`"${ing.name}" is no longer active in Inventory.`);
      } else {
        // Not in Inventory yet: add it now (createItemTx checks unit, category, expiry and so on)
        const { itemId } = await createItemTx(db, user, {
          type: 'ingredient',
          name,
          unit: l.unit,
          category: l.category,
          minLevel: l.minLevel,
          hasExpiry: l.hasExpiry === true,
          qty: l.qty,
          expiry: l.expiry,
        });
        const made = await db.query('SELECT id, name, unit FROM items WHERE id = $1', [itemId]);
        ing = made.rows[0];
        createdIngredients.push(ing.name);
      }

      if (seen.has(ing.id)) throw badRequest(`${ing.name} is listed twice in the recipe.`);
      seen.add(ing.id);
      recipe.push({ id: ing.id, name: ing.name, unit: ing.unit, qtyPerTray });
    }

    // The dish itself, with no trays yet: the recipe has to exist before anything is cooked
    const { itemId } = await createItemTx(db, user, {
      type: 'food',
      name: b.name,
      category: b.category,
      price: b.price,
      minLevel: b.minLevel,
    });

    for (const r of recipe) {
      await db.query(
        `INSERT INTO recipe_ingredients (menu_item_id, ingredient_item_id, qty_per_tray)
         VALUES ($1, $2, $3)`,
        [itemId, r.id, r.qtyPerTray]
      );
    }

    // Cooking the first trays runs the normal recipe-based deduction
    const cooked = trays > 0 ? await addFoodTrays(db, { itemId, trays, userId: user.id }) : null;

    return { itemId, recipe, createdIngredients, cooked };
  });

  return { ...done, item: await getItem(done.itemId) };
}

// Kitchen and owner can change the low-stock level. Only the owner can change a price.
export async function updateItem(user, rawId, body) {
  const b = body ?? {};
  const itemId = parseId(rawId, 'item id');

  const found = await query('SELECT item_type, price, min_level FROM items WHERE id = $1', [itemId]);
  const item = found.rows[0];
  if (!item) throw notFound('Item not found.');

  const sets = [];
  const params = [itemId];
  const changes = {};

  if (b.price !== undefined) {
    if (item.item_type === 'ingredient') throw badRequest('Ingredients have no price.');
    if (user.role !== 'owner') throw forbidden('Only the owner can change prices.');
    const price = number(b.price, 'Price', { min: 0.01, max: 100000, decimals: 2 });
    params.push(price);
    sets.push(`price = $${params.length}`);
    changes.price = { from: item.price, to: price };
  }
  if (b.minLevel !== undefined) {
    const minLevel = number(b.minLevel, 'Low-stock level', {
      min: 0,
      max: 1000000,
      integer: item.item_type !== 'ingredient',
    });
    params.push(minLevel);
    sets.push(`min_level = $${params.length}`);
    changes.minLevel = { from: item.min_level, to: minLevel };
  }
  if (sets.length === 0) throw badRequest('Nothing to update.');

  await query(`UPDATE items SET ${sets.join(', ')} WHERE id = $1`, params);
  return { itemId, changes };
}