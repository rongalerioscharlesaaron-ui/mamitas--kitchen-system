import { shop } from '../config/shop.js';

// Money is calculated in whole cents, so totals never show rounding errors
export const toCents = (n) => Math.round(Number(n) * 100);
export const fromCents = (c) => c / 100;

// GST already inside a GST-inclusive total. Zero if the business is not registered.
export const gstIncluded = (totalCents) =>
  shop.gstRegistered ? Math.round((totalCents * shop.gstRate) / (1 + shop.gstRate)) : 0;