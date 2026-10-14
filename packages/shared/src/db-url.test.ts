import { describe, expect, it } from 'vitest';
import { withDatabaseUrl } from './db-url.js';

describe('withDatabaseUrl', () => {
  it('keeps DATABASE_URL when it is set', () => {
    expect(withDatabaseUrl({ DATABASE_URL: 'postgres://a:b@h/d' }).DATABASE_URL).toBe('postgres://a:b@h/d');
  });

  it('builds the URL from the parts and encodes the password', () => {
    const env = withDatabaseUrl({ DB_HOST: 'db.example', DB_NAME: 'auth_db', DB_USER: 'auth_app', DB_PASSWORD: 'p@ss/w:rd' });
    expect(env.DATABASE_URL).toBe('postgres://auth_app:p%40ss%2Fw%3Ard@db.example:5432/auth_db?sslmode=no-verify');
  });

  it('leaves the env alone when parts are missing', () => {
    expect(withDatabaseUrl({ DB_HOST: 'db.example' }).DATABASE_URL).toBeUndefined();
  });
});
