import { createHash, timingSafeEqual } from 'node:crypto';
import { ApiError } from '@docbeam/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db.js';
import type { SigningKey } from '../keys.js';
import { serviceClients, users } from '../schema.js';
import { ACCESS_TOKEN_SECONDS, type TokenIssuer } from '../tokens.js';

const tokenBody = z.object({ clientId: z.string().min(1).max(100), clientSecret: z.string().min(1).max(500), scope: z.string().min(1).max(500) });

/** Client secrets are long random values, so SHA-256 is enough and adds no delay (Step 1.1). */
export function hashClientSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

const UNKNOWN_CLIENT_HASH = hashClientSecret('no-such-client');

export function registerWellKnownRoutes(app: FastifyInstance, key: SigningKey, issuer: string): void {
  app.get('/.well-known/jwks.json', async () => ({ keys: [key.publicJwk] }));
  app.get('/.well-known/openid-configuration', async () => ({
    issuer,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
  }));
}

export function registerInternalRoutes(app: FastifyInstance, db: Db, issuer: TokenIssuer): void {
  // Internal only: the gateway does not list this route (ADR-001).
  app.post('/auth/token', async (request, reply) => {
    const parsed = tokenBody.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'clientId, clientSecret and scope are required.');
    const { clientId, clientSecret, scope } = parsed.data;

    const [client] = await db.select().from(serviceClients).where(eq(serviceClients.clientId, clientId));
    const matches = sameHash(client?.clientSecretHash ?? UNKNOWN_CLIENT_HASH, hashClientSecret(clientSecret));
    if (!client || !matches) throw new ApiError(401, 'UNAUTHORIZED', 'Client or secret is incorrect.');

    const wanted = scope.split(' ').filter(Boolean);
    if (wanted.length === 0 || !wanted.every((s) => client.scopes.includes(s))) {
      throw new ApiError(403, 'FORBIDDEN', 'This client may not ask for that scope.');
    }
    const accessToken = await issuer.service(client.clientId, wanted);
    return reply.header('Cache-Control', 'no-store').send({ accessToken, expiresIn: ACCESS_TOKEN_SECONDS });
  });

  app.get(
    '/internal/users',
    { preHandler: app.requireAuth({ use: 'service', scope: 'users:read' }) },
    async (request) => {
      const parsed = z.object({ email: z.string().min(1).max(254) }).safeParse(request.query);
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'email is required.');
      const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, parsed.data.email));
      if (!user) throw new ApiError(404, 'NOT_FOUND', 'Not found.');
      return { id: user.id };
    },
  );
}
