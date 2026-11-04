import { SHOP } from '../config/shop';

const formatter = new Intl.NumberFormat('en-SG', { style: 'currency', currency: SHOP.currency });

export const formatMoney = (n) => formatter.format(n);
export const toCents = (n) => Math.round(Number(n) * 100);
export const fromCents = (c) => c / 100;

// GST already inside a GST-inclusive total (in cents). Zero if not registered.
export const gstIncluded = (totalCents) =>
  SHOP.gstRegistered ? Math.round((totalCents * SHOP.gstRate) / (1 + SHOP.gstRate)) : 0;

// Keeps quantities like 0.25 kg tidy after repeated additions and subtractions.
export const round3 = (n) => Math.round(n * 1000) / 1000;