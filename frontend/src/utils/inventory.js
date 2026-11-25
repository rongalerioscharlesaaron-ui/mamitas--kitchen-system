export const TYPE_LABEL = { ingredient: 'Ingredient', food: 'Food', food_tray: 'Food tray' };
export const FOOD_CATEGORIES = [
  'Main dishes',
  'Snacks and appetizers',
  'Soup and noodle dishes',
  'Desserts',
];
export const INGREDIENT_CATEGORIES = ['Wet ingredients', 'Dry ingredients', 'Meat'];

export const MOVE_LABEL = {
  IN: 'Stock In', USED: 'Used', DAMAGED: 'Damaged', SPOILED: 'Spoiled', ADJUSTMENT: 'Adjustment',
};
export const MOVE_TONE = {
  IN: 'ok', USED: 'info', DAMAGED: 'danger', SPOILED: 'warn', ADJUSTMENT: 'muted',
};

export function stockStatus(usableStock, min, { hasExpired = false } = {}) {
  if (usableStock <= 0 && hasExpired) return { key: 'expired', label: 'Expired', tone: 'danger' };
  if (usableStock <= 0) return { key: 'out', label: 'Out of stock', tone: 'danger' };
  if (usableStock <= min) return { key: 'low', label: 'Low stock', tone: 'warn' };
  return { key: 'in', label: 'In stock', tone: 'ok' };
}

export const EXPIRY_INFO = {
  expired: { label: 'Expired', tone: 'danger' },
  soon: { label: 'Expiring soon', tone: 'warn' },
  ok: { label: 'OK', tone: 'ok' },
  none: { label: 'No expiry', tone: 'muted' },
};