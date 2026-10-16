import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTH_URL, call, compose, env, eventually, PLATFORM_URL, serviceToken } from './helpers.js';

// A SIGTERM during a slow upload must not cut it (D-M2-17). A deploy or a scale-in sends exactly this.
const demo = JSON.parse(readFileSync(new URL('../../services/platform/seed/demo.json', import.meta.url), 'utf8'));
const cardio = demo.teams.find((t: { name: string }) => t.name === 'Cardio');
const binder = cardio.binders[0] as { id: string; folders: Array<{ id: string }> };

let db: pg.Client;
beforeAll(async () => {
  db = new pg.Client({ connectionString: `postgres://postgres:${env.POSTGRES_PASSWORD}@localhost:5432/platform_db` });
  await db.connect();
});
afterAll(() => db.end());

function startedAt(): { at: string; running: boolean } {
  const id = compose('ps', '-a', '-q', 'platform').trim();
  const out = execFileSync('docker', ['inspect', '-f', '{{.State.StartedAt}} {{.State.Running}}', id], { encoding: 'utf8' }).trim();
  const [at = '', running = ''] = out.split(' ');
  return { at, running: running === 'true' };
}

describe('platform draining', () => {
  it('finishes an upload that is running when it gets SIGTERM', async () => {
    const before = startedAt();
    const token = await serviceToken('delivery-worker', 'documents:ingest');
    const lookup = await serviceToken('seed-script', 'users:read');
    const userId: string = (await call(AUTH_URL, '/internal/users?email=priya.shah@example.com', { token: lookup })).body.id;

    const head = Buffer.from('%PDF-1.7\n');
    const rest = Buffer.from(`${randomUUID()}\n%%EOF\n`);
    const checksum = createHash('sha256').update(head).update(rest).digest('hex');
    const taskId = randomUUID();
    const boundary = `----drain${randomUUID()}`;
    const fields: Array<[string, string]> = [
      ['taskId', taskId],
      ['binderId', binder.id],
      ['folderId', (binder.folders[0] as { id: string }).id],
      ['name', 'drain.pdf'],
      ['contentType', 'application/pdf'],
      ['checksumSha256', checksum],
      ['onBehalfOf', userId],
    ];
    const prefix = fields
      .map(([n, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`)
      .join('');
    const slow = Readable.from(
      (async function* () {
        yield Buffer.from(`${prefix}--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="drain.pdf"\r\nContent-Type: application/pdf\r\n\r\n`);
        yield head;
        // The signal arrives while this pause is running.
        await new Promise((r) => setTimeout(r, 4_000));
        yield rest;
        yield Buffer.from(`\r\n--${boundary}--\r\n`);
      })(),
    );

    const request = fetch(`${PLATFORM_URL}/documents`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: Readable.toWeb(slow) as unknown as RequestInit['body'],
      duplex: 'half',
    } as RequestInit);

    try {
      await new Promise((r) => setTimeout(r, 1_000));
      compose('kill', '--signal', 'SIGTERM', 'platform');
      const res = await request;
      expect(res.status).toBe(201);
      const stored = await db.query('SELECT 1 FROM documents WHERE source_task_id = $1', [taskId]);
      expect(stored.rowCount).toBe(1);
    } finally {
      // The container exits when the drain is done, and the restart policy may bring it back by itself.
      // Wait for either, then make sure it runs. Starting earlier would find it still draining.
      await eventually(() => {
        const now = startedAt();
        return now.running === false || now.at !== before.at ? true : undefined;
      }, 60_000);
      compose('up', '-d', '--wait', 'platform');
    }
    await eventually(async () => (await fetch(`${PLATFORM_URL}/health`).catch(() => null))?.ok, 60_000);
  }, 120_000);
});
