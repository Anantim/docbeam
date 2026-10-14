import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compose, env } from './helpers.js';

const url = (user: string, password: string, db: string) => `postgres://${user}:${password}@localhost:5432/${db}`;
let admin: pg.Client;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('postgres', env.POSTGRES_PASSWORD ?? '', 'postgres') });
  await admin.connect();
});
afterAll(() => admin.end());

describe('local Postgres (D-G8)', () => {
  it('has the three databases, each owned by its owner role', async () => {
    const { rows } = await admin.query(
      `SELECT datname, pg_get_userbyid(datdba) AS owner FROM pg_database
        WHERE datname IN ('auth_db','platform_db','docbeam_db') ORDER BY datname`,
    );
    expect(rows).toEqual([
      { datname: 'auth_db', owner: 'auth_owner' },
      { datname: 'docbeam_db', owner: 'docbeam_owner' },
      { datname: 'platform_db', owner: 'platform_owner' },
    ]);
  });

  it('has six roles: owners cannot log in, app roles can', async () => {
    const { rows } = await admin.query(
      `SELECT rolname, rolcanlogin, rolsuper, rolcreaterole, rolcreatedb FROM pg_roles
        WHERE rolname ~ '^(auth|platform|docbeam)_(owner|app)$' ORDER BY rolname`,
    );
    expect(rows.map((r) => [r.rolname, r.rolcanlogin])).toEqual([
      ['auth_app', true],
      ['auth_owner', false],
      ['docbeam_app', true],
      ['docbeam_owner', false],
      ['platform_app', true],
      ['platform_owner', false],
    ]);
    expect(rows.every((r) => !r.rolsuper && !r.rolcreaterole && !r.rolcreatedb)).toBe(true);
  });

  it('lets each app role into its own database only', async () => {
    const own = new pg.Client({ connectionString: url('auth_app', env.AUTH_APP_PASSWORD ?? '', 'auth_db') });
    await own.connect();
    await own.end();
    const other = new pg.Client({ connectionString: url('auth_app', env.AUTH_APP_PASSWORD ?? '', 'docbeam_db') });
    await expect(other.connect()).rejects.toThrow(/permission denied/);
  });

  it('does not let an app role create tables', async () => {
    const app = new pg.Client({ connectionString: url('docbeam_app', env.DOCBEAM_APP_PASSWORD ?? '', 'docbeam_db') });
    await app.connect();
    await expect(app.query('CREATE TABLE sneaky (id int)')).rejects.toThrow(/permission denied/);
    await app.end();
  });

  it('has citext and the migrations table owned by the owner role in each database', async () => {
    for (const name of ['auth', 'platform', 'docbeam']) {
      const db = new pg.Client({ connectionString: url('postgres', env.POSTGRES_PASSWORD ?? '', `${name}_db`) });
      await db.connect();
      const ext = await db.query(`SELECT 1 FROM pg_extension WHERE extname = 'citext'`);
      const table = await db.query(
        `SELECT tableowner FROM pg_tables WHERE schemaname = 'drizzle' AND tablename = '__drizzle_migrations'`,
      );
      await db.end();
      expect(ext.rowCount).toBe(1);
      expect(table.rows[0]?.tableowner).toBe(`${name}_owner`);
    }
  });

  it('can run the bootstrap again without errors', () => {
    const out = compose('exec', '-T', 'postgres', 'bash', '-c', 'PGUSER=postgres /bootstrap/bootstrap.sh');
    expect(out).toContain('"msg":"bootstrap finished"');
    expect(out).toContain('database docbeam_db docbeam_owner');
  });
});
