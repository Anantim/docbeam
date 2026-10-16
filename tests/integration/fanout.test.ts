import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { GetQueueUrlCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTH_URL, call, DOCBEAM_URL, env, eventually, logLines, PREFIX, sqs } from './helpers.js';

// Fan-out (Step 2.3): one message per pending task, safe to repeat.
const demo = JSON.parse(readFileSync(new URL('../../services/platform/seed/demo.json', import.meta.url), 'utf8'));
const regulatory = demo.teams.find((t: { name: string }) => t.name === 'Cardio').binders[0];

let db: pg.Client;
let token: string;

beforeAll(async () => {
  db = new pg.Client({ connectionString: `postgres://postgres:${env.POSTGRES_PASSWORD}@localhost:5432/docbeam_db` });
  await db.connect();
  const login = await call(AUTH_URL, '/auth/login', { json: { email: 'priya.shah@example.com', password: env.SEED_USER_PASSWORD } });
  token = login.body.accessToken;
});
afterAll(() => db.end());

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

async function readyFile(): Promise<{ fileId: string; sha256: string }> {
  const data = Buffer.from(`%PDF-1.7\n${randomUUID()}\n%%EOF\n`);
  const created = await call(DOCBEAM_URL, '/uploads', {
    token,
    json: { files: [{ name: 'a.pdf', sizeBytes: data.length, contentType: 'application/pdf', sha256: sha(data) }] },
  });
  const { fileId, post } = created.body.uploads[0];
  const form = new FormData();
  for (const [k, v] of Object.entries(post.fields as Record<string, string>)) form.append(k, v);
  form.append('file', new Blob([data]), 'upload.bin');
  await fetch(post.url, { method: 'POST', body: form });
  await eventually(async () => (await call(DOCBEAM_URL, `/files?ids=${fileId}`, { token })).body[0]?.scanStatus === 'clean' || undefined, 60_000);
  return { fileId, sha256: sha(data) };
}

describe('fan-out', () => {
  it('sends one task message per pending task, and again for a redelivered job message', async () => {
    const files = [await readyFile(), await readyFile()];
    const folders = regulatory.folders.slice(0, 2).map((f: { id: string }) => ({ binderId: regulatory.id, folderId: f.id }));
    const since = new Date(Date.now() - 1000);
    const submitted = await call(DOCBEAM_URL, '/jobs', {
      token,
      headers: { 'idempotency-key': randomUUID() },
      json: {
        files: files.map((f) => ({ fileId: f.fileId, sha256: f.sha256 })),
        mappings: files.map((f) => ({ fileId: f.fileId, destinations: folders })),
      },
    });
    expect(submitted.status).toBe(201);
    const jobId: string = submitted.body.jobId;
    expect(submitted.body.taskCount).toBe(4);

    // The message the API sent after the commit starts fan-out.
    const first = await eventually(
      () => logLines('workers', since).find((l) => l.name === 'fanout' && l.msg === 'job fanned out' && l.jobId === jobId),
    );
    expect(first.tasks).toBe(4);
    const job = (await db.query('SELECT fanned_out_at, queued_at FROM jobs WHERE id = $1', [jobId])).rows[0];
    expect(job.fanned_out_at).not.toBeNull();

    // SQS delivers at least once: the same job message again sends the pending tasks again, harmlessly.
    const { QueueUrl = '' } = await sqs.send(new GetQueueUrlCommand({ QueueName: `${PREFIX}-job` }));
    await sqs.send(new SendMessageCommand({ QueueUrl, MessageBody: JSON.stringify({ jobId }) }));
    await eventually(
      () => logLines('workers', since).filter((l) => l.name === 'fanout' && l.msg === 'job fanned out' && l.jobId === jobId).length >= 2 || undefined,
    );
  }, 90_000);
});
