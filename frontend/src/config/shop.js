export const SHOP = {
  name: 'Mamitas’ Kitchen',
  location: 'Singapore',
  currency: 'SGD',

  // Set gstRegistered to true only if the business is GST-registered.
  // Menu prices are treated as GST-inclusive. The rate is 9% since 1 January 2024 (IRAS).
  gstRegistered: false,
  gstRate: 0.09,
  gstRegNo: '',
};

export const ORDER_TYPES = [
  { id: 'dine_in', label: 'Dine in' },
  { id: 'takeaway', label: 'Takeaway' },
];

// Card and PayNow are only recorded. Nothing is charged by this system.
export const PAYMENT_METHODS = [
  { id: 'cash', label: 'Cash' },
  { id: 'paynow', label: 'PayNow' },
  { id: 'card', label: 'Card' },
];