import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTH_URL, call, compose, DOCBEAM_URL, env, eventually, PLATFORM_URL } from './helpers.js';

// POST /jobs (Step 2.2): every check, the single transaction, repeat-safe by Idempotency-Key.
const demo = JSON.parse(readFileSync(new URL('../../services/platform/seed/demo.json', import.meta.url), 'utf8'));
const cardio = demo.teams.find((t: { name: string }) => t.name === 'Cardio');
const regulatory = cardio.binders[0];
const irb = regulatory.folders[0];
const amendments = regulatory.folders[1];
const neuro = demo.teams.find((t: { name: string }) => t.name === 'Neuro').binders[0];
const neuroBinder: string = neuro.id;
const neuroFolder: string = neuro.folders[0].id;

let db: pg.Client;
let priya: { id: string; token: string };

beforeAll(async () => {
  db = new pg.Client({ connectionString: `postgres://postgres:${env.POSTGRES_PASSWORD}@localhost:5432/docbeam_db` });
  await db.connect();
  const login = await call(AUTH_URL, '/auth/login', { json: { email: 'priya.shah@example.com', password: env.SEED_USER_PASSWORD } });
  const claims = JSON.parse(Buffer.from(login.body.accessToken.split('.')[1], 'base64url').toString());
  priya = { id: claims.sub, token: login.body.accessToken };
});
afterAll(() => db.end());

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

interface Ready {
  fileId: string;
  sha256: string;
}

/** Uploads one small PDF and waits until it is confirmed and scanned clean. */
async function readyFile(token = priya.token): Promise<Ready> {
  const data = Buffer.from(`%PDF-1.7\n${randomUUID()}\n%%EOF\n`);
  const created = await call(DOCBEAM_URL, '/uploads', {
    token,
    json: { files: [{ name: 'protocol.pdf', sizeBytes: data.length, contentType: 'application/pdf', sha256: sha(data) }] },
  });
  const { fileId, post } = created.body.uploads[0];
  const form = new FormData();
  for (const [k, v] of Object.entries(post.fields as Record<string, string>)) form.append(k, v);
  form.append('file', new Blob([data]), 'upload.bin');
  expect((await fetch(post.url, { method: 'POST', body: form })).status).toBe(204);
  await eventually(async () => {
    const state = await call(DOCBEAM_URL, `/files?ids=${fileId}`, { token });
    return state.body[0]?.scanStatus === 'clean' ? true : undefined;
  }, 60_000);
  return { fileId, sha256: sha(data) };
}

/** A file row that was never uploaded (no object, not confirmed). */
async function unconfirmedFile(): Promise<Ready> {
  const data = Buffer.from(`%PDF-1.7\n${randomUUID()}\n`);
  const created = await call(DOCBEAM_URL, '/uploads', {
    token: priya.token,
    json: { files: [{ name: 'never.pdf', sizeBytes: data.length, contentType: 'application/pdf', sha256: sha(data) }] },
  });
  return { fileId: created.body.uploads[0].fileId, sha256: sha(data) };
}

const dest = (folder: { id: string } = irb) => ({ binderId: regulatory.id, folderId: folder.id });

function submit(files: Ready[], destinations: object[][], key: string | null = randomUUID(), token = priya.token) {
  return call(DOCBEAM_URL, '/jobs', {
    token,
    headers: key === null ? {} : { 'idempotency-key': key },
    json: {
      files: files.map((f) => ({ fileId: f.fileId, sha256: f.sha256 })),
      mappings: files.map((f, i) => ({ fileId: f.fileId, destinations: destinations[i] })),
    },
  });
}

const count = async (sql: string, params: unknown[] = []): Promise<number> =>
  Number((await db.query(sql, params)).rows[0].count);

