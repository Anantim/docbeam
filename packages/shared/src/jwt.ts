import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import fp from 'fastify-plugin';
import { createRemoteJWKSet, decodeProtectedHeader, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { JWT_AUDIENCE, type Scope } from './constants.js';
import { ApiError } from './errors.js';

/** A user token: who someone is (ADR-015). */
export interface UserPrincipal {
  tokenUse: 'user';
  userId: string;
  email: string;
  name: string;
  expiresAt: number;
}

/** A service token: which internal client is calling, and what it may do (ADR-013). */
export interface ServicePrincipal {
  tokenUse: 'service';
  clientId: string;
  scopes: string[];
  expiresAt: number;
}

export type Principal = UserPrincipal | ServicePrincipal;

export interface VerifierOptions {
  /** The public API address, for example https://<cloudfront>/api (D-G5). */
  issuer: string;
  audience?: string;
  /** Where to fetch the public keys. Ignored when `keys` is given. */
  jwksUrl?: string;
  /** A key source, for tests. */
  keys?: JWTVerifyGetKey;
}

export type RouteAuth = { use: 'user' } | { use: 'service'; scope: Scope };

export type TokenVerifier = (token: string, rule: RouteAuth) => Promise<Principal>;

/**
 * Builds the one token check every service and the WS handlers use.
 * Checks the RS256 signature with a `kid`, `iss`, `aud`, `exp`, `token_use` and, for service tokens, the scope.
 * Throws ApiError 401 for a bad token and 403 for a missing scope.
 */
export function createTokenVerifier(options: VerifierOptions): TokenVerifier {
  const audience = options.audience ?? JWT_AUDIENCE;
  let keys = options.keys;
  if (!keys) {
    if (!options.jwksUrl) throw new Error('createTokenVerifier needs jwksUrl or keys');
    // jose caches the key set and refetches when it sees a new kid, so keys can rotate.
    keys = createRemoteJWKSet(new URL(options.jwksUrl), { cacheMaxAge: 10 * 60_000, cooldownDuration: 30_000 });
  }
  const getKey = keys;

  return async (token, rule) => {
    const unauthorized = new ApiError(401, 'UNAUTHORIZED', 'Sign in again.');
    let payload;
    try {
      const header = decodeProtectedHeader(token);
      if (!header.kid) throw unauthorized;
      ({ payload } = await jwtVerify(token, getKey, { issuer: options.issuer, audience, algorithms: ['RS256'] }));
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err instanceof errors.JOSEError || err instanceof TypeError || err instanceof SyntaxError) throw unauthorized;
      throw err;
    }

    const expiresAt = payload.exp;
    if (typeof payload.sub !== 'string' || typeof expiresAt !== 'number') throw unauthorized;
    if (payload.token_use !== rule.use) throw unauthorized;

    if (rule.use === 'user') {
      if (typeof payload.email !== 'string' || typeof payload.name !== 'string') throw unauthorized;
      return { tokenUse: 'user', userId: payload.sub, email: payload.email, name: payload.name, expiresAt };
    }

    const scopes = typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [];
    if (!scopes.includes(rule.scope)) throw new ApiError(403, 'FORBIDDEN', 'This client may not call this route.');
    return { tokenUse: 'service', clientId: payload.sub, scopes, expiresAt };
  };
}

declare module 'fastify' {
  interface FastifyInstance {
    /** A preHandler that requires a valid token of the given kind. */
    requireAuth(rule: RouteAuth): preHandlerAsyncHookHandler;
  }
  interface FastifyRequest {
    principal?: Principal;
  }
}

function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (!header) return undefined;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

/**
 * Fastify plugin. Each service registers it once, then guards routes with
 * `preHandler: app.requireAuth({ use: 'user' })` or `{ use: 'service', scope: '...' }`.
 * The gateway also checks tokens, but services check again because workers reach them without it.
 */
export const jwtAuth = fp<VerifierOptions>(
  async (app, options) => {
    const verify = createTokenVerifier(options);
    app.decorateRequest('principal', undefined);
    app.decorate('requireAuth', (rule: RouteAuth): preHandlerAsyncHookHandler => {
      return async (request: FastifyRequest, _reply: FastifyReply) => {
        const token = bearerToken(request);
        if (!token) throw new ApiError(401, 'UNAUTHORIZED', 'Sign in again.');
        request.principal = await verify(token, rule);
      };
    });
  },
  { name: '@docbeam/shared/jwt-auth', fastify: '5.x' },
);
