import { describe, expect, it } from 'vitest';
import { withDatabaseUrl, withMigrationUrl } from './db-url.js';

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

describe('withMigrationUrl', () => {
  it('builds the migration URL from the master user', () => {
    const env = withMigrationUrl({ DB_HOST: 'db.example', DB_NAME: 'auth_db', MIGRATION_DB_USER: 'docbeam_admin', MIGRATION_DB_PASSWORD: 'pw' });
    expect(env.MIGRATION_DATABASE_URL).toBe('postgres://docbeam_admin:pw@db.example:5432/auth_db?sslmode=no-verify');
  });

  it('keeps MIGRATION_DATABASE_URL when it is set', () => {
    expect(withMigrationUrl({ MIGRATION_DATABASE_URL: 'postgres://a:b@h/d' }).MIGRATION_DATABASE_URL).toBe('postgres://a:b@h/d');
  });
});
