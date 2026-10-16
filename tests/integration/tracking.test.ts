import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { GetQueueUrlCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { finishTask } from '../../packages/shared/src/task-outcome.js';
import { AUTH_URL, call, DOCBEAM_URL, env, eventually, PREFIX, serviceToken, sqs } from './helpers.js';

// Step 3.1 on the Compose stack: job status, tasks, audit, cancel and retry, with team-scoped visibility.
// Jobs are inserted straight into DocBeam DB, so each test controls the exact task states.
//   Priya Shah: Cardio + Oncology. Raj Mehta: Cardio. Sam Ito: Neuro only.
const demo = JSON.parse(readFileSync(new URL('../../services/platform/seed/demo.json', import.meta.url), 'utf8'));
const team = (name: string) => demo.teams.find((t: { name: string }) => t.name === name) as { id: string; binders: Array<{ id: string }> };
const cardio = team('Cardio');
const oncology = team('Oncology');
const conn = `postgres://postgres:${env.POSTGRES_PASSWORD}@localhost:5432/docbeam_db`;

let db: pg.Pool;
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};

async function login(email: string): Promise<void> {
  const reply = await call(AUTH_URL, '/auth/login', { json: { email, password: env.SEED_USER_PASSWORD } });
  tokens[email] = reply.body.accessToken;
  const lookup = await serviceToken('seed-script', 'users:read');
  ids[email] = (await call(AUTH_URL, `/internal/users?email=${email}`, { token: lookup })).body.id;
}
const priya = 'priya.shah@example.com';
const raj = 'raj.mehta@example.com';
const sam = 'sam.ito@example.com';

beforeAll(async () => {
  db = new pg.Pool({ connectionString: conn, max: 4 });
  for (const email of [priya, raj, sam]) await login(email);
});
afterAll(async () => {
  await db.end();
});

interface TaskSpec {
  team: typeof cardio;
  status?: 'pending' | 'in_progress' | 'completed' | 'failed';
  code?: string;
  attempts?: number;
}

