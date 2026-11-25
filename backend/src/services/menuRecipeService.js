import { withTransaction } from '../config/db.js';
import { badRequest } from '../utils/httpError.js';
import { text, number } from '../utils/validate.js';
import { createItemTx } from './itemService.js';
import { addFoodTrays, MAX_TRAYS } from './menuStockService.js';

const DEFAULT_INGREDIENT_CATEGORY = 'Ingredients'; // adjust to your category name

export async function createMenuItemWithRecipe(user, body) {
  const b = body ?? {};
  const lines = Array.isArray(b.ingredients) ? b.ingredients : [];
  if (lines.length === 0) throw badRequest('Add at least one ingredient to the recipe.');

  const trays = number(b.trays, 'Trays cooked now', {
    min: 0, max: MAX_TRAYS, integer: true, allowEmpty: true,
  }) ?? 0;

  return withTransaction(async (db) => {
    // 1. Resolve each ingredient: reuse it if it exists, otherwise add it to Inventory
    const recipe = [];
    const createdIngredients = [];
    const seen = new Set();

    for (const line of lines) {
      const qtyPerTray = number(line.qtyPerTray, 'Quantity per tray', {
        min: 0.001, max: 1000000,
      });

      let found;
      if (line.ingredientId) {
        found = (await db.query(
          `SELECT id, name, unit FROM items
           WHERE id = $1 AND item_type = 'ingredient' AND is_active`,
          [line.ingredientId]
        )).rows[0];
        if (!found) throw badRequest('One of the chosen ingredients no longer exists.');
      } else {
        const name = text(line.name, 'Ingredient name', { max: 100 });
        found = (await db.query(
          `SELECT id, name, unit FROM items
           WHERE lower(name) = lower($1) AND item_type = 'ingredient' AND is_active`,
          [name]
        )).rows[0];

        if (!found) {
          // Not in Inventory yet: create it (and its starting stock, if given)
          const { item } = await createItemTx(db, user, {
            type: 'ingredient',
            name,
            unit: line.unit,
            category: line.category ?? DEFAULT_INGREDIENT_CATEGORY,
            minLevel: line.minLevel ?? 0,
            qty: line.startQty ?? 0,
            expiry: line.expiry,
          });
          found = { id: item.id, name: item.name, unit: item.unit };
          createdIngredients.push(found.name);
        }
      }

      if (seen.has(found.id)) throw badRequest(`${found.name} is listed twice in the recipe.`);
      seen.add(found.id);
      recipe.push({
        id: found.id, name: found.name, unit: found.unit,
        qtyPerTray, isOptional: line.isOptional === true,
      });
    }

    // 2. Create the dish (no trays yet, so nothing is deducted here)
    const { item, batch } = await createItemTx(db, user, {
      type: 'food',
      name: b.name,
      category: b.category,
      price: b.price,
      minLevel: b.minLevel,
    });

    // 3. Save the recipe
    for (const r of recipe) {
      await db.query(
        `INSERT INTO recipe_ingredients (menu_item_id, ingredient_item_id, qty_per_tray, is_optional)
         VALUES ($1, $2, $3, $4)`,
        [item.id, r.id, r.qtyPerTray, r.isOptional]
      );
    }

    // 4. Optionally cook the first trays: this triggers the normal recipe-based deduction.
    //    If any ingredient is short, it raises one error listing every shortage and the
    //    WHOLE thing (dish, new ingredients, recipe) rolls back.
    const cooked = trays > 0
      ? await addFoodTrays(db, { itemId: item.id, trays, userId: user.id })
      : null;

    return { item, batch: batch ?? null, recipe, createdIngredients, cooked };
  });
}