import { withDatabaseUrl } from '@docbeam/shared';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { users } from './schema.js';

// Support script: ends a sign-in pause early (ADR-015, Step 1.1).
//   node dist/unlock-user.js someone@example.com
const email = process.argv[2];
const url = withDatabaseUrl(process.env).DATABASE_URL;
if (!email || !url) {
  console.error('usage: DATABASE_URL=... node dist/unlock-user.js <email>');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const updated = await drizzle(pool)
    .update(users)
    .set({ failedLogins: 0, lockedUntil: null })
    .where(eq(users.email, email))
    .returning({ id: users.id });
  console.log(updated.length === 1 ? `Unlocked ${email}` : `No account for ${email}`);
} finally {
  await pool.end();
}
