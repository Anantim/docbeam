import { randomUUID } from 'node:crypto';
import {
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { GetQueueUrlCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanup } from '../../workers/sweeper/src/index.js';
import { env, eventually, logLines, PREFIX, s3, sqs } from './helpers.js';

// DLQ Consumer and Sweeper (Step 2.5, ADR-014). Rows are inserted directly: these tests are about what
// happens to a message that ends in a DLQ, not about how it got there.
const BUCKET = `${PREFIX}-object-store`;
const OWNER = randomUUID();
const TEAM = randomUUID();
const BINDER = randomUUID();

let db: pg.Pool;
beforeAll(() => {
  db = new pg.Pool({ connectionString: `postgres://postgres:${env.POSTGRES_PASSWORD}@localhost:5432/docbeam_db`, max: 2 });
});
afterAll(() => db.end());

async function insertFile(options: { status?: string; ageHours?: number; jobId?: string | null; multipartUploadId?: string } = {}) {
  const id = randomUUID();
  const key = `staging/${OWNER}/${id}`;
  await db.query(
    `INSERT INTO files (id, owner_user_id, job_id, original_name, size_bytes, content_type, checksum_sha256, s3_key, multipart_upload_id, scan_status, created_at)
     VALUES ($1, $2, $3, 'consent.pdf', 10, 'application/pdf', $4, $5, $6, $7, now() - make_interval(hours => $8))`,
    [id, OWNER, options.jobId ?? null, 'a'.repeat(64), key, options.multipartUploadId ?? null, options.status ?? 'clean', options.ageHours ?? 0],
  );
  return { id, key };
}

/** A job that fan-out has already started, so the real sweeper leaves it alone unless asked. */
async function insertJob(taskStatuses: Array<'pending' | 'in_progress'>, options: { fannedOut?: boolean; queuedMinutesAgo?: number } = {}) {
  const jobId = randomUUID();
  await db.query(
    `INSERT INTO jobs (id, submitted_by_user_id, submitted_by_name, task_count, idempotency_key, queued_at, fanned_out_at)
     VALUES ($1, $2, 'Owner', $3, $4, now() - make_interval(mins => $5), CASE WHEN $6 THEN now() END)`,
    [jobId, OWNER, taskStatuses.length, randomUUID(), options.queuedMinutesAgo ?? 0, options.fannedOut ?? true],
  );
  const taskIds: string[] = [];
  for (const status of taskStatuses) {
    const file = await insertFile({ jobId });
    const id = randomUUID();
    taskIds.push(id);
    await db.query(
      `INSERT INTO tasks (id, job_id, file_id, team_id, binder_id, destination_path, status, last_error)
       VALUES ($1, $2, $3, $4, $5, 'Cardio / Regulatory', $6, 'The platform answered 503.')`,
      [id, jobId, file.id, TEAM, BINDER, status],
    );
  }
  return { jobId, taskIds };
}

async function sendTo(queue: string, body: unknown): Promise<void> {
  const { QueueUrl = '' } = await sqs.send(new GetQueueUrlCommand({ QueueName: `${PREFIX}-${queue}` }));
  await sqs.send(new SendMessageCommand({ QueueUrl, MessageBody: JSON.stringify(body) }));
}

const task = async (id: string) => (await db.query('SELECT * FROM tasks WHERE id = $1', [id])).rows[0];
const job = async (id: string) => (await db.query('SELECT * FROM jobs WHERE id = $1', [id])).rows[0];
const failedEvents = async (jobId: string) =>
  (await db.query(`SELECT * FROM audit_events WHERE job_id = $1 AND action = 'task.failed'`, [jobId])).rows;

describe('DLQ Consumer', () => {
  it('fails a task from the Task DLQ with RETRIES_EXHAUSTED and closes the job', async () => {
    const { jobId, taskIds: [id] } = await insertJob(['pending']);
    await sendTo('task-dlq', { taskId: id });

    const failed = await eventually(async () => {
      const t = await task(id as string);
      return t.status === 'failed' ? t : undefined;
    }, 30_000);
    expect(failed.failure_code).toBe('RETRIES_EXHAUSTED');
    expect(failed.failure_reason).toContain('consent.pdf to Cardio / Regulatory');
    expect(failed.failure_reason).toContain('The platform answered 503.');
    expect((await job(jobId)).completed_at).not.toBeNull();
    expect(await failedEvents(jobId)).toHaveLength(1);
  }, 60_000);

  it('fails the task of a crashed worker too (it was left in progress)', async () => {
    const { taskIds: [id] } = await insertJob(['in_progress']);
    await sendTo('task-dlq', { taskId: id });
    const failed = await eventually(async () => {
      const t = await task(id as string);
      return t.status === 'failed' ? t : undefined;
    }, 30_000);
    expect(failed.failure_code).toBe('RETRIES_EXHAUSTED');
  }, 60_000);

  it('never flips a task that already finished', async () => {
    const { jobId, taskIds: [id] } = await insertJob(['pending']);
    await db.query(`UPDATE tasks SET status = 'completed', platform_document_id = $2 WHERE id = $1`, [id, randomUUID()]);
    const since = new Date(Date.now() - 1000);
    await sendTo('task-dlq', { taskId: id });
    await eventually(() => logLines('workers', since).find((l) => l.msg === 'task dead letter: already final' && l.taskId === id), 30_000);
    expect((await task(id as string)).status).toBe('completed');
    expect(await failedEvents(jobId)).toHaveLength(0);
  }, 60_000);

  it('fails only the pending tasks from the Job DLQ and leaves the one in progress', async () => {
    const { jobId, taskIds } = await insertJob(['pending', 'pending', 'in_progress']);
    await sendTo('job-dlq', { jobId });

    await eventually(async () => (await task(taskIds[0] as string)).status === 'failed' || undefined, 30_000);
    const states = await Promise.all(taskIds.map(async (id) => (await task(id)).status));
    expect(states).toEqual(['failed', 'failed', 'in_progress']);
    expect((await task(taskIds[0] as string)).failure_code).toBe('FANOUT_FAILED');
    expect(await failedEvents(jobId)).toHaveLength(2);
    // One task is still running, so the job stays open.
    expect((await job(jobId)).completed_at).toBeNull();
  }, 60_000);

  it('closes the job when the Job DLQ fails its last open tasks', async () => {
    const { jobId, taskIds } = await insertJob(['pending', 'pending']);
    await sendTo('job-dlq', { jobId });
    await eventually(async () => (await job(jobId)).completed_at || undefined, 30_000);
    expect((await job(jobId)).first_completed_at).not.toBeNull();
    expect(await Promise.all(taskIds.map(async (id) => (await task(id)).failure_code))).toEqual(['FANOUT_FAILED', 'FANOUT_FAILED']);
  }, 60_000);

  it('marks a file failed from the Upload DLQ, and leaves a clean one alone', async () => {
    const pending = await insertFile({ status: 'pending' });
    const clean = await insertFile({ status: 'clean' });
    const event = (key: string) => ({
      Records: [{ eventName: 'ObjectCreated:Post', s3: { bucket: { name: BUCKET }, object: { key } } }],
    });
    await sendTo('upload-events-dlq', event(pending.key));
    await sendTo('upload-events-dlq', event(clean.key));

    await eventually(async () => {
      const r = (await db.query('SELECT scan_status FROM files WHERE id = $1', [pending.id])).rows[0];
      return r.scan_status === 'failed' || undefined;
    }, 30_000);
    // The second message was sent after the first, so give it the same time to be handled.
    await new Promise((r) => setTimeout(r, 2_000));
    expect((await db.query('SELECT scan_status FROM files WHERE id = $1', [clean.id])).rows[0].scan_status).toBe('clean');

    const refusals = async (fileId: string) =>
      (await db.query(`SELECT actor_id, detail FROM audit_events WHERE action = 'file.refused' AND detail->>'fileId' = $1`, [fileId])).rows;
    const written = await refusals(pending.id);
    expect(written).toHaveLength(1);
    expect(written[0].actor_id).toBeNull();
    expect(written[0].detail).toMatchObject({ reason: 'SCAN_FAILED', ownerUserId: OWNER, fileName: 'consent.pdf' });
    expect(await refusals(clean.id)).toHaveLength(0);

    // The same message again: the file is no longer pending, so nothing more is written.
    await sendTo('upload-events-dlq', event(pending.key));
    await new Promise((r) => setTimeout(r, 3_000));
    expect(await refusals(pending.id)).toHaveLength(1);
  }, 60_000);
});

describe('Sweeper', () => {
  it('sends the job message again for a job whose fan-out never started', async () => {
    const since = new Date(Date.now() - 1000);
    const { jobId } = await insertJob(['pending'], { fannedOut: false, queuedMinutesAgo: 3 });
    // The sweeper runs every minute here. Fan-out then sets fanned_out_at, which ends the re-sending.
    const sent = await eventually(
      () => logLines('workers', since).find((l) => l.name === 'sweeper' && l.msg === 'job messages sent again' && (l.jobs as string[]).includes(jobId)),
      90_000,
    );
    expect(sent).toBeTruthy();
    await eventually(async () => (await job(jobId)).fanned_out_at || undefined, 30_000);
  }, 150_000);

  it('leaves a job that is only a minute old', async () => {
    const { jobId } = await insertJob(['pending'], { fannedOut: false, queuedMinutesAgo: 0 });
    const since = new Date();
    await new Promise((r) => setTimeout(r, 1_000));
    // Not re-sent on this run: it is younger than two minutes. Fan-out has not run for it either.
    expect((await job(jobId)).fanned_out_at).toBeNull();
    expect(logLines('workers', since).some((l) => l.msg === 'job messages sent again' && (l.jobs as string[]).includes(jobId))).toBe(false);
    // Tidy up: a real sweeper run later would otherwise pick it up.
    await db.query('UPDATE jobs SET fanned_out_at = now() WHERE id = $1', [jobId]);
  });

  it('deletes unsubmitted files older than 24 hours with their objects, and aborts open multipart uploads', async () => {
    const old = await insertFile({ ageHours: 25 });
    const young = await insertFile({ ageHours: 1 });
    const claimedJob = await insertJob(['pending']);
    const claimed = await insertFile({ ageHours: 30, jobId: claimedJob.jobId });
    for (const f of [old, young, claimed]) await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: f.key, Body: 'x' }));

    const multipartKey = `staging/${OWNER}/${randomUUID()}`;
    const { UploadId = '' } = await s3.send(new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: multipartKey }));
    const multipart = randomUUID();
    await db.query(
      `INSERT INTO files (id, owner_user_id, original_name, size_bytes, content_type, checksum_sha256, s3_key, multipart_upload_id, created_at)
       VALUES ($1, $2, 'big.pdf', 200000000, 'application/pdf', $3, $4, $5, now() - interval '26 hours')`,
      [multipart, OWNER, 'b'.repeat(64), multipartKey, UploadId],
    );

    const result = await cleanup({
      db,
      sqs,
      s3,
      jobQueueUrl: '',
      bucket: BUCKET,
      log: { debug() {}, info() {}, warn() {}, error() {} },
    });
    expect(result.files).toBeGreaterThanOrEqual(2);

    const exists = async (key: string) =>
      s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })).then(() => true, () => false);
    const row = async (id: string) => (await db.query('SELECT 1 FROM files WHERE id = $1', [id])).rowCount;
    expect(await row(old.id)).toBe(0);
    expect(await exists(old.key)).toBe(false);
    expect(await row(young.id)).toBe(1);
    expect(await exists(young.key)).toBe(true);
    // A file claimed by a job is never deleted, however old.
    expect(await row(claimed.id)).toBe(1);
    expect(await exists(claimed.key)).toBe(true);

    expect(await row(multipart)).toBe(0);
    const open = await s3.send(new ListMultipartUploadsCommand({ Bucket: BUCKET, Prefix: multipartKey }));
    expect(open.Uploads ?? []).toHaveLength(0);
  }, 60_000);

  it('deletes connection rows past their token expiry and keeps the others (D-M3-9)', async () => {
    const stale = `stale-${randomUUID()}`;
    const live = `live-${randomUUID()}`;
    await db.query(
      `INSERT INTO ws_connections (connection_id, user_id, expires_at) VALUES
         ($1, $3, now() - interval '1 minute'), ($2, $3, now() + interval '10 minutes')`,
      [stale, live, OWNER],
    );
    const result = await cleanup({ db, sqs, s3, jobQueueUrl: '', bucket: BUCKET, log: { debug() {}, info() {}, warn() {}, error() {} } });
    expect(result.connections).toBeGreaterThanOrEqual(1);
    const rows = async (id: string) => (await db.query('SELECT 1 FROM ws_connections WHERE connection_id = $1', [id])).rowCount;
    expect(await rows(stale)).toBe(0);
    expect(await rows(live)).toBe(1);
    await db.query('DELETE FROM ws_connections WHERE connection_id = $1', [live]);
  });
});
