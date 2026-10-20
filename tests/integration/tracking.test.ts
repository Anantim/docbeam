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
  options: { fileAgeHours?: number; firstCompletedHoursAgo?: number; completed?: boolean; sender?: { email: string; name: string }; sentHoursAgo?: number; id?: string } = {},
): Promise<{ jobId: string; taskIds: string[]; fileIds: string[] }> {
  const jobId = options.id ?? randomUUID();
  const done = options.firstCompletedHoursAgo !== undefined;
  const sender = options.sender ?? { email: priya, name: 'Priya Shah' };
  await db.query(
    `INSERT INTO jobs (id, submitted_by_user_id, submitted_by_name, task_count, idempotency_key, fanned_out_at, completed_at, first_completed_at, created_at)
     VALUES ($1, $2, $6, $3, $4, now(), $5, $5, now() - ($7::float * interval '1 hour'))`,
    [jobId, ids[sender.email], specs.length, randomUUID(), done ? new Date(Date.now() - (options.firstCompletedHoursAgo as number) * 3_600_000) : null, sender.name, options.sentHoursAgo ?? 0],
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
    expect(mine.body.items[0].jobId).toBe(job.jobId);
    expect(mine.body.items[0]).toMatchObject({ taskCount: 5, status: 'in_progress', submittedBy: { name: 'Priya Shah' }, fileCount: 5, destinationCount: 2 });
    const team = await get(priya, '/jobs?scope=team');
    expect(team.body.items.map((j: { jobId: string }) => j.jobId)).not.toContain(job.jobId);
  });

  it('lists mine, the ones shared with my teams, or both under scope=all (D-F1-9)', async () => {
    const ids = (r: { body: { items: Array<{ jobId: string }> } }) => r.body.items.map((j) => j.jobId);
    expect(ids(await get(priya, '/jobs?scope=all&limit=100'))).toContain(job.jobId);
    expect(ids(await get(raj, '/jobs?scope=all&limit=100'))).toContain(job.jobId);
    expect(ids(await get(raj, '/jobs?scope=mine&limit=100'))).not.toContain(job.jobId);
    expect(ids(await get(sam, '/jobs?scope=all&limit=100'))).not.toContain(job.jobId);
    expect((await get(priya, '/jobs?scope=nope')).status).toBe(400);
  });

  it('filters by status, from the deliveries the caller may see: the same job can be in progress for the sender and finished with errors for a team member', async () => {
    const ids = (r: { body: { items: Array<{ jobId: string }> } }) => r.body.items.map((j) => j.jobId);
    expect(ids(await get(priya, '/jobs?scope=mine&status=in_progress&limit=100'))).toContain(job.jobId);
    expect(ids(await get(priya, '/jobs?scope=mine&status=completed&limit=100'))).not.toContain(job.jobId);
    expect(ids(await get(raj, '/jobs?scope=team&status=completed_with_errors&limit=100'))).toContain(job.jobId);
    expect(ids(await get(raj, '/jobs?scope=all&status=in_progress&limit=100'))).not.toContain(job.jobId);
    const filtered = await get(raj, '/jobs?scope=team&status=completed_with_errors&limit=100');
    expect(filtered.body.items.every((j: { status: string }) => j.status === 'completed_with_errors')).toBe(true);
    const bad = await get(priya, '/jobs?status=sleeping');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('shows a Cardio member only the Cardio deliveries, with counts for those', async () => {
    const detail = await get(raj, `/jobs/${job.jobId}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ isSender: false, taskCount: 2, counts: { pending: 0, in_progress: 0, completed: 1, failed: 1 }, status: 'completed_with_errors' });
    expect(detail.body.retry).toBeUndefined();
    expect(detail.body.cancel).toBeUndefined();
    expect(detail.body.destinations).toEqual(['Cardio / Regulatory']); // Oncology is hidden from Raj

    const list = await get(raj, '/jobs?scope=team');
    const entry = list.body.items.find((j: { jobId: string }) => j.jobId === job.jobId);
    expect(entry).toMatchObject({ taskCount: 2, counts: { completed: 1, failed: 1 }, status: 'completed_with_errors', fileCount: 2, destinationCount: 1 }); // only what Raj may see
    const mine = await get(raj, '/jobs');
    expect(mine.body.items.map((j: { jobId: string }) => j.jobId)).not.toContain(job.jobId);

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
    expect(list.body.items.map((j: { jobId: string }) => j.jobId)).not.toContain(job.jobId);
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

describe('GET /jobs filters and the cursor (D-F1-21)', () => {
  const neuro = team('Neuro');
  let fromPriya: { jobId: string }; // Cardio and Oncology, 3 days ago, in progress
  let fromRaj: { jobId: string }; // Cardio, now, completed
  let old: { jobId: string }; // Oncology only, 10 days ago, completed
  const raj0 = { email: raj, name: 'Raj Mehta' };
  type Item = { jobId: string; submittedBy: { userId: string } };
  /** Every page of the answer, followed by its cursor: the database holds many jobs from other tests. */
  const list = async (email: string, query: string): Promise<Item[]> => {
    const out: Item[] = [];
    let cursor: string | null = null;
    do {
      const reply: { status: number; body: { items: Item[]; nextCursor: string | null } } = await get(email, `/jobs?scope=all&limit=100&${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      expect(reply.status).toBe(200);
      out.push(...reply.body.items);
      cursor = reply.body.nextCursor;
    } while (cursor);
    return out;
  };
  const idsOf = (items: Item[]) => items.map((j) => j.jobId);

  beforeAll(async () => {
    fromPriya = await insertJob([{ team: cardio, status: 'completed' }, { team: oncology, status: 'pending' }], { sentHoursAgo: 72 });
    fromRaj = await insertJob([{ team: cardio, status: 'completed' }], { sender: raj0 });
    old = await insertJob([{ team: oncology, status: 'completed' }], { sentHoursAgo: 240 });
  });

  it('sender=me narrows to what I sent; sender=<user id> to one person; someone outside my reach gives an empty list, not a leak', async () => {
    const mine = await list(raj, 'sender=me');
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((j) => j.submittedBy.userId === ids[raj])).toBe(true);
    expect(idsOf(mine)).toContain(fromRaj.jobId);
    expect(idsOf(mine)).not.toContain(fromPriya.jobId);
    const byPriya = await list(raj, `sender=${ids[priya]}`);
    expect(byPriya.every((j) => j.submittedBy.userId === ids[priya])).toBe(true);
    expect(idsOf(byPriya)).toContain(fromPriya.jobId); // Raj is in Cardio, so he sees Priya's Cardio deliveries
    expect(idsOf(byPriya)).not.toContain(old.jobId); // Oncology only: not Raj's to see, whoever sent it
    expect(await list(raj, `sender=${ids[sam]}`)).toEqual([]);
  });

  it('sentSince keeps what was sent at or after the date', async () => {
    const since = (hours: number) => `sentSince=${encodeURIComponent(new Date(Date.now() - hours * 3_600_000).toISOString())}`;
    expect(idsOf(await list(priya, since(24)))).not.toContain(fromPriya.jobId); // 3 days ago
    expect(idsOf(await list(priya, since(24)))).toContain(fromRaj.jobId); // now
    expect(idsOf(await list(priya, since(24 * 7)))).toContain(fromPriya.jobId);
    expect(idsOf(await list(priya, since(24 * 7)))).not.toContain(old.jobId); // 10 days ago
    expect(idsOf(await list(priya, since(24 * 30)))).toContain(old.jobId);
  });

  it('team keeps the distributions with a delivery to that team; a team that is not mine is 400', async () => {
    expect(idsOf(await list(priya, `team=${oncology.id}`))).toContain(old.jobId);
    expect(idsOf(await list(priya, `team=${oncology.id}`))).not.toContain(fromRaj.jobId); // Cardio only
    expect(idsOf(await list(priya, `team=${cardio.id}`))).toContain(fromRaj.jobId);
    const outside = await get(raj, `/jobs?scope=all&team=${oncology.id}`); // Raj is not in Oncology
    expect(outside.status).toBe(400);
    expect(outside.body.error.code).toBe('VALIDATION_ERROR');
    expect((await get(sam, `/jobs?scope=all&team=${cardio.id}`)).status).toBe(400);
    expect((await get(sam, `/jobs?scope=all&team=${neuro.id}`)).status).toBe(200);
    expect((await get(priya, '/jobs?scope=all&team=not-a-uuid')).status).toBe(400);
  });

  it('a bad value is 400 VALIDATION_ERROR: sender, sentSince, cursor', async () => {
    for (const bad of ['sender=someone', 'sentSince=yesterday', 'sentSince=2020', 'sentSince=2026-10-20T10:00','sentSince=1', 'sentSince=2026-10-20&sentSince=2026-10-21', 'cursor=abc', 'cursor=' + Buffer.from('["x","y"]').toString('base64url')]) {
      const reply = await get(priya, `/jobs?scope=all&${bad}`);
      expect([bad, reply.status]).toEqual([bad, 400]);
      expect(reply.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('filters combine with each other and with status', async () => {
    const week = `sentSince=${encodeURIComponent(new Date(Date.now() - 7 * 24 * 3_600_000).toISOString())}`;
    const both = await list(priya, `sender=me&${week}&team=${cardio.id}`);
    expect(idsOf(both)).toContain(fromPriya.jobId);
    expect(idsOf(both)).not.toContain(fromRaj.jobId); // not mine
    expect(idsOf(both)).not.toContain(old.jobId); // too old
    // For Priya the 3-day-old job is in progress (a delivery is pending), so status narrows it away and back.
    expect(idsOf(await list(priya, `sender=me&${week}&status=pending`))).not.toContain(fromPriya.jobId);
    expect(idsOf(await list(priya, `sender=me&${week}&status=in_progress`))).toContain(fromPriya.jobId);
    expect(idsOf(await list(priya, `sender=me&${week}&status=completed`))).not.toContain(fromPriya.jobId);
    // Raj sees only his Cardio delivery of it, which is completed.
    expect(idsOf(await list(raj, `sender=${ids[priya]}&${week}&status=completed`))).toContain(fromPriya.jobId);
  });

  it('pages with a cursor: every row once, newest first, nothing shifted by a job that arrives meanwhile, null at the end', async () => {
    const mineNow: { jobId: string }[] = [];
    for (let i = 0; i < 5; i += 1) mineNow.push(await insertJob([{ team: cardio, status: 'completed' }], { sentHoursAgo: (i + 1) / 600 })); // 6 seconds apart
    const window = `sentSince=${encodeURIComponent(new Date(Date.now() - 6 * 60_000).toISOString())}`;
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    let arrivals = 0;
    do {
      const url: string = `/jobs?scope=all&limit=2&${window}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const page: { status: number; body: { items: Item[]; nextCursor: string | null } } = await get(priya, url);
      expect(page.status).toBe(200);
      expect(page.body.items.length).toBeLessThanOrEqual(2);
      seen.push(...idsOf(page.body.items));
      cursor = page.body.nextCursor;
      pages += 1;
      if (pages === 1) {
        await insertJob([{ team: cardio, status: 'completed' }]); // a new distribution lands at the top after page 1
        arrivals += 1;
      }
    } while (cursor && pages < 50);
    expect(cursor).toBeNull();
    expect(pages).toBeGreaterThan(2); // more than one page of two
    expect(new Set(seen).size).toBe(seen.length); // none twice, although a new job arrived
    expect(arrivals).toBe(1);
    const positions = mineNow.map((j) => seen.indexOf(j.jobId));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b)); // newest first
    // A filtered page with a cursor stays inside the filter.
    const first = (await get(priya, `/jobs?scope=all&limit=1&sender=me&${window}`)).body;
    expect(first.nextCursor).toBeTruthy();
    const second = (await get(priya, `/jobs?scope=all&limit=1&sender=me&${window}&cursor=${encodeURIComponent(first.nextCursor)}`)).body;
    expect(second.items[0].submittedBy.userId).toBe(ids[priya]);
    expect(second.items[0].jobId).not.toBe(first.items[0].jobId);
  });

  it('only narrows: scope=mine and team still answer as before, and no filter shows a job the scope does not allow', async () => {
    expect(idsOf((await get(raj, '/jobs?scope=mine&limit=100')).body.items)).not.toContain(fromPriya.jobId);
    expect(idsOf(await list(sam, `sender=${ids[priya]}`))).toEqual([]); // Sam is in no team of Priya's
  });
});

describe('GET /jobs/running: the number behind the badge on the Status tab (D-F1-34)', () => {
  /** The rows under one status filter, every page. */
  const rowsWith = async (email: string, status: string): Promise<number> => {
    let n = 0;
    let cursor: string | null = null;
    do {
      const reply: { body: { items: unknown[]; nextCursor: string | null } } = await get(email, `/jobs?scope=all&limit=100&status=${status}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      n += reply.body.items.length;
      cursor = reply.body.nextCursor;
    } while (cursor);
    return n;
  };

  it('equals the rows under the Pending and In progress filters together, for the sender and for a team member', async () => {
    // Older running distributions beyond the first page of the list are the case the badge got wrong when it counted
    // only the rows it had loaded: put several below 25 newer finished ones.
    for (let i = 0; i < 2; i += 1) await insertJob([{ team: cardio, status: 'pending' }, { team: oncology, status: 'in_progress' }], { sentHoursAgo: 100 + i });
    await insertJob([{ team: oncology, status: 'in_progress' }], { sentHoursAgo: 101 }); // Oncology only: Raj cannot see it
    for (let i = 0; i < 25; i += 1) await insertJob([{ team: cardio, status: 'completed' }], { sentHoursAgo: i / 100 });
    for (const email of [priya, raj, sam]) {
      const badge = (await get(email, '/jobs/running')).body.running as number;
      const filters = (await rowsWith(email, 'pending')) + (await rowsWith(email, 'in_progress'));
      expect([email, badge]).toEqual([email, filters]);
    }
    expect((await get(priya, '/jobs/running')).body.running).toBeGreaterThanOrEqual(3);
  });

  it('counts a distribution that is finished for a team member but still running for the sender only for the sender', async () => {
    const mixed = await insertJob([{ team: cardio, status: 'completed' }, { team: oncology, status: 'in_progress' }], { sentHoursAgo: 0.001 });
    const before = { priya: (await get(priya, '/jobs/running')).body.running as number, raj: (await get(raj, '/jobs/running')).body.running as number };
    await db.query("UPDATE tasks SET status = 'completed' WHERE job_id = $1", [mixed.jobId]);
    expect((await get(priya, '/jobs/running')).body.running).toBe(before.priya - 1); // finished for the sender now
    expect((await get(raj, '/jobs/running')).body.running).toBe(before.raj); // Raj never saw it as running
  });

  it('answers 401 without a sign-in', async () => {
    expect((await call(DOCBEAM_URL, '/jobs/running')).status).toBe(401);
  });
});

describe('GET /jobs?idPrefix= finds a distribution by the 8 characters the list shows (D-F1-32)', () => {
  const prefixOf = (id: string) => id.slice(0, 8);
  const find = async (email: string, prefix: string) => (await get(email, `/jobs?scope=all&idPrefix=${prefix}`)).body as { items: Array<{ jobId: string }>; nextCursor: string | null };

  it('finds one I can see, by lower or upper case, and nothing else', async () => {
    const mine = await insertJob([{ team: cardio, status: 'completed' }]);
    const found = await find(priya, prefixOf(mine.jobId));
    expect(found.items.map((j) => j.jobId)).toEqual([mine.jobId]);
    expect((await find(priya, prefixOf(mine.jobId).toUpperCase())).items.map((j) => j.jobId)).toEqual([mine.jobId]);
    // A team member finds it too (it was sent to their team).
    expect((await find(raj, prefixOf(mine.jobId))).items.map((j) => j.jobId)).toEqual([mine.jobId]);
  });

  it('gives no match for a distribution the caller cannot see: the same empty answer as for an id that does not exist', async () => {
    const oncologyOnly = await insertJob([{ team: oncology, status: 'completed' }]);
    expect((await find(raj, prefixOf(oncologyOnly.jobId))).items).toEqual([]); // Raj is in Cardio only
    expect((await find(sam, prefixOf(oncologyOnly.jobId))).items).toEqual([]);
    expect((await find(priya, '00000000')).items.every((j) => j.jobId.startsWith('00000000'))).toBe(true); // nothing invented
    expect((await find(priya, prefixOf(randomUUID()))).items).toEqual([]);
  });

  it('returns every match when two distributions share the prefix, up to 5, newest first', async () => {
    const stem = prefixOf(randomUUID());
    const ids = [1, 2, 3, 4, 5, 6].map((n) => `${stem}-0000-4000-8000-00000000000${n}`);
    for (const [i, id] of ids.entries()) await insertJob([{ team: cardio, status: 'completed' }], { id, sentHoursAgo: 6 - i });
    const found = await find(priya, stem);
    expect(found.items).toHaveLength(5); // at most 5
    expect(found.items.map((j) => j.jobId)).toEqual([ids[5], ids[4], ids[3], ids[2], ids[1]]); // newest first (the 6th was sent last)
    // Two sharing a prefix, one visible to Raj and one not: Raj sees one.
    const stem2 = prefixOf(randomUUID());
    const shared = await insertJob([{ team: cardio, status: 'completed' }], { id: `${stem2}-0000-4000-8000-000000000001` });
    await insertJob([{ team: oncology, status: 'completed' }], { id: `${stem2}-0000-4000-8000-000000000002` });
    expect((await find(raj, stem2)).items.map((j) => j.jobId)).toEqual([shared.jobId]);
    expect((await find(priya, stem2)).items).toHaveLength(2);
  });

  it('uses the primary key index: a range on id, not a scan', async () => {
    const plan = await db.query(
      `EXPLAIN SELECT id FROM jobs WHERE id >= '3f1c2a9e-0000-0000-0000-000000000000'::uuid AND id <= '3f1c2a9e-ffff-ffff-ffff-ffffffffffff'::uuid`,
    );
    const text = plan.rows.map((r) => r['QUERY PLAN']).join('\n');
    expect(text).toMatch(/jobs_pkey/); // an index scan on the primary key (the table is small, so Postgres may still pick a scan: see below)
  });

  it('is 400 VALIDATION_ERROR for anything but 8 hex characters, and the access rules of scope hold', async () => {
    for (const bad of ['', 'abc', '3f1c2a9', '3f1c2a9e1', 'zzzzzzzz', '3f1c2a9e-84d5', `3f1c2a9e&idPrefix=3f1c2a9f`]) {
      const reply = await get(priya, `/jobs?scope=all&idPrefix=${bad}`);
      expect([bad, reply.status]).toEqual([bad, 400]);
      expect(reply.body.error.code).toBe('VALIDATION_ERROR');
    }
    const mine = await insertJob([{ team: cardio, status: 'completed' }]);
    expect((await get(raj, `/jobs?scope=mine&idPrefix=${prefixOf(mine.jobId)}`)).body.items).toEqual([]); // not Raj's own
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
    // The two cancelled deliveries are counted as cancelled, not as failed (D-M3-17).
    expect(detail.body).toMatchObject({ status: 'cancelled', taskCount: 4, counts: { completed: 2, failed: 0, cancelled: 2, pending: 0, in_progress: 0 } });
    const list = await get(priya, '/jobs?scope=mine&limit=50');
    expect(list.body.items.find((j: { jobId: string }) => j.jobId === job.jobId)).toMatchObject({ taskCount: 4, counts: { completed: 2, failed: 0, cancelled: 2 }, status: 'cancelled' });
    // The task filters follow: Failed holds real failures only, Cancelled holds the cancelled ones.
    const cancelledRows = await get(priya, `/jobs/${job.jobId}/tasks?status=cancelled`);
    expect(cancelledRows.body).toMatchObject({ total: 2 });
    expect(cancelledRows.body.tasks.map((t: { failureCode: string }) => t.failureCode)).toEqual(['CANCELLED', 'CANCELLED']);
    expect((await get(priya, `/jobs/${job.jobId}/tasks?status=failed`)).body).toMatchObject({ total: 0 });
    expect((await get(priya, `/jobs/${job.jobId}/tasks?status=completed`)).body).toMatchObject({ total: 2 });

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
