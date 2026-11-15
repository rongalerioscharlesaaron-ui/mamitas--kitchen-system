import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { salesDashboard, inventoryDashboard } from '../services/dashboardService.js';

const router = Router();

router.get('/sales', requireAuth, requireRole('cashier', 'owner'), async (req, res) => {
  res.json(await salesDashboard());
});

router.get('/inventory', requireAuth, requireRole('kitchen', 'owner'), async (req, res) => {
  res.json(await inventoryDashboard());
});

export default router;