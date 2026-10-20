import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { GetQueueUrlCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { finishTask } from '../../packages/shared/src/task-outcome.js';
import { AUTH_URL, call, compose, deleteJobs, DOCBEAM_URL, env, eventually, PLATFORM_URL, PREFIX, s3, serviceToken, sqs } from './helpers.js';

// Delivery (Step 2.4) on the Compose stack: the Task Queue, the real platform and the real object store.
// Most tests insert the job and send the task message themselves, so they do not depend on the platform
// being up at submit time or on fan-out timing. The first test goes through POST /jobs and fan-out.
const demo = JSON.parse(readFileSync(new URL('../../services/platform/seed/demo.json', import.meta.url), 'utf8'));
const cardio = demo.teams.find((t: { name: string }) => t.name === 'Cardio');
const binder = cardio.binders[0] as { id: string; folders: Array<{ id: string }> };
const [folderA, folderB] = binder.folders as [{ id: string }, { id: string }];
const OBJECT_STORE = `${PREFIX}-object-store`;
const conn = (database: string) => `postgres://postgres:${env.POSTGRES_PASSWORD}@localhost:5432/${database}`;

let docbeam: pg.Pool;
let platform: pg.Client;
let token: string;
let priyaId: string;

beforeAll(async () => {
  docbeam = new pg.Pool({ connectionString: conn('docbeam_db'), max: 4 });
  platform = new pg.Client({ connectionString: conn('platform_db') });
  await platform.connect();
  const login = await call(AUTH_URL, '/auth/login', { json: { email: 'priya.shah@example.com', password: env.SEED_USER_PASSWORD } });
  token = login.body.accessToken;
  const lookup = await serviceToken('seed-script', 'users:read');
  priyaId = (await call(AUTH_URL, '/internal/users?email=priya.shah@example.com', { token: lookup })).body.id;
});
const madeJobs: string[] = [];
afterAll(async () => {
  await deleteJobs(docbeam, madeJobs);
  await docbeam.end();
  await platform.end();
});

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const pdf = (): Buffer => Buffer.from(`%PDF-1.7\n${randomUUID()}\n%%EOF\n`);

interface ReadyFile {
  fileId: string;
  sha256: string;
  key: string;
  data: Buffer;
}

/** A file uploaded through the API and confirmed clean by the Upload Events worker. */
async function readyFile(): Promise<ReadyFile> {
  const data = pdf();
  const created = await call(DOCBEAM_URL, '/uploads', {
    token,
    json: { files: [{ name: 'consent.pdf', sizeBytes: data.length, contentType: 'application/pdf', sha256: sha(data) }] },
  });
  const { fileId, post } = created.body.uploads[0];
  const form = new FormData();
  for (const [k, v] of Object.entries(post.fields as Record<string, string>)) form.append(k, v);
  form.append('file', new Blob([data]), 'upload.bin');
  await fetch(post.url, { method: 'POST', body: form });
  await eventually(async () => (await call(DOCBEAM_URL, `/files?ids=${fileId}`, { token })).body[0]?.scanStatus === 'clean' || undefined, 60_000);
  return { fileId, sha256: sha(data), key: `staging/${priyaId}/${fileId}`, data };
}

/** A job with one task per file, inserted directly. Returns the task ids in file order. */
async function insertJob(files: ReadyFile[], folder = folderA.id, status: 'pending' | 'in_progress' = 'pending'): Promise<{ jobId: string; taskIds: string[] }> {
  const jobId = randomUUID();
  madeJobs.push(jobId);
  await docbeam.query(
    `INSERT INTO jobs (id, submitted_by_user_id, submitted_by_name, task_count, idempotency_key, fanned_out_at) VALUES ($1, $2, 'Priya Shah', $3, $4, now())`,
    [jobId, priyaId, files.length, randomUUID()],
  );
  const taskIds: string[] = [];
  for (const f of files) {
    const id = randomUUID();
    taskIds.push(id);
    await docbeam.query('UPDATE files SET job_id = $2 WHERE id = $1', [f.fileId, jobId]);
    await docbeam.query(
      `INSERT INTO tasks (id, job_id, file_id, team_id, binder_id, folder_id, destination_path, status) VALUES ($1, $2, $3, $4, $5, $6, 'Cardio / Regulatory', $7)`,
      [id, jobId, f.fileId, cardio.id, binder.id, folder, status],
    );
  }
  return { jobId, taskIds };
}

async function sendTask(taskId: string): Promise<void> {
  const { QueueUrl = '' } = await sqs.send(new GetQueueUrlCommand({ QueueName: `${PREFIX}-task` }));
  await sqs.send(new SendMessageCommand({ QueueUrl, MessageBody: JSON.stringify({ taskId }) }));
}

async function task(id: string) {
  return (await docbeam.query('SELECT * FROM tasks WHERE id = $1', [id])).rows[0];
}

const finalTask = (id: string) => eventually(async () => {
  const t = await task(id);
  return t && (t.status === 'completed' || t.status === 'failed') ? t : undefined;
}, 60_000);

const documentsFor = async (taskId: string): Promise<number> =>
  Number((await platform.query('SELECT count(*) FROM documents WHERE source_task_id = $1', [taskId])).rows[0].count);

const auditCount = async (taskId: string): Promise<number> =>
  Number((await docbeam.query(`SELECT count(*) FROM audit_events WHERE task_id = $1 AND action LIKE 'task.%'`, [taskId])).rows[0].count);

describe('delivery', () => {
  it('submits, fans out and delivers every task end to end', async () => {
    const files = [await readyFile(), await readyFile()];
    const submitted = await call(DOCBEAM_URL, '/jobs', {
      token,
      headers: { 'idempotency-key': randomUUID() },
      json: {
        files: files.map((f) => ({ fileId: f.fileId, sha256: f.sha256 })),
        mappings: files.map((f) => ({
          fileId: f.fileId,
          destinations: [folderA, folderB].map((fo) => ({ binderId: binder.id, folderId: fo.id })),
        })),
      },
    });
    expect(submitted.status).toBe(201);
    const jobId: string = submitted.body.jobId;
    madeJobs.push(jobId);

    const done = await eventually(async () => {
      const job = (await docbeam.query('SELECT completed_at, first_completed_at FROM jobs WHERE id = $1', [jobId])).rows[0];
      return job.completed_at ? job : undefined;
    }, 90_000);
    expect(done.first_completed_at).not.toBeNull();

    const tasks = (await docbeam.query('SELECT id, status, platform_document_id FROM tasks WHERE job_id = $1', [jobId])).rows;
    expect(tasks).toHaveLength(4);
    for (const t of tasks) {
      expect(t.status).toBe('completed');
      expect(t.platform_document_id).not.toBeNull();
      expect(await documentsFor(t.id)).toBe(1);
    }
    const events = await docbeam.query(`SELECT count(*) FROM audit_events WHERE job_id = $1 AND action = 'task.completed'`, [jobId]);
    expect(Number(events.rows[0].count)).toBe(4);
  }, 120_000);

  it('stores one document and writes one audit event when the same message arrives twice', async () => {
    const [file, other] = [await readyFile(), await readyFile()];
    const { taskIds: [first] } = await insertJob([file]);
    await sendTask(first as string);
    await finalTask(first as string);
    await sendTask(first as string);
    // The second copy stops at the claim. Give it time to run, then look.
    await new Promise((r) => setTimeout(r, 3_000));
    expect((await task(first as string)).status).toBe('completed');
    expect(await documentsFor(first as string)).toBe(1);
    expect(await auditCount(first as string)).toBe(1);

    // Two copies at the same moment: still one document and one outcome.
    const { taskIds: [second] } = await insertJob([other]);
    await Promise.all([sendTask(second as string), sendTask(second as string)]);
    await finalTask(second as string);
    await new Promise((r) => setTimeout(r, 3_000));
    expect(await documentsFor(second as string)).toBe(1);
    expect(await auditCount(second as string)).toBe(1);
  }, 90_000);

  it('puts a task back to pending when the platform is down, and finishes it when it returns', async () => {
    const file = await readyFile();
    const { taskIds: [id] } = await insertJob([file]);
    compose('stop', 'platform');
    try {
      await sendTask(id as string);
      const pending = await eventually(async () => {
        const t = await task(id as string);
        return t.last_error && t.status === 'pending' ? t : undefined;
      }, 60_000);
      expect(pending.attempt_count).toBe(1);
      expect(pending.failure_code).toBeNull();
    } finally {
      compose('start', 'platform');
    }
    await eventually(async () => (await fetch(`${PLATFORM_URL}/health`).catch(() => null))?.ok, 60_000);
    // The first retry comes after the 30 second gap (ADR-005).
    const done = await finalTask(id as string);
    expect(done.status).toBe('completed');
    expect(done.attempt_count).toBeGreaterThanOrEqual(2);
  }, 180_000);

  it('closes the job exactly once when its last two tasks finish together', async () => {
    const files = [await readyFile(), await readyFile()];
    const { jobId, taskIds } = await insertJob(files, folderB.id, 'in_progress');
    const results = await Promise.all(
      taskIds.map((taskId) => finishTask(docbeam as never, { taskId, jobId, status: 'completed', documentId: randomUUID() })),
    );
    expect(results.filter((r) => r?.jobClosed)).toHaveLength(1);
    const job = (await docbeam.query('SELECT completed_at, first_completed_at FROM jobs WHERE id = $1', [jobId])).rows[0];
    expect(job.completed_at).not.toBeNull();
    expect(job.first_completed_at).not.toBeNull();
    // A second final write for the same task changes nothing.
    expect(await finishTask(docbeam as never, { taskId: taskIds[0] as string, jobId, status: 'failed', failureCode: 'CANCELLED' })).toBeNull();
    expect(await auditCount(taskIds[0] as string)).toBe(1);
  }, 60_000);

  it('fails FILE_NOT_UPLOADED when the staged file is gone', async () => {
    const file = await readyFile();
    await s3.send(new DeleteObjectCommand({ Bucket: OBJECT_STORE, Key: file.key }));
    const { taskIds: [id] } = await insertJob([file]);
    await sendTask(id as string);
    const t = await finalTask(id as string);
    expect(t.status).toBe('failed');
    expect(t.failure_code).toBe('FILE_NOT_UPLOADED');
    expect(t.failure_reason).toContain('consent.pdf');
    expect(await documentsFor(id as string)).toBe(0);
  }, 90_000);

  it('fails CHECKSUM_MISMATCH when the stored checksum is not the declared one', async () => {
    const file = await readyFile();
    await s3.send(
      new PutObjectCommand({ Bucket: OBJECT_STORE, Key: file.key, Body: pdf(), ContentType: 'application/pdf', ChecksumAlgorithm: 'SHA256' }),
    );
    const { taskIds: [id] } = await insertJob([file]);
    await sendTask(id as string);
    const t = await finalTask(id as string);
    expect(t.failure_code).toBe('CHECKSUM_MISMATCH');
  }, 90_000);

  it('fails CHECKSUM_MISMATCH when the platform recomputes a different SHA-256', async () => {
    const file = await readyFile();
    // No stored checksum, so only the platform can notice (local stores keep none, D-M2-15).
    await s3.send(new PutObjectCommand({ Bucket: OBJECT_STORE, Key: file.key, Body: pdf(), ContentType: 'application/pdf' }));
    const { taskIds: [id] } = await insertJob([file]);
    await sendTask(id as string);
    const t = await finalTask(id as string);
    expect(t.failure_code).toBe('CHECKSUM_MISMATCH');
    expect(await documentsFor(id as string)).toBe(0);
  }, 90_000);

  it('fails UNSUPPORTED_TYPE when the bytes are not a PDF', async () => {
    const file = await readyFile();
    await s3.send(new PutObjectCommand({ Bucket: OBJECT_STORE, Key: file.key, Body: Buffer.from('MZ not a pdf at all'), ContentType: 'application/pdf' }));
    const { taskIds: [id] } = await insertJob([file]);
    await sendTask(id as string);
    const t = await finalTask(id as string);
    expect(t.failure_code).toBe('UNSUPPORTED_TYPE');
  }, 90_000);

  it('deletes a dead connection after a push, and leaves an expired one alone', async () => {
    const file = await readyFile();
    const { jobId, taskIds: [id] } = await insertJob([file]);
    const dead = `dead-${randomUUID()}`;
    const expired = `expired-${randomUUID()}`;
    await docbeam.query(
      `INSERT INTO ws_connections (connection_id, user_id, job_id, team_ids, expires_at) VALUES
         ($1, $3, $4, '{}', now() + interval '1 hour'),
         ($2, $3, $4, '{}', now() - interval '1 minute')`,
      [dead, expired, priyaId, jobId],
    );
    await sendTask(id as string);
    await finalTask(id as string);
    await eventually(async () => {
      const rows = (await docbeam.query('SELECT connection_id FROM ws_connections WHERE job_id = $1', [jobId])).rows;
      return rows.length === 1 && rows[0].connection_id === expired ? true : undefined;
    }, 30_000);
  }, 90_000);
});
