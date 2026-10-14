import { generateKeyPairSync } from 'node:crypto';
import { createLocalJWKSet } from 'jose';
import { createTokenVerifier } from '@docbeam/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadSigningKey, type SigningKey } from './keys.js';
import { createTokenIssuer, type TokenIssuer } from './tokens.js';

const ISSUER = 'https://example.cloudfront.net/api';
let key: SigningKey;
let issuer: TokenIssuer;
let otherIssuer: TokenIssuer;

beforeAll(async () => {
  const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  key = await loadSigningKey(pem);
  issuer = createTokenIssuer(key, ISSUER);
  const other = await loadSigningKey(
    generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
  );
  otherIssuer = createTokenIssuer(other, ISSUER);
});

const verifier = () => createTokenVerifier({ issuer: ISSUER, keys: createLocalJWKSet({ keys: [key.publicJwk] }) });

describe('issuing and checking tokens', () => {
  it('a user token passes the user check and carries the name', async () => {
    const token = await issuer.user({ id: 'u1', email: 'priya.shah@example.com', name: 'Priya Shah' });
    const principal = await verifier()(token, { use: 'user' });
    expect(principal).toMatchObject({ tokenUse: 'user', userId: 'u1', email: 'priya.shah@example.com', name: 'Priya Shah' });
  });

  it('a service token passes the service check with its scope', async () => {
    const token = await issuer.service('docbeam-api', ['memberships:read']);
    const principal = await verifier()(token, { use: 'service', scope: 'memberships:read' });
    expect(principal).toMatchObject({ tokenUse: 'service', clientId: 'docbeam-api' });
  });

  it('a service token cannot call a user route, and a user token cannot call a service route', async () => {
    const service = await issuer.service('docbeam-api', ['memberships:read']);
    const user = await issuer.user({ id: 'u1', email: 'a@example.com', name: 'A' });
    await expect(verifier()(service, { use: 'user' })).rejects.toMatchObject({ statusCode: 401 });
    await expect(verifier()(user, { use: 'service', scope: 'memberships:read' })).rejects.toMatchObject({ statusCode: 401 });
  });

  it('refuses a token signed by another key', async () => {
    const token = await otherIssuer.user({ id: 'u1', email: 'a@example.com', name: 'A' });
    await expect(verifier()(token, { use: 'user' })).rejects.toMatchObject({ statusCode: 401 });
  });

  it('refuses a wrong issuer', async () => {
    const token = await issuer.user({ id: 'u1', email: 'a@example.com', name: 'A' });
    const wrong = createTokenVerifier({ issuer: 'https://evil.example/api', keys: createLocalJWKSet({ keys: [key.publicJwk] }) });
    await expect(wrong(token, { use: 'user' })).rejects.toMatchObject({ statusCode: 401 });
  });

  it('the key id is a stable thumbprint', async () => {
    expect(key.kid).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(key.publicJwk).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig', kid: key.kid });
    expect(key.publicJwk).not.toHaveProperty('d');
  });
});
