import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import fp from 'fastify-plugin';
import { createLocalJWKSet, decodeProtectedHeader, errors, jwtVerify, type JSONWebKeySet, type JWTVerifyGetKey } from 'jose';
import { JWT_AUDIENCE, type Scope } from './constants.js';
import { ApiError } from './errors.js';

/** The public keys could not be fetched and none were kept: the token may be fine, so this is not a 401 (D-F1-14). */
export class KeysUnavailable extends Error {}

export interface RemoteKeysOptions {
  url: string;
  /** How long keys are used before they are fetched again. */
  maxAgeMs?: number;
  /** The shortest time between two attempts to fetch, so a failing fetch is not repeated on every request. */
  cooldownMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Called when a fetch of keys fails and the old keys are used instead. */
  onError?: (error: unknown) => void;
}

/**
 * The public keys of the Auth Service, kept in memory. After `maxAgeMs` they are fetched again, but a failed fetch keeps
 * the old keys in use (keys change only when the Auth Service rotates them, rarely), and a token with a key id that is
 * not known triggers one new fetch per cooldown (a rotation). jose's own `createRemoteJWKSet` throws when the fetch
 * after its cache time fails, which answered every valid token with 401 and ended people's sign-ins about 10 minutes
 * after a service started (D-F1-14).
 */
export function createRemoteKeys(options: RemoteKeysOptions): JWTVerifyGetKey {
  const { url, maxAgeMs = 10 * 60_000, cooldownMs = 30_000, timeoutMs = 5_000, fetchImpl = fetch, now = Date.now, onError = () => undefined } = options;
  let kept: { keys: JWTVerifyGetKey; at: number } | null = null;
  let lastTry = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<void> | null = null;

  async function load(): Promise<void> {
    lastTry = now();
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`the keys answered ${res.status}`);
      kept = { keys: createLocalJWKSet((await res.json()) as JSONWebKeySet), at: now() };
    } catch (err) {
      throw new KeysUnavailable(err instanceof Error ? err.message : 'the keys could not be fetched');
    }
  }
  const fetchKeys = (): Promise<void> => (inFlight ??= load().finally(() => (inFlight = null)));
  const mayTry = (): boolean => now() - lastTry >= cooldownMs;

  return async (header, token) => {
    if (!kept) await fetchKeys();
    else if (now() - kept.at >= maxAgeMs && mayTry()) await fetchKeys().catch(onError);
    try {
      return await (kept as { keys: JWTVerifyGetKey }).keys(header, token);
    } catch (err) {
      if (err instanceof errors.JWKSNoMatchingKey && mayTry()) {
        await fetchKeys().catch(onError);
        return (kept as { keys: JWTVerifyGetKey }).keys(header, token);
      }
      throw err;
    }
  };
}

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
    // The keys are cached, fetched again when they are old or a new key id shows up, and kept when a fetch fails.
    keys = createRemoteKeys({ url: options.jwksUrl });
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
      if (err instanceof KeysUnavailable) throw new ApiError(503, 'INTERNAL_ERROR', "Your sign-in couldn't be checked just now. Try again in a moment.");
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
