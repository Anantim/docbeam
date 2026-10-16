import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { GetQueueUrlCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { AUTH_URL, call, DOCBEAM_URL, env, eventually, PREFIX, serviceToken, sqs } from './helpers.js';

// Step 3.2 on the Compose stack: the WS Handlers behind ws-local, and the pushes that reach them.
//   Priya Shah: Cardio + Oncology. Raj Mehta: Cardio. Sam Ito: Neuro only.
const WS_URL = 'ws://localhost:3004';
const demo = JSON.parse(readFileSync(new URL('../../services/platform/seed/demo.json', import.meta.url), 'utf8'));
const team = (name: string) => demo.teams.find((t: { name: string }) => t.name === name) as { id: string; binders: Array<{ id: string }> };
const cardio = team('Cardio');
const oncology = team('Oncology');
const conn = `postgres://postgres:${env.POSTGRES_PASSWORD}@localhost:5432/docbeam_db`;

let db: pg.Pool;
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
const priya = 'priya.shah@example.com';
const raj = 'raj.mehta@example.com';
const sam = 'sam.ito@example.com';

beforeAll(async () => {
  db = new pg.Pool({ connectionString: conn, max: 4 });
  const lookup = await serviceToken('seed-script', 'users:read');
  for (const email of [priya, raj, sam]) {
    tokens[email] = (await call(AUTH_URL, '/auth/login', { json: { email, password: env.SEED_USER_PASSWORD } })).body.accessToken;
    ids[email] = (await call(AUTH_URL, `/internal/users?email=${email}`, { token: lookup })).body.id;
  }
});
afterAll(async () => {
  await db.end();
});

interface Client {
  socket: WebSocket;
  messages: Array<Record<string, unknown>>;
  /** Waits for a message that matches. */
  next(match: (m: Record<string, unknown>) => boolean, ms?: number): Promise<Record<string, unknown>>;
  subscribe(jobId: string): Promise<Record<string, unknown>>;
}

const open: WebSocket[] = [];
afterEach(() => {
  for (const s of open.splice(0)) s.close();
});

async function connect(token: string): Promise<Client> {
  const socket = new WebSocket(`${WS_URL}/?token=${encodeURIComponent(token)}`);
  open.push(socket);
  const messages: Array<Record<string, unknown>> = [];
  socket.on('message', (d) => messages.push(JSON.parse(d.toString())));
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
    socket.once('unexpected-response', (_req, res) => reject(new Error(`rejected ${res.statusCode}`)));
  });
  const next = (match: (m: Record<string, unknown>) => boolean, ms = 15_000) =>
    eventually(() => messages.find(match), ms);
  return {
    socket,
    messages,
    next,
    async subscribe(jobId) {
      socket.send(JSON.stringify({ action: 'subscribe', jobId }));
      return next((m) => (m.type === 'subscribed' || m.type === 'subscribe_error') && m.jobId === jobId);
    },
  };
}

async function insertJob(specs: Array<{ team: typeof cardio }>): Promise<{ jobId: string; taskIds: string[] }> {
  const jobId = randomUUID();
  await db.query(
    `INSERT INTO jobs (id, submitted_by_user_id, submitted_by_name, task_count, idempotency_key, fanned_out_at) VALUES ($1, $2, 'Priya Shah', $3, $4, now())`,
    [jobId, ids[priya], specs.length, randomUUID()],
  );
  const taskIds: string[] = [];
  for (const [i, spec] of specs.entries()) {
    const fileId = randomUUID();
    const taskId = randomUUID();
    await db.query(
      `INSERT INTO files (id, owner_user_id, job_id, original_name, size_bytes, content_type, checksum_sha256, s3_key, uploaded_at, scan_status)
       VALUES ($1, $2, $3, $4, 10, 'application/pdf', repeat('a', 64), $5, now(), 'clean')`,
      [fileId, ids[priya], jobId, `file-${i}.pdf`, `staging/${ids[priya]}/${fileId}`],
    );
    await db.query(
      `INSERT INTO tasks (id, job_id, file_id, team_id, binder_id, destination_path, status) VALUES ($1, $2, $3, $4, $5, 'Dest', 'pending')`,
      [taskId, jobId, fileId, spec.team.id, spec.team.binders[0]?.id],
    );
    taskIds.push(taskId);
  }
  return { jobId, taskIds };
}

