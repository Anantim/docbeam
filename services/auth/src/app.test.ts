import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db.js';

const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

describe('auth service', () => {
  it('answers GET /health with 200 and publishes its key', async () => {
    const config = loadConfig({
      LOG_LEVEL: 'error',
      DATABASE_URL: 'postgres://auth_app:unused@localhost:5432/auth_db',
      JWT_ISSUER: 'http://localhost:5173/api',
      JWKS_URL: 'http://localhost:3001/.well-known/jwks.json',
      JWT_PRIVATE_KEY: pem,
    });
    const { db, pool } = createDb(config.DATABASE_URL);
    const app = await buildApp(config, db);

    const health = await app.inject({ url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok', service: 'auth' });
    expect(config.PORT).toBe(3001);

    const jwks = await app.inject({ url: '/.well-known/jwks.json' });
    expect(jwks.json().keys).toHaveLength(1);
    expect(jwks.json().keys[0]).not.toHaveProperty('d');

    const openid = await app.inject({ url: '/.well-known/openid-configuration' });
    expect(openid.json()).toEqual({
      issuer: 'http://localhost:5173/api',
      jwks_uri: 'http://localhost:5173/api/.well-known/jwks.json',
    });

    const bad = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'x', password: 'short', name: '' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION_ERROR');

    await app.close();
    await pool.end();
  });
});
