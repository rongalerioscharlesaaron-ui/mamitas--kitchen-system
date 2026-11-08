import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { listMenu, listCategories } from '../services/itemService.js';

export const menuRouter = Router();
export const categoriesRouter = Router();

// Any logged-in user: the cashier needs the menu to take orders
menuRouter.get('/', requireAuth, async (req, res) => {
  res.json({ items: await listMenu() });
});

categoriesRouter.get('/', requireAuth, async (req, res) => {
  res.json({ categories: await listCategories() });
});