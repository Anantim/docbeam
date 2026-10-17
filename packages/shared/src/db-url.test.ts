import { describe, expect, it } from 'vitest';
import { withDatabaseUrl, withMigrationUrl } from './db-url.js';

describe('withDatabaseUrl', () => {
  it('keeps DATABASE_URL when it is set', () => {
    expect(withDatabaseUrl({ DATABASE_URL: 'postgres://a:b@h/d' }).DATABASE_URL).toBe('postgres://a:b@h/d');
  });

  const parts = { DB_HOST: 'db.example', DB_NAME: 'auth_db', DB_USER: 'auth_app', DB_PASSWORD: 'p@ss/w:rd', DB_CA_FILE: '/repo/certs/rds-ca-bundle.pem' };

  it('builds the URL from the parts, encodes the password and checks the certificate chain', () => {
    const env = withDatabaseUrl(parts);
    expect(env.DATABASE_URL).toBe(
      'postgres://auth_app:p%40ss%2Fw%3Ard@db.example:5432/auth_db?sslmode=verify-full&sslrootcert=%2Frepo%2Fcerts%2Frds-ca-bundle.pem',
    );
  });

  it('never skips the certificate check', () => {
    expect(withDatabaseUrl(parts).DATABASE_URL).not.toContain('no-verify');
  });

  it('refuses to build a URL from parts when DB_CA_FILE is missing', () => {
    const { DB_CA_FILE: _ignored, ...withoutCa } = parts;
    expect(() => withDatabaseUrl(withoutCa)).toThrow(/DB_CA_FILE/);
  });

  it('leaves the env alone when parts are missing', () => {
    expect(withDatabaseUrl({ DB_HOST: 'db.example' }).DATABASE_URL).toBeUndefined();
  });
});

describe('withMigrationUrl', () => {
  it('builds the migration URL from the master user', () => {
    const env = withMigrationUrl({ DB_HOST: 'db.example', DB_NAME: 'auth_db', DB_CA_FILE: '/ca.pem', MIGRATION_DB_USER: 'docbeam_admin', MIGRATION_DB_PASSWORD: 'pw' });
    expect(env.MIGRATION_DATABASE_URL).toBe('postgres://docbeam_admin:pw@db.example:5432/auth_db?sslmode=verify-full&sslrootcert=%2Fca.pem');
  });

  it('keeps MIGRATION_DATABASE_URL when it is set', () => {
    expect(withMigrationUrl({ MIGRATION_DATABASE_URL: 'postgres://a:b@h/d' }).MIGRATION_DATABASE_URL).toBe('postgres://a:b@h/d');
  });
});
