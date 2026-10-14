import { S3Client } from '@aws-sdk/client-s3';
import multipart from '@fastify/multipart';
import { jwtAuth, registerErrorHandler } from '@docbeam/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { registerDocumentRoutes } from './routes/documents.js';
import { registerBrowseRoutes } from './routes/browse.js';
import { registerInternalRoutes } from './routes/internal.js';
import type { Db } from './db.js';

export async function buildApp(config: Config, db: Db): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });
  registerErrorHandler(app);
  await app.register(multipart);
  await app.register(jwtAuth, { issuer: config.JWT_ISSUER, jwksUrl: config.JWKS_URL });

  // The ALB and Docker Compose health checks call this. It does not touch the database,
  // so a database blip does not take every task out of the target group.
  app.get('/health', async () => ({ status: 'ok', service: 'platform' }));

  registerBrowseRoutes(app, db);
  registerInternalRoutes(app, db);
  const s3 = new S3Client({ region: config.AWS_REGION, endpoint: config.AWS_ENDPOINT_URL, forcePathStyle: Boolean(config.AWS_ENDPOINT_URL) });
  registerDocumentRoutes(app, db, s3, config.PLATFORM_FILES_BUCKET);
  app.addHook('onClose', async () => s3.destroy());

  return app;
}
