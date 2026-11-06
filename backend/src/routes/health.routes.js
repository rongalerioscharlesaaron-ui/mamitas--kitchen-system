import { Router } from 'express';
import { checkDatabase, query } from '../config/db.js';
import { env } from '../config/env.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'mamitas-kitchen-api', time: new Date().toISOString() });
});

router.get('/db', async (req, res) => {
  try {
    const info = await checkDatabase();
    const body = { status: 'ok', database: 'connected', serverTime: info.server_time };

    // Extra detail for development only
    if (!env.isProduction) {
      const { rows } = await query('SELECT COUNT(*) AS items FROM items');
      Object.assign(body, {
        dbUser: info.db_user,
        dbName: info.db_name,
        timezone: info.timezone,
        items: rows[0].items,
      });
    }
    res.json(body);
  } catch (err) {
    console.error('Health check failed:', err.message);
    res.status(503).json({ status: 'error', database: 'unreachable' });
  }
});

export default router;