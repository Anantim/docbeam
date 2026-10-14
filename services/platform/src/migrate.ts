import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { z } from 'zod';

// Runs this service's forward-only migrations (Launch plan). It logs in with the migration login
// (the RDS master user on AWS, postgres locally) and switches to the NOLOGIN owner role,
// so the owner role owns every object (D-G8, D-M0-2).
const env = z
  .object({
    MIGRATION_DATABASE_URL: z.string().url(),
    OWNER_ROLE: z.string().regex(/^[a-z_]+$/).default('platform_owner'),
  })
  .parse(process.env);

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));
const client = new pg.Client({ connectionString: env.MIGRATION_DATABASE_URL });
await client.connect();
try {
  await client.query(`SET ROLE ${env.OWNER_ROLE}`);
  await migrate(drizzle(client), { migrationsFolder });
  console.log(JSON.stringify({ level: 'info', msg: 'migrations applied', service: 'platform', role: env.OWNER_ROLE }));
} finally {
  await client.end();
}
