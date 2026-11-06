export const TYPE_LABEL = { ingredient: 'Ingredient', food: 'Food', food_tray: 'Food tray' };
export const FOOD_CATEGORIES = ['Main dishes', 'Sides', 'Desserts'];
export const INGREDIENT_CATEGORIES = ['Wet ingredients', 'Dry ingredients', 'Meat'];

export const MOVE_LABEL = {
  IN: 'Stock In', USED: 'Used', DAMAGED: 'Damaged', SPOILED: 'Spoiled', ADJUSTMENT: 'Adjustment',
};
export const MOVE_TONE = {
  IN: 'ok', USED: 'info', DAMAGED: 'danger', SPOILED: 'warn', ADJUSTMENT: 'muted',
};

export function stockStatus(stock, min) {
  if (stock <= 0) return { key: 'out', label: 'Out of stock', tone: 'danger' };
  if (stock <= min) return { key: 'low', label: 'Low stock', tone: 'warn' };
  return { key: 'in', label: 'In stock', tone: 'ok' };
}

export const EXPIRY_INFO = {
  expired: { label: 'Expired', tone: 'danger' },
  soon: { label: 'Expiring soon', tone: 'warn' },
  ok: { label: 'OK', tone: 'ok' },
};