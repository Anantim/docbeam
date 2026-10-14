import { fileURLToPath } from 'node:url';
import { withDatabaseUrl } from '@docbeam/shared';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { z } from 'zod';
import { serviceClients } from './schema.js';
import { clientRows } from './service-clients.js';

// Runs this service's forward-only migrations (Launch plan), then upserts the four service clients
// from their secrets (D-G10). It logs in with the migration login (the RDS master user on AWS,
// postgres locally) and switches to the NOLOGIN owner role, so the owner role owns every object
// (D-G8, D-M0-2). MIGRATION_DATABASE_URL, or the same DB_* parts the services use (D-M1-10).
const env = z
  .object({
    MIGRATION_DATABASE_URL: z.string().url(),
    OWNER_ROLE: z.string().regex(/^[a-z_]+$/).default('auth_owner'),
  })
  .parse(migrationEnv(process.env));

function migrationEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (source.MIGRATION_DATABASE_URL) return source;
  const withUrl = withDatabaseUrl({
    ...source,
    DB_USER: source.MIGRATION_DB_USER,
    DB_PASSWORD: source.MIGRATION_DB_PASSWORD,
    DATABASE_URL: undefined,
  });
  return { ...source, MIGRATION_DATABASE_URL: withUrl.DATABASE_URL };
}

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));
const client = new pg.Client({ connectionString: env.MIGRATION_DATABASE_URL });
await client.connect();
try {
  await client.query(`SET ROLE ${env.OWNER_ROLE}`);
  const db = drizzle(client);
  await migrate(db, { migrationsFolder });
  for (const row of clientRows(process.env)) {
    await db
      .insert(serviceClients)
      .values(row)
      .onConflictDoUpdate({
        target: serviceClients.clientId,
        set: { clientSecretHash: row.clientSecretHash, scopes: row.scopes },
      });
  }
  console.log(JSON.stringify({ level: 'info', msg: 'migrations applied', service: 'auth', role: env.OWNER_ROLE }));
} finally {
  await client.end();
}