/** A job by Priya with one file per task. `fileAgeHours` and `firstCompletedHoursAgo` set the retry window. */
async function insertJob(
  specs: TaskSpec[],
  options: { fileAgeHours?: number; firstCompletedHoursAgo?: number; completed?: boolean } = {},
): Promise<{ jobId: string; taskIds: string[]; fileIds: string[] }> {
  const jobId = randomUUID();
  const done = options.firstCompletedHoursAgo !== undefined;
  await db.query(
    `INSERT INTO jobs (id, submitted_by_user_id, submitted_by_name, task_count, idempotency_key, fanned_out_at, completed_at, first_completed_at)
     VALUES ($1, $2, 'Priya Shah', $3, $4, now(), $5, $5)`,
    [jobId, ids[priya], specs.length, randomUUID(), done ? new Date(Date.now() - (options.firstCompletedHoursAgo as number) * 3_600_000) : null],
  );
  const taskIds: string[] = [];
  const fileIds: string[] = [];
  for (const [i, spec] of specs.entries()) {
    const fileId = randomUUID();
    const taskId = randomUUID();
    const created = new Date(Date.now() - (options.fileAgeHours ?? 1) * 3_600_000);
    await db.query(
      `INSERT INTO files (id, owner_user_id, job_id, original_name, size_bytes, content_type, checksum_sha256, s3_key, uploaded_at, scan_status, created_at)
       VALUES ($1, $2, $3, $4, 10, 'application/pdf', repeat('a', 64), $5, $6, 'clean', $6)`,
      [fileId, ids[priya], jobId, `file-${i}.pdf`, `staging/${ids[priya]}/${fileId}`, created],
    );
    const status = spec.status ?? 'pending';
    await db.query(
      `INSERT INTO tasks (id, job_id, file_id, team_id, binder_id, destination_path, status, failure_code, failure_reason, attempt_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [taskId, jobId, fileId, spec.team.id, spec.team.binders[0]?.id, spec.team === cardio ? 'Cardio / Regulatory' : 'Oncology / Imaging', status, spec.code ?? null, spec.code ? `file-${i}.pdf: ${spec.code}` : null, spec.attempts ?? 0],
    );
    taskIds.push(taskId);
    fileIds.push(fileId);
  }
  return { jobId, taskIds, fileIds };
}

const get = (email: string, path: string) => call(DOCBEAM_URL, path, { token: tokens[email] });
const post = (email: string, path: string) => call(DOCBEAM_URL, path, { token: tokens[email], method: 'POST' });
const taskRow = async (id: string) => (await db.query('SELECT status, failure_code, attempt_count FROM tasks WHERE id = $1', [id])).rows[0];

describe('GET /jobs, /jobs/:id and /jobs/:id/tasks', () => {
  let job: { jobId: string; taskIds: string[] };
  beforeAll(async () => {
    job = await insertJob([
      { team: cardio, status: 'completed' },
      { team: cardio, status: 'failed', code: 'RETRIES_EXHAUSTED', attempts: 5 },
      { team: oncology, status: 'in_progress' },
      { team: oncology, status: 'pending' },
      { team: oncology, status: 'completed' },
    ]);
  });

  it('gives the sender the whole job: counts, status, and what Retry and Cancel may do', async () => {
    const reply = await get(priya, `/jobs/${job.jobId}`);
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      jobId: job.jobId,
      isSender: true,
      submittedBy: { name: 'Priya Shah' },
      taskCount: 5,
      counts: { pending: 1, in_progress: 1, completed: 2, failed: 1 },
      status: 'in_progress',
      fileCount: 5,
      destinations: ['Cardio / Regulatory', 'Oncology / Imaging'],
      retry: { open: true, retryable: 1 },
      cancel: { open: true, waiting: 1 },
    });
  });

  it('lists the sender\'s jobs under mine, newest first, and not under team', async () => {
    const mine = await get(priya, '/jobs');
    expect(mine.body[0].jobId).toBe(job.jobId);
    expect(mine.body[0]).toMatchObject({ taskCount: 5, status: 'in_progress', submittedBy: { name: 'Priya Shah' } });
    const team = await get(priya, '/jobs?scope=team');
    expect(team.body.map((j: { jobId: string }) => j.jobId)).not.toContain(job.jobId);
  });

  it('shows a Cardio member only the Cardio deliveries, with counts for those', async () => {
    const detail = await get(raj, `/jobs/${job.jobId}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ isSender: false, taskCount: 2, counts: { pending: 0, in_progress: 0, completed: 1, failed: 1 }, status: 'completed_with_errors' });
    expect(detail.body.retry).toBeUndefined();
    expect(detail.body.cancel).toBeUndefined();
    expect(detail.body.destinations).toEqual(['Cardio / Regulatory']); // Oncology is hidden from Raj

    const list = await get(raj, '/jobs?scope=team');
    const entry = list.body.find((j: { jobId: string }) => j.jobId === job.jobId);
    expect(entry).toMatchObject({ taskCount: 2, counts: { completed: 1, failed: 1 }, status: 'completed_with_errors' });
    const mine = await get(raj, '/jobs');
    expect(mine.body.map((j: { jobId: string }) => j.jobId)).not.toContain(job.jobId);

    const tasks = await get(raj, `/jobs/${job.jobId}/tasks`);
    expect(tasks.body.total).toBe(2);
    expect(tasks.body.tasks.map((t: { destinationPath: string }) => t.destinationPath)).toEqual(['Cardio / Regulatory', 'Cardio / Regulatory']);
  });

  it('answers 404 to someone with no team in the job, the same as for a job that does not exist', async () => {
    const hidden = await get(sam, `/jobs/${job.jobId}`);
    const missing = await get(sam, `/jobs/${randomUUID()}`);
    expect(hidden.status).toBe(404);
    expect(hidden.body.error.code).toBe(missing.body.error.code);
    expect((await get(sam, `/jobs/${job.jobId}/tasks`)).status).toBe(404);
    const list = await get(sam, '/jobs?scope=team');
    expect(list.body.map((j: { jobId: string }) => j.jobId)).not.toContain(job.jobId);
    expect((await get(sam, '/jobs/not-a-uuid')).status).toBe(404);
  });

  it('returns tasks with reasons, filters by status and pages', async () => {
    const all = await get(priya, `/jobs/${job.jobId}/tasks`);
    expect(all.body).toMatchObject({ page: 1, limit: 100, total: 5 });
    const failed = await get(priya, `/jobs/${job.jobId}/tasks?status=failed`);
    expect(failed.body.total).toBe(1);
    expect(failed.body.tasks[0]).toMatchObject({ status: 'failed', failureCode: 'RETRIES_EXHAUSTED', attemptCount: 5, fileExpired: false });
    expect(failed.body.tasks[0].failureReason).toContain('RETRIES_EXHAUSTED');

    const first = await get(priya, `/jobs/${job.jobId}/tasks?limit=2&page=1`);
    const second = await get(priya, `/jobs/${job.jobId}/tasks?limit=2&page=2`);
    const names = [...first.body.tasks, ...second.body.tasks].map((t: { taskId: string }) => t.taskId);
    expect(first.body.tasks).toHaveLength(2);
    expect(new Set(names).size).toBe(4);
    expect((await get(priya, `/jobs/${job.jobId}/tasks?status=bogus`)).status).toBe(400);
  });

  it('marks a delivery whose staged file is past 33 days', async () => {
    const old = await insertJob([{ team: cardio, status: 'completed' }], { fileAgeHours: 34 * 24 });
    const tasks = await get(priya, `/jobs/${old.jobId}/tasks`);
    expect(tasks.body.tasks[0].fileExpired).toBe(true);
  });
});

