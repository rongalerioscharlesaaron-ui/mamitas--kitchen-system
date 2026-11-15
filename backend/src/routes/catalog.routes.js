import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { listMenu, listCategories } from '../services/itemService.js';
import { shop } from '../config/shop.js';

export const menuRouter = Router();
export const categoriesRouter = Router();
export const shopRouter = Router();

// Any logged-in user: the cashier needs the menu to take orders
menuRouter.get('/', requireAuth, async (req, res) => {
  res.json({ items: await listMenu() });
});

categoriesRouter.get('/', requireAuth, async (req, res) => {
  res.json({ categories: await listCategories() });
});

// Shop name, currency, and the GST setting, so receipts and the server agree
shopRouter.get('/', requireAuth, (req, res) => {
  res.json({ shop });
});