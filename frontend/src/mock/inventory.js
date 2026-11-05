import { addDays } from '../utils/dates';

const ago = (days, hour = 9) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

export const SEED_ITEMS = [
  // Wet ingredients
  { id: 'i2', name: 'Cooking Oil', type: 'ingredient', category: 'Wet ingredients', unit: 'L', minLevel: 5, hasExpiry: true },
  { id: 'i5', name: 'Soy Sauce', type: 'ingredient', category: 'Wet ingredients', unit: 'L', minLevel: 3, hasExpiry: true },
  { id: 'i14', name: 'Vinegar', type: 'ingredient', category: 'Wet ingredients', unit: 'L', minLevel: 3, hasExpiry: false },
  // Dry ingredients
  { id: 'i1', name: 'Rice', type: 'ingredient', category: 'Dry ingredients', unit: 'kg', minLevel: 10, hasExpiry: false },
  { id: 'i4', name: 'Garlic', type: 'ingredient', category: 'Dry ingredients', unit: 'kg', minLevel: 2, hasExpiry: true },
  { id: 'i15', name: 'Salt', type: 'ingredient', category: 'Dry ingredients', unit: 'kg', minLevel: 2, hasExpiry: false },
  // Meat
  { id: 'i3', name: 'Chicken Thigh', type: 'ingredient', category: 'Meat', unit: 'kg', minLevel: 8, hasExpiry: true },
  { id: 'i16', name: 'Pork Belly', type: 'ingredient', category: 'Meat', unit: 'kg', minLevel: 6, hasExpiry: true },
  // Food trays (sold per tray)
  { id: 'i6', name: 'Pork Adobo Tray', type: 'food_tray', unit: 'trays', minLevel: 3, price: 38, category: 'Food trays' },
  { id: 'i7', name: 'Pancit Bihon Tray', type: 'food_tray', unit: 'trays', minLevel: 3, price: 32, category: 'Food trays' },
  { id: 'i8', name: 'Leche Flan Tray', type: 'food_tray', unit: 'trays', minLevel: 2, price: 28, category: 'Food trays' },
  // Foods (sold per serving)
  { id: 'i9', name: 'Chicken Adobo', type: 'food', unit: 'servings', minLevel: 10, price: 8.5, category: 'Main dishes' },
  { id: 'i10', name: 'Fried Chicken', type: 'food', unit: 'servings', minLevel: 10, price: 8, category: 'Main dishes' },
  { id: 'i11', name: 'Pancit Bihon', type: 'food', unit: 'servings', minLevel: 8, price: 7.5, category: 'Main dishes' },
  { id: 'i12', name: 'Garlic Rice', type: 'food', unit: 'servings', minLevel: 10, price: 2.5, category: 'Sides' },
  { id: 'i13', name: 'Leche Flan', type: 'food', unit: 'servings', minLevel: 6, price: 3.5, category: 'Desserts' },
];

export const SEED_BATCHES = [
  { id: 'b1', code: 'B-0001', itemId: 'i1', qty: 25, received: addDays(-10), expiry: null },
  { id: 'b2', code: 'B-0002', itemId: 'i2', qty: 4, received: addDays(-20), expiry: addDays(120) },
  { id: 'b3', code: 'B-0003', itemId: 'i3', qty: 6, received: addDays(-2), expiry: addDays(2) },
  { id: 'b4', code: 'B-0004', itemId: 'i3', qty: 2, received: addDays(-8), expiry: addDays(-1) },
  { id: 'b5', code: 'B-0005', itemId: 'i4', qty: 1, received: addDays(-6), expiry: addDays(1) },
  { id: 'b6', code: 'B-0006', itemId: 'i5', qty: 6, received: addDays(-30), expiry: addDays(200) },
  { id: 'b7', code: 'B-0007', itemId: 'i6', qty: 5, received: addDays(-1), expiry: addDays(1) },
  { id: 'b8', code: 'B-0008', itemId: 'i7', qty: 2, received: addDays(-1), expiry: addDays(2) },
  { id: 'b9', code: 'B-0009', itemId: 'i9', qty: 24, received: addDays(0), expiry: addDays(1) },
  { id: 'b10', code: 'B-0010', itemId: 'i10', qty: 8, received: addDays(0), expiry: addDays(1) },
  { id: 'b11', code: 'B-0011', itemId: 'i11', qty: 5, received: addDays(0), expiry: addDays(1) },
  { id: 'b12', code: 'B-0012', itemId: 'i12', qty: 30, received: addDays(0), expiry: addDays(1) },
  { id: 'b13', code: 'B-0013', itemId: 'i13', qty: 12, received: addDays(-1), expiry: addDays(3) },
  { id: 'b14', code: 'B-0014', itemId: 'i14', qty: 8, received: addDays(-15), expiry: null },
  { id: 'b15', code: 'B-0015', itemId: 'i15', qty: 3, received: addDays(-12), expiry: null },
  { id: 'b16', code: 'B-0016', itemId: 'i16', qty: 10, received: addDays(-1), expiry: addDays(4) },
];