const rowOf = async (connectionId: string) => (await db.query('SELECT * FROM ws_connections WHERE connection_id = $1', [connectionId])).rows[0];
const myRows = async (email: string) => (await db.query('SELECT * FROM ws_connections WHERE user_id = $1', [ids[email]])).rows;

describe('$connect and $disconnect', () => {
  it('refuses a connection with no token or a bad token', async () => {
    await expect(new Promise((resolve, reject) => {
      const s = new WebSocket(WS_URL);
      s.once('open', () => resolve('open'));
      s.once('unexpected-response', (_r, res) => reject(new Error(`rejected ${res.statusCode}`)));
      s.once('error', reject);
    })).rejects.toThrow('rejected 401');
    await expect(connect('not.a.token')).rejects.toThrow('rejected 401');
  });

  it('refuses a service token', async () => {
    const service = await serviceToken('docbeam-api', 'memberships:read');
    await expect(connect(service)).rejects.toThrow('rejected 401');
  });

  it('records the connection with the token\'s expiry and deletes it on disconnect', async () => {
    const before = (await myRows(sam)).length;
    const c = await connect(tokens[sam] as string);
    const rows = await eventually(async () => {
      const r = await myRows(sam);
      return r.length === before + 1 ? r : undefined;
    });
    const row = rows.find((r) => r.job_id === null && !rows.slice(0, before).includes(r)) ?? rows[rows.length - 1];
    expect(row.user_id).toBe(ids[sam]);
    const left = new Date(row.expires_at).getTime() - Date.now();
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThanOrEqual(15 * 60_000);
    c.socket.close();
    await eventually(async () => (await myRows(sam)).length === before || undefined);
  });
});

describe('subscribe', () => {
  it('lets the sender and a team member watch a job, and refuses an outsider', async () => {
    const { jobId } = await insertJob([{ team: cardio }]);
    const sender = await connect(tokens[priya] as string);
    const member = await connect(tokens[raj] as string);
    const outsider = await connect(tokens[sam] as string);

    expect(await sender.subscribe(jobId)).toMatchObject({ type: 'subscribed' });
    expect(await member.subscribe(jobId)).toMatchObject({ type: 'subscribed' });
    expect(await outsider.subscribe(jobId)).toEqual({ type: 'subscribe_error', jobId, code: 'NOT_FOUND' });

    const watching = await db.query('SELECT user_id, team_ids FROM ws_connections WHERE job_id = $1', [jobId]);
    expect(watching.rows).toHaveLength(2);
    const memberRow = watching.rows.find((r) => r.user_id === ids[raj]);
    expect(memberRow.team_ids).toEqual([cardio.id]);
    expect(watching.rows.find((r) => r.user_id === ids[priya]).team_ids).toEqual([]);
  });

  it('refuses a job that does not exist with the same answer, and a bad id', async () => {
    const c = await connect(tokens[priya] as string);
    const missing = randomUUID();
    expect(await c.subscribe(missing)).toEqual({ type: 'subscribe_error', jobId: missing, code: 'NOT_FOUND' });
    c.socket.send(JSON.stringify({ action: 'subscribe', jobId: 'nope' }));
    expect(await c.next((m) => m.type === 'subscribe_error' && m.code === 'VALIDATION_ERROR')).toBeTruthy();
  });

  it('moves a connection to a new job and stops watching the old one', async () => {
    const a = await insertJob([{ team: cardio }]);
    const b = await insertJob([{ team: cardio }]);
    const c = await connect(tokens[priya] as string);
    await c.subscribe(a.jobId);
    await c.subscribe(b.jobId);
    expect((await db.query('SELECT 1 FROM ws_connections WHERE job_id = $1', [a.jobId])).rowCount).toBe(0);
    expect((await db.query('SELECT 1 FROM ws_connections WHERE job_id = $1', [b.jobId])).rowCount).toBe(1);
  });
});

