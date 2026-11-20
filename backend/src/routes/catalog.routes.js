import { Router } from 'express';
import { query } from '../config/db.js';
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
shopRouter.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT name, location, currency, gst_registered, gst_rate, gst_reg_no, expiry_warning_days
         FROM shop_settings
        WHERE id = 1`
    );
    if (rows[0]) {
      const r = rows[0];
      return res.json({
        shop: {
          ...shop,
          name: r.name,
          location: r.location,
          currency: r.currency,
          gstRegistered: r.gst_registered,
          gstRate: r.gst_rate,
          gstRegNo: r.gst_reg_no,
          expiryWarningDays: r.expiry_warning_days,
        },
      });
    }
  } catch {
    // Fallback to config/shop.js if migration 005 is not applied yet
  }
  res.json({ shop });
});