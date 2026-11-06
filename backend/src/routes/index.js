import { Router } from 'express';
import health from './health.routes.js';

const router = Router();

router.use('/health', health);
// B4 adds /auth, B5 adds /items and /batches, B6 adds /orders

export default router;