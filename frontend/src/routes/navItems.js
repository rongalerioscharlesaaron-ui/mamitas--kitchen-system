export const NAV_ITEMS = [
  { label: 'Home', path: '/', roles: ['cashier', 'kitchen', 'owner'] },
  { label: 'Orders', path: '/orders', roles: ['cashier', 'owner'] },
  { label: 'Inventory', path: '/inventory', roles: ['kitchen', 'owner'] },
  { label: 'Menu', path: '/menu', roles: ['owner'] },
  { label: 'Reports', path: '/reports', roles: ['owner'] },
  { label: 'Admin', path: '/admin', roles: ['owner'] },
];

export const ROLE_LABELS = {
  cashier: 'Cashier',
  kitchen: 'Kitchen Staff',
  owner: 'Owner',
};