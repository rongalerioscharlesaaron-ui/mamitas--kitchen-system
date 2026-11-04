const at = (daysAgo, hour, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

export const SEED_ORDERS = [
  {
    id: 'o13', number: '0013', createdAt: at(0, 8, 20), cashier: 'Cashier', type: 'takeaway',
    lines: [{ itemId: 'i7', name: 'Pancit Bihon Tray', price: 32, qty: 2 }],
    total: 64, gst: 0,
    payment: { method: 'paynow', tendered: 64, change: 0 },
    status: 'preparing', completedAt: null,
  },
  {
    id: 'o12', number: '0012', createdAt: at(0, 8, 5), cashier: 'Cashier', type: 'takeaway',
    lines: [{ itemId: 'i6', name: 'Pork Adobo Tray', price: 38, qty: 2 }],
    total: 76, gst: 0,
    payment: { method: 'card', tendered: 76, change: 0 },
    status: 'completed', completedAt: at(0, 8, 30),
  },
  {
    id: 'o11', number: '0011', createdAt: at(0, 7, 40), cashier: 'Cashier', type: 'dine_in',
    lines: [
      { itemId: 'i9', name: 'Chicken Adobo', price: 8.5, qty: 2 },
      { itemId: 'i13', name: 'Leche Flan', price: 3.5, qty: 2 },
    ],
    total: 24, gst: 0,
    payment: { method: 'cash', tendered: 30, change: 6 },
    status: 'completed', completedAt: at(0, 8, 0),
  },
];