describe('GET /audit is scoped to what the caller may see', () => {
  let jobId: string;
  const event = (action: string, teamId: string | null, extra: Record<string, unknown> = {}) =>
    db.query(
      `INSERT INTO audit_events (actor_id, action, job_id, team_id, detail) VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [action === 'job.submitted' ? ids[priya] : null, action, jobId, teamId, JSON.stringify({ actorName: 'Priya Shah', actorEmail: priya, marker: 'm', ...extra })],
    );

  beforeAll(async () => {
    ({ jobId } = await insertJob([{ team: cardio, status: 'completed' }, { team: oncology, status: 'completed' }]));
    await event('job.submitted', null, { taskCount: 2 });
    await event('task.completed', cardio.id, { fileName: 'file-0.pdf' });
    await event('task.completed', oncology.id, { fileName: 'file-1.pdf' });
    await event('download.issued', null, { fileName: 'file-0.pdf' }); // by the sender, no team
    await db.query(`INSERT INTO audit_events (actor_id, action, detail) VALUES (NULL, 'file.refused', $1::jsonb)`, [
      JSON.stringify({ ownerUserId: ids[priya], reason: 'MALWARE', marker: jobId }),
    ]);
  });

  const forJob = async (email: string) => (await get(email, `/audit?jobId=${jobId}&limit=200`)).body.events as Array<{ action: string; teamId: string | null; detail: Record<string, unknown> }>;

  it('shows the sender every event of the distribution', async () => {
    const events = await forJob(priya);
    expect(events.map((e) => e.action).sort()).toEqual(['download.issued', 'job.submitted', 'task.completed', 'task.completed']);
  });

  it('shows a Cardio member the job-wide event with only who, and the Cardio delivery', async () => {
    const events = await forJob(raj);
    expect(events.map((e) => e.action).sort()).toEqual(['job.submitted', 'task.completed']);
    const sent = events.find((e) => e.action === 'job.submitted');
    expect(sent?.detail).toEqual({ actorName: 'Priya Shah' });
    expect(events.find((e) => e.action === 'task.completed')?.teamId).toBe(cardio.id);
  });

  it('shows someone outside the distribution nothing', async () => {
    expect(await forJob(sam)).toEqual([]);
  });

  it('shows a refused file only to its owner, and filters by action', async () => {
    const mine = await get(priya, '/audit?action=file.refused&limit=200');
    expect(mine.body.events.some((e: { detail: { marker?: string } }) => e.detail.marker === jobId)).toBe(true);
    const others = await get(raj, '/audit?action=file.refused&limit=200');
    expect(others.body.events.some((e: { detail: { marker?: string } }) => e.detail.marker === jobId)).toBe(false);
    const both = await get(priya, `/audit?jobId=${jobId}&action=task.completed,job.submitted`);
    expect(both.body.events.map((e: { action: string }) => e.action).sort()).toEqual(['job.submitted', 'task.completed', 'task.completed']);
    expect((await get(priya, '/audit?action=nope')).status).toBe(400);
  });

  it('pages newest first', async () => {
    const first = await get(priya, `/audit?jobId=${jobId}&limit=2`);
    expect(first.body.events).toHaveLength(2);
    expect(first.body.hasMore).toBe(true);
    const second = await get(priya, `/audit?jobId=${jobId}&limit=2&page=2`);
    expect(second.body.hasMore).toBe(false);
    const times = [...first.body.events, ...second.body.events].map((e: { occurredAt: string }) => e.occurredAt);
    expect([...times].sort().reverse()).toEqual(times);
  });
});

describe('POST /jobs/:id/cancel while deliveries run', () => {
  it('fails only the waiting deliveries, lets the running one finish, and drops queued messages at the claim', async () => {
    const job = await insertJob([
      { team: cardio, status: 'in_progress', attempts: 1 },
      { team: cardio, status: 'pending' },
      { team: oncology, status: 'pending' },
      { team: oncology, status: 'completed' },
    ]);
    const [running, waitingA, waitingB, done] = job.taskIds as [string, string, string, string];

    // Only the sender may cancel. A team member can see the job but gets 403; an outsider gets 404.
    expect((await post(raj, `/jobs/${job.jobId}/cancel`)).body.error.code).toBe('NOT_SENDER');
    expect((await post(sam, `/jobs/${job.jobId}/cancel`)).status).toBe(404);

    const cancelled = await post(priya, `/jobs/${job.jobId}/cancel`);
    expect(cancelled.status).toBe(202);
    expect(cancelled.body).toEqual({ cancelled: 2 });

    expect(await taskRow(waitingA)).toMatchObject({ status: 'failed', failure_code: 'CANCELLED' });
    expect(await taskRow(waitingB)).toMatchObject({ status: 'failed', failure_code: 'CANCELLED' });
    expect(await taskRow(running)).toMatchObject({ status: 'in_progress' });
    expect(await taskRow(done)).toMatchObject({ status: 'completed' });

    // A delivery is still running, so the job is not closed and does not read cancelled yet.
    let detail = await get(priya, `/jobs/${job.jobId}`);
    expect(detail.body).toMatchObject({ status: 'in_progress', cancel: { open: false }, retry: { open: false, reason: 'JOB_CANCELLED' } });
    expect((await db.query('SELECT completed_at, cancelled_at FROM jobs WHERE id = $1', [job.jobId])).rows[0].completed_at).toBeNull();

    // The waiting deliveries' queued messages stop at the claim: nothing is attempted and nothing is stored.
    const url = (await sqs.send(new GetQueueUrlCommand({ QueueName: `${PREFIX}-task` }))).QueueUrl;
    for (const id of [waitingA, waitingB]) await sqs.send(new SendMessageCommand({ QueueUrl: url, MessageBody: JSON.stringify({ taskId: id }) }));
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    expect(await taskRow(waitingA)).toMatchObject({ status: 'failed', failure_code: 'CANCELLED', attempt_count: 0 });

    // The running delivery finishes. Its result is written, and now the job closes and reads cancelled.
    const finished = await finishTask(db as never, { taskId: running, jobId: job.jobId, status: 'completed', documentId: randomUUID() });
    expect(finished?.jobClosed).toBe(true);
    detail = await get(priya, `/jobs/${job.jobId}`);
    expect(detail.body).toMatchObject({ status: 'cancelled', counts: { completed: 2, failed: 2, pending: 0, in_progress: 0 } });

    // The audit trail has one event per cancelled delivery and one for the job.
    const audit = await get(priya, `/audit?jobId=${job.jobId}`);
    const actions = audit.body.events.map((e: { action: string }) => e.action);
    expect(actions.filter((a: string) => a === 'job.cancelled')).toHaveLength(1);
    expect(actions.filter((a: string) => a === 'task.failed')).toHaveLength(2);

    expect((await post(priya, `/jobs/${job.jobId}/cancel`)).body.error.code).toBe('NOTHING_TO_CANCEL');
    expect((await post(priya, `/jobs/${job.jobId}/retry`)).body.error.code).toBe('JOB_CANCELLED');
  });

  it('answers 409 NOTHING_TO_CANCEL when nothing is waiting, and changes nothing', async () => {
    const job = await insertJob([{ team: cardio, status: 'in_progress' }, { team: cardio, status: 'completed' }]);
    const reply = await post(priya, `/jobs/${job.jobId}/cancel`);
    expect(reply.status).toBe(409);
    expect(reply.body.error.code).toBe('NOTHING_TO_CANCEL');
    expect((await db.query('SELECT cancelled_at FROM jobs WHERE id = $1', [job.jobId])).rows[0].cancelled_at).toBeNull();
  });
});

describe('POST /jobs/:id/retry', () => {
  it('sets only RETRIES_EXHAUSTED and FANOUT_FAILED tasks back, writes the event, and runs them again', async () => {
    const job = await insertJob(
      [
        { team: cardio, status: 'failed', code: 'RETRIES_EXHAUSTED', attempts: 5 },
        { team: cardio, status: 'failed', code: 'FANOUT_FAILED' },
        { team: oncology, status: 'failed', code: 'CHECKSUM_MISMATCH', attempts: 1 },
        { team: oncology, status: 'completed' },
      ],
      { firstCompletedHoursAgo: 2 },
    );
    const [a, b, permanent, completed] = job.taskIds as [string, string, string, string];

    expect((await post(raj, `/jobs/${job.jobId}/retry`)).body.error.code).toBe('NOT_SENDER');
    expect((await post(sam, `/jobs/${job.jobId}/retry`)).status).toBe(404);

    const reply = await post(priya, `/jobs/${job.jobId}/retry`);
    expect(reply.status).toBe(202);
    expect(reply.body).toEqual({ retried: 2 });

    // Not retryable, so untouched.
    expect(await taskRow(permanent)).toMatchObject({ status: 'failed', failure_code: 'CHECKSUM_MISMATCH' });
    expect(await taskRow(completed)).toMatchObject({ status: 'completed' });

    const audit = await get(priya, `/audit?jobId=${job.jobId}&action=job.retried`);
    expect(audit.body.events).toHaveLength(1);
    expect(audit.body.events[0].detail).toMatchObject({ retried: 2, actorName: 'Priya Shah' });

    // The job message went to the Job Queue; fan-out and Delivery run the two tasks again. The files have no
    // stored object, so each ends FILE_NOT_UPLOADED, which proves it was attempted again from a clean count.
    for (const id of [a, b]) {
      await eventually(async () => (await taskRow(id)).failure_code === 'FILE_NOT_UPLOADED' || undefined, 60_000);
      expect((await taskRow(id)).attempt_count).toBe(1);
    }
  });

  it('is refused after 24 hours from the first finish', async () => {
    const job = await insertJob([{ team: cardio, status: 'failed', code: 'RETRIES_EXHAUSTED' }], { firstCompletedHoursAgo: 25 });
    const reply = await post(priya, `/jobs/${job.jobId}/retry`);
    expect(reply.status).toBe(409);
    expect(reply.body.error.code).toBe('RETRY_WINDOW_CLOSED');
    expect((await get(priya, `/jobs/${job.jobId}`)).body.retry).toMatchObject({ open: false, reason: 'RETRY_WINDOW_CLOSED' });
  });

  it('is refused when a file is 2 days old', async () => {
    const job = await insertJob([{ team: cardio, status: 'failed', code: 'RETRIES_EXHAUSTED' }], { firstCompletedHoursAgo: 1, fileAgeHours: 49 });
    expect((await post(priya, `/jobs/${job.jobId}/retry`)).body.error.code).toBe('RETRY_WINDOW_CLOSED');
  });

  it('is refused when no task qualifies', async () => {
    const job = await insertJob([{ team: cardio, status: 'failed', code: 'CHECKSUM_MISMATCH' }], { firstCompletedHoursAgo: 1 });
    const reply = await post(priya, `/jobs/${job.jobId}/retry`);
    expect(reply.status).toBe(409);
    expect(reply.body.error.code).toBe('NOTHING_TO_RETRY');
  });
});
