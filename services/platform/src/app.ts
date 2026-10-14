import { jwtAuth, registerErrorHandler } from '@docbeam/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { registerBrowseRoutes } from './routes/browse.js';
import { registerInternalRoutes } from './routes/internal.js';
import type { Db } from './db.js';

export async function buildApp(config: Config, db: Db): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });
  registerErrorHandler(app);
  await app.register(jwtAuth, { issuer: config.JWT_ISSUER, jwksUrl: config.JWKS_URL });

  // The ALB and Docker Compose health checks call this. It does not touch the database,
  // so a database blip does not take every task out of the target group.
  app.get('/health', async () => ({ status: 'ok', service: 'platform' }));

  registerBrowseRoutes(app, db);
  registerInternalRoutes(app, db);

  return app;
}
