import { jwtAuth, registerErrorHandler } from '@docbeam/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { createPlatformClient, type PlatformClient } from './platform.js';
import { createJobQueue, type JobQueue } from './queue.js';
import { registerFileRoutes } from './routes/files.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerUploadRoutes } from './routes/uploads.js';
import { createObjectStore, type ObjectStore } from './s3.js';

/** Things the routes call out to. Tests pass their own; the server builds the real ones from the config. */
export interface Deps {
  store?: ObjectStore;
  platform?: PlatformClient;
  queue?: JobQueue;
}

export async function buildApp(config: Config, db: Db, deps: Deps = {}): Promise<FastifyInstance> {
  // S3 upload ids are long (often over 100 characters) and sit in the path of the multipart routes.
  const app = Fastify({ logger: { level: config.LOG_LEVEL }, routerOptions: { maxParamLength: 1024 } });
  registerErrorHandler(app);
  await app.register(jwtAuth, { issuer: config.JWT_ISSUER, jwksUrl: config.JWKS_URL });

  // The ALB and Docker Compose health checks call this. It does not touch the database,
  // so a database blip does not take every task out of the target group.
  app.get('/health', async () => ({ status: 'ok', service: 'docbeam-api' }));

  const store = deps.store ?? createObjectStore(config);
  const platform = deps.platform ?? createPlatformClient(config);
  const queue = deps.queue ?? createJobQueue(config);
  registerUploadRoutes(app, db, store);
  registerFileRoutes(app, db);
  registerJobRoutes(app, db, { platform, queue });

  // The service token is fetched now and renewed in the background, so no request waits for the Auth
  // Service (ADR-013). A failure here is logged, not fatal: the first request that needs a token asks again.
  if (!deps.platform) {
    app.addHook('onReady', async () => {
      await platform.start().catch((error: unknown) => app.log.warn({ err: error }, 'service token not fetched at startup'));
    });
    app.addHook('onClose', async () => platform.stop());
  }

  return app;
}
