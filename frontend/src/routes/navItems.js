import {
  LayoutDashboard, ShoppingCart, Receipt, Boxes, UtensilsCrossed, History, CalendarClock,
  TriangleAlert, FileText, ShieldCheck,
} from 'lucide-react';

export const NAV_GROUPS = [
  {
    title: 'Main',
    items: [
      { label: 'Dashboard', path: '/', icon: LayoutDashboard, end: true, roles: ['cashier', 'kitchen', 'owner'] },
    ],
  },
  {
    title: 'Point of Sale',
    items: [
      { label: 'New Order', path: '/orders', icon: ShoppingCart, end: true, roles: ['cashier', ] },
      { label: 'Order History', path: '/orders/history', icon: Receipt, roles: ['cashier', 'owner'] },
    ],
  },
  {
    title: 'Inventory',
    items: [
      { label: 'Inventory Stock', path: '/inventory', icon: Boxes, end: true, roles: ['kitchen', 'owner'] },
      { label: 'Menu', path: '/inventory/menu', icon: UtensilsCrossed, roles: ['kitchen', 'owner'] },
      { label: 'Stock Movement Logs', path: '/inventory/movements', icon: History, roles: ['kitchen', 'owner'] },
      { label: 'Expiration Monitoring', path: '/inventory/expiration', icon: CalendarClock, roles: ['kitchen', 'owner'] },
      { label: 'Damaged Goods', path: '/inventory/damaged', icon: TriangleAlert, roles: ['kitchen', 'owner'] },
    ],
  },
  {
    title: 'Administration',
    items: [
      { label: 'Reports', path: '/reports', icon: FileText, roles: ['owner'] },
      { label: 'Administration', path: '/admin', icon: ShieldCheck, roles: ['owner'] },
    ],
  },
];

export const ROLE_LABELS = {
  cashier: 'Cashier',
  kitchen: 'Kitchen Staff',
  owner: 'Owner',
};