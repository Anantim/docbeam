import cookie from '@fastify/cookie';
import { acceptEmptyBodies, jwtAuth, registerErrorHandler } from '@docbeam/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { loadSigningKey } from './keys.js';
import { registerAccountRoutes } from './routes/accounts.js';
import { registerInternalRoutes, registerWellKnownRoutes } from './routes/internal.js';
import { createTokenIssuer } from './tokens.js';

export async function buildApp(config: Config, db: Db): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });
  registerErrorHandler(app);
  acceptEmptyBodies(app);
  await app.register(cookie);
  await app.register(jwtAuth, { issuer: config.JWT_ISSUER, jwksUrl: config.JWKS_URL });

  const key = await loadSigningKey(config.JWT_PRIVATE_KEY);
  const issuer = createTokenIssuer(key, config.JWT_ISSUER);

  // The ALB and Docker Compose health checks call this. It does not touch the database,
  // so a database blip does not take every task out of the target group.
  app.get('/health', async () => ({ status: 'ok', service: 'auth' }));

  registerWellKnownRoutes(app, key, config.JWT_ISSUER);
  registerAccountRoutes(app, db, issuer);
  registerInternalRoutes(app, db, issuer);

  return app;
}
