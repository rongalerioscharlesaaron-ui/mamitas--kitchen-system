import { query, withTransaction } from '../config/db.js';
import { badRequest, notFound, conflict, forbidden } from '../utils/httpError.js';
import { number, date, oneOf, text, bool, parseId } from '../utils/validate.js';
import { todaySG } from '../utils/dates.js';
import { insertBatch } from './batchService.js';

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

// What the cashier sells: foods and food trays
export async function listMenu() {
  const { rows } = await query(
    `SELECT * FROM v_item_stock WHERE item_type <> 'ingredient' ORDER BY category, name`
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
  const b = body ?? {};
  const type = oneOf(b.type, 'Type', ['ingredient', 'food', 'food_tray']);
  const isIngredient = type === 'ingredient';

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
  const qty =
    number(b.qty, 'Starting quantity', {
      min: 0,
      max: 1000000,
      integer: !isIngredient,
      allowEmpty: true,
    }) ?? 0;
  const expiry = date(b.expiry, 'Expiry date', { allowEmpty: true });

  if (isIngredient && hasExpiry) {
    if (!(qty > 0)) throw badRequest('Enter the quantity received for this batch.');
    if (!expiry) throw badRequest('Enter the expiry date.');
  }
  if (isIngredient && !hasExpiry && expiry) {
    throw badRequest('This ingredient has no expiry date, so a batch cannot have one.');
  }
  if (expiry && expiry < todaySG()) throw badRequest('Expiry date cannot be in the past.');

  return withTransaction(async (db) => {
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
    if (qty > 0) {
      batch = await insertBatch(db, {
        itemId,
        qty,
        expiry: expiry ?? null,
        userId: user.id,
        reason: 'Initial stock',
      });
    }
    return { itemId, batch };
  });
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