import {
  LayoutDashboard, ShoppingCart, Boxes, History, CalendarClock,
  TriangleAlert, UtensilsCrossed, FileText, ShieldCheck,
} from 'lucide-react';

export const NAV_GROUPS = [
  {
    title: 'Main',
    items: [
      { label: 'Dashboard', path: '/', icon: LayoutDashboard, end: true, roles: ['cashier', 'kitchen', 'owner'] },
    ],
  },
  {
    title: 'Point of sale',
    items: [
      { label: 'Orders', path: '/orders', icon: ShoppingCart, roles: ['cashier', 'owner'] },
    ],
  },
  {
    title: 'Inventory',
    items: [
      { label: 'Inventory Stock', path: '/inventory', icon: Boxes, end: true, roles: ['kitchen', 'owner'] },
      { label: 'Stock Movement Logs', path: '/inventory/movements', icon: History, roles: ['kitchen', 'owner'] },
      { label: 'Expiration Monitoring', path: '/inventory/expiration', icon: CalendarClock, roles: ['kitchen', 'owner'] },
      { label: 'Damaged Goods', path: '/inventory/damaged', icon: TriangleAlert, roles: ['kitchen', 'owner'] },
    ],
  },
  {
    title: 'Administration',
    items: [
      { label: 'Menu and Recipes', path: '/menu', icon: UtensilsCrossed, roles: ['owner'] },
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