describe('pushes', () => {
  it('sends a task update to the sender and to the delivery\'s team only, with counts each may see', async () => {
    const job = await insertJob([{ team: cardio }, { team: oncology }]);
    const [cardioTask, oncologyTask] = job.taskIds as [string, string];
    const sender = await connect(tokens[priya] as string);
    const member = await connect(tokens[raj] as string);
    await sender.subscribe(job.jobId);
    await member.subscribe(job.jobId);

    // The files have no stored object, so Delivery fails each task with FILE_NOT_UPLOADED and pushes.
    const queue = (await sqs.send(new GetQueueUrlCommand({ QueueName: `${PREFIX}-task` }))).QueueUrl;
    const send = (taskId: string) => sqs.send(new SendMessageCommand({ QueueUrl: queue, MessageBody: JSON.stringify({ taskId }) }));

    await send(cardioTask);
    const forSender = await sender.next((m) => m.type === 'task_update' && m.taskId === cardioTask);
    const forMember = await member.next((m) => m.type === 'task_update' && m.taskId === cardioTask);
    expect(forSender).toMatchObject({ jobId: job.jobId, status: 'failed', failureCode: 'FILE_NOT_UPLOADED', counts: { pending: 1, failed: 1 } });
    expect(forMember).toMatchObject({ status: 'failed', counts: { pending: 0, failed: 1 } });
    expect(typeof forSender.updatedAt).toBe('string');

    // The Oncology delivery reaches Priya but never Raj, who is not in Oncology.
    await send(oncologyTask);
    await sender.next((m) => m.type === 'task_update' && m.taskId === oncologyTask);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(member.messages.some((m) => m.taskId === oncologyTask)).toBe(false);
  });

  it('sends one job update after a cancel, with the counts each viewer may see', async () => {
    const job = await insertJob([{ team: cardio }, { team: oncology }, { team: oncology }]);
    const sender = await connect(tokens[priya] as string);
    const member = await connect(tokens[raj] as string);
    await sender.subscribe(job.jobId);
    await member.subscribe(job.jobId);

    expect((await call(DOCBEAM_URL, `/jobs/${job.jobId}/cancel`, { method: 'POST', token: tokens[priya] })).status).toBe(202);

    const forSender = await sender.next((m) => m.type === 'job_update');
    const forMember = await member.next((m) => m.type === 'job_update');
    expect(forSender).toMatchObject({ jobId: job.jobId, counts: { pending: 0, failed: 3 } });
    expect(forMember).toMatchObject({ jobId: job.jobId, counts: { pending: 0, failed: 1 } });
    expect(sender.messages.filter((m) => m.type === 'job_update')).toHaveLength(1);
    expect(sender.messages.some((m) => m.type === 'task_update')).toBe(false);
  });

  it('deletes a connection row whose socket is gone (410)', async () => {
    const job = await insertJob([{ team: cardio }]);
    await db.query(
      `INSERT INTO ws_connections (connection_id, user_id, job_id, expires_at) VALUES ('ghost-connection', $1, $2, now() + interval '10 minutes')
       ON CONFLICT (connection_id) DO UPDATE SET job_id = EXCLUDED.job_id`,
      [ids[priya], job.jobId],
    );
    await call(DOCBEAM_URL, `/jobs/${job.jobId}/cancel`, { method: 'POST', token: tokens[priya] });
    await eventually(async () => (await rowOf('ghost-connection')) === undefined || undefined);
  });

  it('sends nothing to a connection whose token has expired', async () => {
    const job = await insertJob([{ team: cardio }]);
    await db.query(
      `INSERT INTO ws_connections (connection_id, user_id, job_id, expires_at) VALUES ('expired-connection', $1, $2, now() - interval '1 minute')
       ON CONFLICT (connection_id) DO UPDATE SET job_id = EXCLUDED.job_id, expires_at = EXCLUDED.expires_at`,
      [ids[priya], job.jobId],
    );
    await call(DOCBEAM_URL, `/jobs/${job.jobId}/cancel`, { method: 'POST', token: tokens[priya] });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    // It was skipped, not posted to, so it was not found to be gone either.
    expect(await rowOf('expired-connection')).toBeDefined();
    await db.query("DELETE FROM ws_connections WHERE connection_id = 'expired-connection'");
  });
});
