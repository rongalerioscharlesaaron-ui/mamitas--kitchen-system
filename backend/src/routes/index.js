import { Router } from 'express';
import health from './health.routes.js';
import auth from './auth.routes.js';
import auditLog from './audit.routes.js';
import items from './items.routes.js';
import batches from './batches.routes.js';
import movements from './movements.routes.js';
import { menuRouter, categoriesRouter } from './catalog.routes.js';

const router = Router();

router.use('/health', health);
router.use('/auth', auth);
router.use('/audit-log', auditLog);
router.use('/menu', menuRouter);
router.use('/categories', categoriesRouter);
router.use('/items', items);
router.use('/batches', batches);
router.use('/movements', movements);
// B6 adds /orders and /dashboard

export default router;