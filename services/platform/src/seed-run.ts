import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createLogger, withDatabaseUrl } from '@docbeam/shared';
import { z } from 'zod';
import { createDb } from './db.js';
import { applySeed, seedFileSchema } from './seed.js';

// Deploy step, run after migrations in every environment and safe to re-run (Launch plan, Step 1.2).
// It asks the Auth Service for user ids with the seed-script service token (ADR-013).
const env = z
  .object({
    DATABASE_URL: z.string().url(),
    AUTH_URL: z.string().url(),
    CLIENT_SECRET_SEED_SCRIPT: z.string().min(1),
    /** Files in seed/, comma separated. Empty loads nothing: prod waits for the client's hierarchy (G18). */
    SEED_FILES: z.string().default('demo.json,dev-load.json'),
    /** Local and dev only: create the seed users through POST /auth/register. */
    SEED_CREATE_USERS: z.enum(['true', 'false']).default('false'),
    SEED_USER_PASSWORD: z.string().optional(),
  })
  .parse(withDatabaseUrl(process.env));

const log = createLogger('seed');

async function json(path: string, init: RequestInit): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${env.AUTH_URL}${path}`, init);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const post = (path: string, payload: unknown, token?: string) =>
  json(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(payload),
  });

const tokenReply = await post('/auth/token', {
  clientId: 'seed-script',
  clientSecret: env.CLIENT_SECRET_SEED_SCRIPT,
  scope: 'users:read',
});
if (tokenReply.status !== 200) throw new Error(`could not get a service token (${tokenReply.status})`);
const token = String(tokenReply.body?.accessToken);

const files = env.SEED_FILES.split(',')
  .map((f) => f.trim())
  .filter(Boolean);
const { db, pool } = createDb(env.DATABASE_URL);

try {
  for (const name of files) {
    const path = fileURLToPath(new URL(`../seed/${name}`, import.meta.url));
    const file = seedFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')));

    const ids = new Map<string, string>();
    for (const user of file.users) {
      if (env.SEED_CREATE_USERS === 'true') {
        if (!env.SEED_USER_PASSWORD) throw new Error('SEED_USER_PASSWORD is required with SEED_CREATE_USERS=true');
        // 201 created, 409 already there: both are fine.
        await post('/auth/register', { email: user.email, password: env.SEED_USER_PASSWORD, name: user.name });
      }
    }
    const emails = new Set([...file.users.map((u) => u.email), ...file.teams.flatMap((t) => t.members)]);
    for (const email of emails) {
      const found = await json(`/internal/users?email=${encodeURIComponent(email)}`, { headers: { authorization: `Bearer ${token}` } });
      if (found.status === 200) ids.set(email.toLowerCase(), String(found.body?.id));
      // Only a 404 means "no account". Any other answer stops the run, so a blip cannot prune memberships.
      else if (found.status !== 404) throw new Error(`user lookup failed (${found.status})`);
    }

    const report = await applySeed(db, file, ids);
    for (const email of report.skippedEmails) {
      log.warn('seed: no account for this email in this environment, skipped', { file: name, email });
    }
    log.info('seed applied', { file: name, ...report, skippedEmails: report.skippedEmails.length });
  }
} finally {
  await pool.end();
}
