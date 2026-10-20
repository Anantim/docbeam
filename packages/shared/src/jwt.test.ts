import Fastify from 'fastify';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerErrorHandler } from './errors.js';
import { createRemoteKeys, createTokenVerifier, jwtAuth } from './jwt.js';

const ISSUER = 'https://example.cloudfront.net/api';

let privateKey: CryptoKey;
let otherKey: CryptoKey;
let jwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair('RS256')).privateKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: 'key-1', alg: 'RS256', use: 'sig' };
});

interface SignOptions {
  claims?: Record<string, unknown>;
  issuer?: string;
  audience?: string;
  expiresIn?: string | number;
  kid?: string | null;
  key?: CryptoKey;
}

function sign(opts: SignOptions = {}): Promise<string> {
  const kid = opts.kid === undefined ? 'key-1' : opts.kid;
  const header = kid === null ? { alg: 'RS256' } : { alg: 'RS256', kid };
  return new SignJWT({ token_use: 'user', email: 'priya@example.com', name: 'Priya', ...opts.claims })
    .setProtectedHeader(header)
    .setSubject('11111111-1111-4111-8111-111111111111')
    .setIssuer(opts.issuer ?? ISSUER)
    .setAudience(opts.audience ?? 'docbeam')
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '15m')
    .sign(opts.key ?? privateKey);
}

function serviceToken(scope: string): Promise<string> {
  return sign({ claims: { token_use: 'service', scope, email: undefined, name: undefined } });
}

function verifier() {
  return createTokenVerifier({ issuer: ISSUER, keys: createLocalJWKSet({ keys: [jwk] }) });
}

