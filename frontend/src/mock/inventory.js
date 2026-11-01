import { addDays } from '../utils/dates';

const ago = (days, hour = 9) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

export const SEED_ITEMS = [
  { id: 'i1', name: 'Rice', type: 'ingredient', unit: 'kg', minLevel: 10 },
  { id: 'i2', name: 'Cooking Oil', type: 'ingredient', unit: 'L', minLevel: 5 },
  { id: 'i3', name: 'Chicken Thigh', type: 'ingredient', unit: 'kg', minLevel: 8 },
  { id: 'i4', name: 'Garlic', type: 'ingredient', unit: 'kg', minLevel: 2 },
  { id: 'i5', name: 'Soy Sauce', type: 'ingredient', unit: 'L', minLevel: 3 },
  { id: 'i6', name: 'Pork Adobo Tray', type: 'food_tray', unit: 'trays', minLevel: 3 },
  { id: 'i7', name: 'Pancit Bihon Tray', type: 'food_tray', unit: 'trays', minLevel: 3 },
  { id: 'i8', name: 'Leche Flan Tray', type: 'food_tray', unit: 'trays', minLevel: 2 },
];

export const SEED_BATCHES = [
  { id: 'b1', itemId: 'i1', qty: 25, received: addDays(-10), expiry: addDays(180) },
  { id: 'b2', itemId: 'i2', qty: 4, received: addDays(-20), expiry: addDays(120) },
  { id: 'b3', itemId: 'i3', qty: 6, received: addDays(-2), expiry: addDays(2) },
  { id: 'b4', itemId: 'i3', qty: 2, received: addDays(-8), expiry: addDays(-1) },
  { id: 'b5', itemId: 'i4', qty: 1, received: addDays(-6), expiry: addDays(1) },
  { id: 'b6', itemId: 'i5', qty: 6, received: addDays(-30), expiry: addDays(200) },
  { id: 'b7', itemId: 'i6', qty: 5, received: addDays(-1), expiry: addDays(1) },
  { id: 'b8', itemId: 'i7', qty: 2, received: addDays(-1), expiry: addDays(2) },
];

export const SEED_MOVEMENTS = [
  { id: 'm1', date: ago(0, 8), itemId: 'i6', batchId: 'b7', type: 'USED', qty: 2, reason: 'Order #0012', user: 'POS' },
  { id: 'm2', date: ago(0, 8), itemId: 'i7', batchId: 'b8', type: 'USED', qty: 2, reason: 'Order #0013', user: 'POS' },
  { id: 'm3', date: ago(1, 15), itemId: 'i7', batchId: 'b8', type: 'DAMAGED', qty: 1, reason: 'Dropped during delivery', user: 'Kitchen Staff' },
  { id: 'm4', date: ago(1, 14), itemId: 'i7', batchId: 'b8', type: 'IN', qty: 5, reason: 'Stock in', user: 'Kitchen Staff' },
  { id: 'm5', date: ago(1, 9), itemId: 'i6', batchId: 'b7', type: 'IN', qty: 8, reason: 'Stock in', user: 'Kitchen Staff' },
  { id: 'm6', date: ago(2, 10), itemId: 'i3', batchId: 'b3', type: 'IN', qty: 6, reason: 'Stock in', user: 'Kitchen Staff' },
  { id: 'm7', date: ago(3, 16), itemId: 'i6', batchId: 'b7', type: 'DAMAGED', qty: 1, reason: 'Container leaked', user: 'Kitchen Staff' },
  { id: 'm8', date: ago(4, 11), itemId: 'i3', batchId: 'b4', type: 'SPOILED', qty: 1, reason: 'Spoiled (smell)', user: 'Owner' },
  { id: 'm9', date: ago(6, 9), itemId: 'i4', batchId: 'b5', type: 'IN', qty: 1, reason: 'Stock in', user: 'Kitchen Staff' },
  { id: 'm10', date: ago(8, 9), itemId: 'i3', batchId: 'b4', type: 'IN', qty: 3, reason: 'Stock in', user: 'Kitchen Staff' },
  { id: 'm11', date: ago(10, 9), itemId: 'i1', batchId: 'b1', type: 'IN', qty: 25, reason: 'Stock in', user: 'Kitchen Staff' },
  { id: 'm12', date: ago(20, 9), itemId: 'i2', batchId: 'b2', type: 'IN', qty: 4, reason: 'Stock in', user: 'Kitchen Staff' },
  { id: 'm13', date: ago(30, 9), itemId: 'i5', batchId: 'b6', type: 'IN', qty: 6, reason: 'Stock in', user: 'Kitchen Staff' },
];