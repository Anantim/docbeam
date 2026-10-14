import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db.js';

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);
const app = await buildApp(config, db);

const shutdown = async (signal: string): Promise<void> => {
  // close() stops new connections and waits for requests already running, so a long ingest finishes
  // (D-M2-17). ECS gives the task its stopTimeout for this; the target group drains for as long.
  app.log.info({ signal }, 'draining: no new requests, waiting for the ones running');
  // A connection that was busy when the signal came goes idle after its response and would otherwise stay
  // open for the keep-alive time (72 s). Close such connections as they go idle.
  const sweep = setInterval(() => app.server.closeIdleConnections(), 250);
  await app.close();
  clearInterval(sweep);
  app.log.info('drained');
  await pool.end();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.HOST, port: config.PORT });