describe('POST /jobs', () => {
  it('creates the job, claims the files, writes one pending task per delivery and one audit event', async () => {
    const [a, b] = [await readyFile(), await readyFile()];
    const reply = await submit([a, b], [[dest(irb), dest(amendments)], [dest(irb)]]);
    expect(reply.status).toBe(201);
    expect(reply.body.taskCount).toBe(3);
    const jobId: string = reply.body.jobId;

    const job = (await db.query('SELECT * FROM jobs WHERE id = $1', [jobId])).rows[0];
    expect(job).toMatchObject({ submitted_by_user_id: priya.id, submitted_by_name: 'Priya Shah', task_count: 3, fanned_out_at: null, completed_at: null });
    expect(job.queued_at).not.toBeNull();

    const tasks = (await db.query('SELECT * FROM tasks WHERE job_id = $1 ORDER BY destination_path', [jobId])).rows;
    expect(tasks).toHaveLength(3);
    for (const t of tasks) {
      expect(t).toMatchObject({ status: 'pending', attempt_count: 0, team_id: cardio.id, binder_id: regulatory.id });
    }
    expect(tasks.map((t) => t.destination_path)).toEqual([
      'Cardio / CARDIO-301 Regulatory / IRB approvals',
      'Cardio / CARDIO-301 Regulatory / IRB approvals',
      'Cardio / CARDIO-301 Regulatory / Protocol amendments',
    ].sort());
    expect(tasks.filter((t) => t.folder_id === null)).toHaveLength(0);

    const claimed = (await db.query('SELECT job_id FROM files WHERE id = ANY($1)', [[a.fileId, b.fileId]])).rows;
    expect(claimed.every((r) => r.job_id === jobId)).toBe(true);

    const audit = (await db.query(`SELECT * FROM audit_events WHERE job_id = $1`, [jobId])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'job.submitted', actor_id: priya.id, team_id: null });
    expect(audit[0].detail).toMatchObject({ actorName: 'Priya Shah', actorEmail: 'priya.shah@example.com', taskCount: 3, fileCount: 2 });
  });

  it('answers 400 IDEMPOTENCY_KEY_REQUIRED without the header, and 401 without a token', async () => {
    const file = await readyFile();
    const noKey = await submit([file], [[dest()]], null);
    expect(noKey.status).toBe(400);
    expect(noKey.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const noToken = await call(DOCBEAM_URL, '/jobs', { json: { files: [], mappings: [] } });
    expect(noToken.status).toBe(401);
  });

  it('returns the same job for a repeated key and creates nothing new', async () => {
    const file = await readyFile();
    const key = randomUUID();
    const first = await submit([file], [[dest()]], key);
    const second = await submit([file], [[dest()]], key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await count('SELECT count(*) FROM jobs WHERE idempotency_key = $1', [key])).toBe(1);
    expect(await count('SELECT count(*) FROM tasks WHERE job_id = $1', [first.body.jobId])).toBe(1);
  });

  it('gives one job to two requests with the same key that run at the same time', async () => {
    const files = [await readyFile(), await readyFile(), await readyFile()];
    const key = randomUUID();
    const replies = await Promise.all([
      submit(files, files.map(() => [dest(irb), dest(amendments)]), key),
      submit(files, files.map(() => [dest(irb), dest(amendments)]), key),
      submit(files, files.map(() => [dest(irb), dest(amendments)]), key),
    ]);
    expect(replies.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(replies.map((r) => r.body.jobId)).size).toBe(1);
    expect(await count('SELECT count(*) FROM jobs WHERE idempotency_key = $1', [key])).toBe(1);
    expect(await count('SELECT count(*) FROM tasks WHERE job_id = $1', [replies[0]?.body.jobId])).toBe(6);
  });

  it('answers 422 INVALID_BATCH for a batch that breaks a limit, and creates nothing', async () => {
    const [a, b] = [await readyFile(), await readyFile()];
    const noDestination = await submit([a, b], [[dest()], []]);
    expect(noDestination.status).toBe(422);
    expect(noDestination.body.error.code).toBe('INVALID_BATCH');

    const twice = await submit([a], [[dest(irb), dest(irb)]]);
    expect(twice.status).toBe(422);
    expect(twice.body.error.code).toBe('INVALID_BATCH');

    expect(await count('SELECT count(*) FROM files WHERE id = ANY($1) AND job_id IS NOT NULL', [[a.fileId, b.fileId]])).toBe(0);
  });

  it('answers 422 FILE_NOT_READY for a file that was never uploaded', async () => {
    const reply = await submit([await unconfirmedFile()], [[dest()]]);
    expect(reply.status).toBe(422);
    expect(reply.body.error.code).toBe('FILE_NOT_READY');
  });

  it('answers 422 FILE_TOO_OLD for a file uploaded more than 24 hours ago', async () => {
    const file = await readyFile();
    await db.query(`UPDATE files SET created_at = now() - interval '25 hours' WHERE id = $1`, [file.fileId]);
    const reply = await submit([file], [[dest()]]);
    expect(reply.status).toBe(422);
    expect(reply.body.error.code).toBe('FILE_TOO_OLD');
  });

  it('answers 409 FILE_ALREADY_SUBMITTED when the file is in another job', async () => {
    const file = await readyFile();
    expect((await submit([file], [[dest()]])).status).toBe(201);
    const again = await submit([file], [[dest(amendments)]]);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('FILE_ALREADY_SUBMITTED');
  });

  it('answers 422 CHECKSUM_MISMATCH for a different fingerprint', async () => {
    const file = await readyFile();
    const reply = await submit([{ ...file, sha256: 'f'.repeat(64) }], [[dest()]]);
    expect(reply.status).toBe(422);
    expect(reply.body.error.code).toBe('CHECKSUM_MISMATCH');
    expect(await count('SELECT count(*) FROM files WHERE id = $1 AND job_id IS NOT NULL', [file.fileId])).toBe(0);
  });

  it('refuses another user\'s file as if it did not exist', async () => {
    const file = await readyFile();
    const raj = await call(AUTH_URL, '/auth/login', { json: { email: 'raj.mehta@example.com', password: env.SEED_USER_PASSWORD } });
    const reply = await submit([file], [[dest()]], randomUUID(), raj.body.accessToken);
    expect(reply.status).toBe(422);
    expect(reply.body.error.code).toBe('INVALID_BATCH');
  });

  it('answers 422 DESTINATION_NOT_FOUND, alike for a missing binder and another team\'s binder, and creates nothing', async () => {
    const file = await readyFile();
    const jobsBefore = await count('SELECT count(*) FROM jobs WHERE submitted_by_user_id = $1', [priya.id]);
    const missing = await submit([file], [[{ binderId: randomUUID(), folderId: randomUUID() }]]);
    const foreign = await submit([file], [[{ binderId: neuroBinder, folderId: neuroFolder }]]);
    for (const reply of [missing, foreign]) {
      expect(reply.status).toBe(422);
      expect(reply.body.error.code).toBe('DESTINATION_NOT_FOUND');
      expect(reply.body.notFound).toHaveLength(1);
    }
    expect(foreign.body.error.message).toBe(missing.body.error.message);
    expect(await count('SELECT count(*) FROM files WHERE id = $1 AND job_id IS NOT NULL', [file.fileId])).toBe(0);
    expect(await count('SELECT count(*) FROM jobs WHERE submitted_by_user_id = $1', [priya.id])).toBe(jobsBefore);
  });

  it('answers 422 INVALID_BATCH for a binder with no folder, with or without the key, and creates nothing (D-F1-3)', async () => {
    const file = await readyFile();
    const jobsBefore = await count('SELECT count(*) FROM jobs WHERE submitted_by_user_id = $1', [priya.id]);
    for (const binderOnly of [{ binderId: regulatory.id }, { binderId: regulatory.id, folderId: null }]) {
      const reply = await submit([file], [[dest(), binderOnly]]);
      expect(reply.status).toBe(422);
      expect(reply.body.error.code).toBe('INVALID_BATCH');
    }
    expect(await count('SELECT count(*) FROM files WHERE id = $1 AND job_id IS NOT NULL', [file.fileId])).toBe(0);
    expect(await count('SELECT count(*) FROM jobs WHERE submitted_by_user_id = $1', [priya.id])).toBe(jobsBefore);
  });

  it('accepts the largest batch, 100 files x 20 destinations, in one request', async () => {
    // 100 files are rows only here: confirmed by hand, so the test does not upload 100 objects.
    const ids = Array.from({ length: 100 }, () => randomUUID());
    const owner = priya.id;
    await db.query(
      `INSERT INTO files (id, owner_user_id, original_name, size_bytes, content_type, checksum_sha256, s3_key, s3_checksum, uploaded_at, scan_status)
       SELECT id, $2, 'bulk.pdf', 10, 'application/pdf', repeat('c', 64), 'staging/bulk/' || id, 'x', now(), 'clean' FROM unnest($1::uuid[]) AS id`,
      [ids, owner],
    );
    // 20 destinations: the folders of the two Cardio binders, nested ones included (the 50-team load seed would need
    // more users).
    const cardioDestinations: object[] = [];
    const walk = (binderId: string, folders: { id: string; folders: unknown[] }[]) => {
      for (const f of folders) {
        cardioDestinations.push({ binderId, folderId: f.id });
        walk(binderId, f.folders as { id: string; folders: unknown[] }[]);
      }
    };
    for (const binder of cardio.binders) walk(binder.id, binder.folders);
    const chosen = cardioDestinations.slice(0, 20);
    expect(chosen.length).toBeGreaterThan(1);

    const started = Date.now();
    const reply = await call(DOCBEAM_URL, '/jobs', {
      token: priya.token,
      headers: { 'idempotency-key': randomUUID() },
      json: {
        files: ids.map((fileId) => ({ fileId, sha256: 'c'.repeat(64) })),
        mappings: ids.map((fileId) => ({ fileId, destinations: chosen })),
      },
    });
    expect(reply.status).toBe(201);
    expect(reply.body.taskCount).toBe(100 * chosen.length);
    expect(Date.now() - started).toBeLessThan(5_000); // the 500 ms p99 target is measured on dev (M5 5.1)
    expect(await count('SELECT count(*) FROM tasks WHERE job_id = $1', [reply.body.jobId])).toBe(100 * chosen.length);
  }, 60_000);
});

describe('POST /jobs when the platform is down', () => {
  it('answers 503 PLATFORM_UNAVAILABLE, creates nothing, and the same key works once it returns', async () => {
    const file = await readyFile();
    const key = randomUUID();
    compose('stop', 'platform');
    try {
      const down = await submit([file], [[dest()]], key);
      expect(down.status).toBe(503);
      expect(down.body.error.code).toBe('PLATFORM_UNAVAILABLE');
      expect(await count('SELECT count(*) FROM jobs WHERE idempotency_key = $1', [key])).toBe(0);
      expect(await count('SELECT count(*) FROM files WHERE id = $1 AND job_id IS NOT NULL', [file.fileId])).toBe(0);
    } finally {
      compose('start', 'platform');
    }
    await eventually(async () => (await fetch(`${PLATFORM_URL}/health`).catch(() => null))?.ok, 60_000);

    const retry = await submit([file], [[dest()]], key);
    expect(retry.status).toBe(201);
  }, 120_000);
});