describe('createTokenVerifier', () => {
  it('accepts a valid user token on a user route', async () => {
    const principal = await verifier()(await sign(), { use: 'user' });
    expect(principal).toMatchObject({
      tokenUse: 'user',
      userId: '11111111-1111-4111-8111-111111111111',
      email: 'priya@example.com',
      name: 'Priya',
    });
  });

  it('accepts a service token with the right scope', async () => {
    const principal = await verifier()(await serviceToken('documents:ingest'), {
      use: 'service',
      scope: 'documents:ingest',
    });
    expect(principal).toMatchObject({ tokenUse: 'service', scopes: ['documents:ingest'] });
  });

  it.each([
    ['wrong issuer', { issuer: 'https://evil.example.com/api' }],
    ['wrong audience', { audience: 'someone-else' }],
    ['expired', { expiresIn: Math.floor(Date.now() / 1000) - 60 }],
    ['no kid', { kid: null }],
    ['unknown kid', { kid: 'key-2' }],
  ] as [string, SignOptions][])('rejects a token with %s', async (_name, opts) => {
    const token = await sign(opts);
    await expect(verifier()(token, { use: 'user' })).rejects.toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
  });

  it('rejects a token signed with another key', async () => {
    await expect(verifier()(await sign({ key: otherKey }), { use: 'user' })).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects a user token on a service route', async () => {
    await expect(verifier()(await sign(), { use: 'service', scope: 'documents:ingest' })).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('rejects a service token on a user route', async () => {
    await expect(verifier()(await serviceToken('memberships:read'), { use: 'user' })).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('refuses a service token without the needed scope with 403', async () => {
    await expect(
      verifier()(await serviceToken('memberships:read'), { use: 'service', scope: 'documents:ingest' }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  it('rejects garbage', async () => {
    await expect(verifier()('not-a-jwt', { use: 'user' })).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('jwtAuth plugin', () => {
  async function app() {
    const server = Fastify();
    registerErrorHandler(server);
    await server.register(jwtAuth, { issuer: ISSUER, keys: createLocalJWKSet({ keys: [jwk] }) });
    server.get('/me', { preHandler: server.requireAuth({ use: 'user' }) }, async (request) => request.principal);
    server.get('/health', async () => ({ status: 'ok' }));
    return server;
  }

  it('lets a valid token through and sets the principal', async () => {
    const res = await (await app()).inject({ url: '/me', headers: { authorization: `Bearer ${await sign()}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ tokenUse: 'user', name: 'Priya' });
  });

  it('answers 401 in the error shape without a token', async () => {
    const res = await (await app()).inject({ url: '/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: 'Sign in again.' } });
  });

  it('leaves unguarded routes open', async () => {
    const res = await (await app()).inject({ url: '/health' });
    expect(res.statusCode).toBe(200);
  });
});

describe('createRemoteKeys: the public keys survive a failed fetch (D-F1-14)', () => {
  const url = 'https://example.cloudfront.net/api/.well-known/jwks.json';
  const keysAnswer = (...keys: JWK[]) => new Response(JSON.stringify({ keys }), { status: 200, headers: { 'content-type': 'application/json' } });

  function setup(answers: Array<() => Response | Promise<Response>>) {
    let clock = 1_000_000;
    let calls = 0;
    const errors: unknown[] = [];
    const fetchImpl = (async () => {
      const answer = answers[Math.min(calls, answers.length - 1)] as () => Response | Promise<Response>;
      calls += 1;
      return answer();
    }) as typeof fetch;
    const keys = createRemoteKeys({ url, fetchImpl, now: () => clock, onError: (e) => errors.push(e) });
    const verify = createTokenVerifier({ issuer: ISSUER, keys });
    return { verify, advance: (ms: number) => (clock += ms), calls: () => calls, errors };
  }

  it('keeps accepting a valid token after the cache time when the Auth Service cannot be reached', async () => {
    const t = setup([() => keysAnswer(jwk), () => Promise.reject(new TypeError('fetch failed'))]);
    await expect(t.verify(await sign(), { use: 'user' })).resolves.toMatchObject({ tokenUse: 'user' });
    t.advance(11 * 60_000); // past the 10 minutes: the keys are due again, and the fetch fails
    await expect(t.verify(await sign(), { use: 'user' })).resolves.toMatchObject({ tokenUse: 'user' });
    expect(t.calls()).toBe(2);
    expect(t.errors).toHaveLength(1);
  });

  it('does not try again for every request while the fetch keeps failing', async () => {
    const t = setup([() => keysAnswer(jwk), () => new Response('', { status: 502 })]);
    await t.verify(await sign(), { use: 'user' });
    t.advance(11 * 60_000);
    for (let i = 0; i < 5; i += 1) await t.verify(await sign(), { use: 'user' });
    expect(t.calls()).toBe(2); // one failed try inside the 30-second cooldown
    t.advance(31_000);
    await t.verify(await sign(), { use: 'user' });
    expect(t.calls()).toBe(3);
  });

  it('answers 503, not 401, when there are no keys at all and they cannot be fetched', async () => {
    const t = setup([() => Promise.reject(new TypeError('fetch failed'))]);
    await expect(t.verify(await sign(), { use: 'user' })).rejects.toMatchObject({ statusCode: 503 });
  });

  it('still answers 401 for a token that is wrong, with the keys in hand', async () => {
    const t = setup([() => keysAnswer(jwk)]);
    await expect(t.verify(await sign({ key: otherKey }), { use: 'user' })).rejects.toMatchObject({ statusCode: 401 });
    await expect(t.verify(await sign({ expiresIn: '-1m' }), { use: 'user' })).rejects.toMatchObject({ statusCode: 401 });
  });

  it('fetches again for a key id it does not know (a rotation), at most once per cooldown', async () => {
    const pair2 = await generateKeyPair('RS256');
    const jwk2 = { ...(await exportJWK(pair2.publicKey)), kid: 'key-3', alg: 'RS256', use: 'sig' };
    const t = setup([() => keysAnswer(jwk), () => keysAnswer(jwk, jwk2)]);
    await t.verify(await sign(), { use: 'user' });
    t.advance(31_000);
    await expect(t.verify(await sign({ kid: 'key-3', key: pair2.privateKey }), { use: 'user' })).resolves.toMatchObject({ tokenUse: 'user' });
    expect(t.calls()).toBe(2);
  });
});