export const SEED_MOVEMENTS = [
  { id: 'm1', date: ago(0, 8), itemId: 'i6', batchId: 'b7', type: 'USED', qty: 2, reason: 'Order #0012', user: 'POS' },
  { id: 'm2', date: ago(0, 8), itemId: 'i7', batchId: 'b8', type: 'USED', qty: 2, reason: 'Order #0013', user: 'POS' },
  { id: 'm3', date: ago(1, 15), itemId: 'i7', batchId: 'b8', type: 'DAMAGED', qty: 1, reason: 'Dropped during delivery', user: 'Kitchen Staff' },
  { id: 'm4', date: ago(1, 14), itemId: 'i7', batchId: 'b8', type: 'IN', qty: 5, reason: 'Stock in', user: 'Kitchen Staff' },
  { id: 'm5', date: ago(1, 9), itemId: 'i6', batchId: 'b7', type: 'IN', qty: 8, reason: 'Stock in', user: 'Kitchen Staff' },
  { id: 'm6', date: ago(2, 10), itemId: 'i3', batchId: 'b3', type: 'IN', qty: 6, reason: 'New batch', user: 'Kitchen Staff' },
  { id: 'm7', date: ago(3, 16), itemId: 'i6', batchId: 'b7', type: 'DAMAGED', qty: 1, reason: 'Container leaked', user: 'Kitchen Staff' },
  { id: 'm8', date: ago(4, 11), itemId: 'i3', batchId: 'b4', type: 'SPOILED', qty: 1, reason: 'Spoiled (smell)', user: 'Owner' },
  { id: 'm9', date: ago(6, 9), itemId: 'i4', batchId: 'b5', type: 'IN', qty: 1, reason: 'New batch', user: 'Kitchen Staff' },
  { id: 'm10', date: ago(8, 9), itemId: 'i3', batchId: 'b4', type: 'IN', qty: 3, reason: 'New batch', user: 'Kitchen Staff' },
  { id: 'm11', date: ago(10, 9), itemId: 'i1', batchId: 'b1', type: 'IN', qty: 25, reason: 'Stock in', user: 'Kitchen Staff' },
  { id: 'm12', date: ago(20, 9), itemId: 'i2', batchId: 'b2', type: 'IN', qty: 4, reason: 'New batch', user: 'Kitchen Staff' },
  { id: 'm13', date: ago(30, 9), itemId: 'i5', batchId: 'b6', type: 'IN', qty: 6, reason: 'New batch', user: 'Kitchen Staff' },
  { id: 'm14', date: ago(0, 7), itemId: 'i9', batchId: 'b9', type: 'IN', qty: 26, reason: 'Stock in', user: 'Kitchen Staff' },
  { id: 'm15', date: ago(0, 8), itemId: 'i9', batchId: 'b9', type: 'USED', qty: 2, reason: 'Order #0011', user: 'POS' },
  { id: 'm16', date: ago(0, 7), itemId: 'i10', batchId: 'b10', type: 'IN', qty: 8, reason: 'Stock in', user: 'Kitchen Staff' },
  { id: 'm17', date: ago(0, 7), itemId: 'i11', batchId: 'b11', type: 'IN', qty: 5, reason: 'Stock in', user: 'Kitchen Staff' },
  { id: 'm18', date: ago(0, 7), itemId: 'i12', batchId: 'b12', type: 'IN', qty: 30, reason: 'Stock in', user: 'Kitchen Staff' },
  { id: 'm19', date: ago(1, 15), itemId: 'i13', batchId: 'b13', type: 'IN', qty: 14, reason: 'Stock in', user: 'Kitchen Staff' },
  { id: 'm20', date: ago(0, 8), itemId: 'i13', batchId: 'b13', type: 'USED', qty: 2, reason: 'Order #0011', user: 'POS' },
  { id: 'm21', date: ago(15, 9), itemId: 'i14', batchId: 'b14', type: 'IN', qty: 8, reason: 'Stock in', user: 'Kitchen Staff' },
  { id: 'm22', date: ago(12, 9), itemId: 'i15', batchId: 'b15', type: 'IN', qty: 3, reason: 'Stock in', user: 'Kitchen Staff' },
  { id: 'm23', date: ago(1, 10), itemId: 'i16', batchId: 'b16', type: 'IN', qty: 10, reason: 'New batch', user: 'Kitchen Staff' },
];