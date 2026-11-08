import app from './app.js';
import { env } from './config/env.js';
import { pool, checkDatabase } from './config/db.js';

function explain(err) {
  // Node can wrap connection errors in an AggregateError
  const first = err.errors?.[0] ?? err;
  const code = err.code || first.code;

  if (code === '28P01' || code === '28000') {
    return `The database rejected the login for "${env.db.user}". Check DB_USER and DB_PASSWORD in backend/.env.`;
  }
  if (code === '3D000') {
    return `The database "${env.db.database}" does not exist. Create it first (Stage B1).`;
  }
  if (code === 'ECONNREFUSED') {
    return `PostgreSQL is not reachable at ${env.db.host}:${env.db.port}. Is the PostgreSQL service running, and is DB_PORT correct?`;
  }
  return first.message || String(err);
}

async function start() {
  try {
    const info = await checkDatabase();
    console.log(`Database connected: ${info.db_name} as ${info.db_user} (${info.timezone})`);
  } catch (err) {
    console.error('Cannot connect to the database.');
    console.error(explain(err));
    process.exit(1);
  }

  const server = app.listen(env.port, () => {
    console.log(`API running at http://localhost:${env.port}/api`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down...`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start();