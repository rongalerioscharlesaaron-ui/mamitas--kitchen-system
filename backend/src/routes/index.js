import { Router } from 'express';
import health from './health.routes.js';
import auth from './auth.routes.js';
import auditLog from './audit.routes.js';

const router = Router();

router.use('/health', health);
router.use('/auth', auth);
router.use('/audit-log', auditLog);
// B5 adds /items and /batches, B6 adds /orders

export default router;