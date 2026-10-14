import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db.js';

describe('auth service', () => {
  it('answers GET /health with 200', async () => {
    const config = loadConfig({
      LOG_LEVEL: 'error',
      DATABASE_URL: 'postgres://auth_app:unused@localhost:5432/auth_db',
      JWT_ISSUER: 'http://localhost:5173/api',
      JWKS_URL: 'http://localhost:3001/.well-known/jwks.json',
    });
    const { db, pool } = createDb(config.DATABASE_URL);
    const app = await buildApp(config, db);
    const res = await app.inject({ url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', service: 'auth' });
    expect(config.PORT).toBe(3001);
    await app.close();
    await pool.end();
  });
});
