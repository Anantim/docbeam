import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTH_URL, call, deleteJobs, DOCBEAM_URL, env, PREFIX, s3, serviceToken } from './helpers.js';

// Step 4.1 on the Compose stack: POST /files/:fileId/downloads with the real route and the LocalStack Object Store.
//   Priya Shah: Cardio + Oncology. Raj Mehta: Cardio. Sam Ito: Neuro only.
const demo = JSON.parse(readFileSync(new URL('../../services/platform/seed/demo.json', import.meta.url), 'utf8'));
const team = (name: string) => demo.teams.find((t: { name: string }) => t.name === name) as { id: string; binders: Array<{ id: string }> };
const cardio = team('Cardio');
const oncology = team('Oncology');
const conn = `postgres://postgres:${env.POSTGRES_PASSWORD}@localhost:5432/docbeam_db`;
const BUCKET = `${PREFIX}-object-store`;

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
const madeJobs: string[] = [];
afterAll(async () => {
  await deleteJobs(db, madeJobs);
  await db.end();
});

const CONTENT = Buffer.from('%PDF-1.4 download test ' + randomUUID());

interface Made {
  fileId: string;
  key: string;
}

/** A job by Priya with one stored file. `deliveries` are the teams with a task and its status. */
async function makeFile(options: {
  name?: string;
  deliveries: Array<{ team: typeof cardio; status: 'completed' | 'pending' | 'failed' }>;
  uploadedDaysAgo?: number;
  scanStatus?: string;
  store?: boolean;
}): Promise<Made> {
  const jobId = randomUUID();
  madeJobs.push(jobId);
  const fileId = randomUUID();
  const key = `staging/${ids[priya]}/${fileId}`;
  const uploaded = new Date(Date.now() - (options.uploadedDaysAgo ?? 1) * 86_400_000);
  if (options.store !== false) {
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: CONTENT, ContentType: 'application/pdf', Tagging: 'scan-status=clean' }));
  }
  await db.query(
    `INSERT INTO jobs (id, submitted_by_user_id, submitted_by_name, task_count, idempotency_key, fanned_out_at)
     VALUES ($1, $2, 'Priya Shah', $3, $4, now())`,
    [jobId, ids[priya], options.deliveries.length, randomUUID()],
  );
  await db.query(
    `INSERT INTO files (id, owner_user_id, job_id, original_name, size_bytes, content_type, checksum_sha256, s3_key, uploaded_at, scan_status, created_at)
     VALUES ($1, $2, $3, $4, $5, 'application/pdf', repeat('a', 64), $6, $7, $8, $7)`,
    [fileId, ids[priya], jobId, options.name ?? 'Protocol "v2" é.pdf', CONTENT.length, key, uploaded, options.scanStatus ?? 'clean'],
  );
  for (const d of options.deliveries) {
    await db.query(
      `INSERT INTO tasks (id, job_id, file_id, team_id, binder_id, destination_path, status) VALUES ($1, $2, $3, $4, $5, 'Team / Binder', $6)`,
      [randomUUID(), jobId, fileId, d.team.id, d.team.binders[0]?.id, d.status],
    );
  }
  return { fileId, key };
}

const ask = (email: string, fileId: string, body?: unknown) =>
  call(DOCBEAM_URL, `/files/${fileId}/downloads`, { token: tokens[email], method: 'POST', ...(body !== undefined ? { json: body } : {}) });
const auditCount = async (fileId: string) =>
  (await db.query(`SELECT count(*)::int AS n FROM audit_events WHERE action = 'download.issued' AND detail->>'fileId' = $1`, [fileId])).rows[0].n as number;

describe('POST /files/:fileId/downloads', () => {
  it('answers with the type found in the file\'s contents when it is stored, else the declared one (D-F1-44)', async () => {
    const f = await makeFile({ deliveries: [{ team: cardio, status: 'completed' }] });
    expect((await ask(priya, f.fileId)).body.contentType).toBe('application/pdf'); // nothing stored: the declared type
    await db.query(`UPDATE files SET detected_type = 'image/png' WHERE id = $1`, [f.fileId]);
    const reply = await ask(priya, f.fileId, { mode: 'preview' });
    expect(reply.status).toBe(201);
    expect(reply.body.contentType).toBe('image/png'); // the stored type drives it
    expect(new URL(reply.body.url).searchParams.get('response-content-type')).toBe('image/png'); // and the preview link's content type
  });

  it('gives the sender a link that saves the exact bytes under the original name', async () => {
    const f = await makeFile({ deliveries: [{ team: cardio, status: 'completed' }] });
    const reply = await ask(priya, f.fileId);
    expect(reply.status).toBe(201);
    expect(reply.body).toMatchObject({ fileName: 'Protocol "v2" é.pdf', contentType: 'application/pdf', sizeBytes: CONTENT.length });
    expect(Date.parse(reply.body.expiresAt) - Date.now()).toBeGreaterThan(100_000);

    const file = await fetch(reply.body.url);
    expect(file.status).toBe(200);
    expect(Buffer.from(await file.arrayBuffer()).equals(CONTENT)).toBe(true);
    const disposition = file.headers.get('content-disposition') ?? '';
    expect(disposition).toContain('attachment');
    expect(disposition).toContain(`filename*=UTF-8''Protocol%20%22v2%22%20%C3%A9.pdf`);
  });

  it('gives a preview link that opens inline with the stored type', async () => {
    const f = await makeFile({ deliveries: [{ team: cardio, status: 'completed' }] });
    const reply = await ask(priya, f.fileId, { mode: 'preview' });
    expect(reply.status).toBe(201);
    const file = await fetch(reply.body.url);
    expect(file.headers.get('content-disposition')).toBe('inline');
    expect(file.headers.get('content-type')).toBe('application/pdf');
  });

  it('lets a member of a team the file was delivered to download it, and records that team', async () => {
    const f = await makeFile({ deliveries: [{ team: cardio, status: 'completed' }, { team: oncology, status: 'completed' }] });
    const reply = await ask(raj, f.fileId, { mode: 'preview' });
    expect(reply.status).toBe(201);
    const event = (await db.query(`SELECT actor_id, team_id, task_id, detail FROM audit_events WHERE action = 'download.issued' AND detail->>'fileId' = $1`, [f.fileId])).rows[0];
    expect(event.actor_id).toBe(ids[raj]);
    expect(event.team_id).toBe(cardio.id);
    expect(event.task_id).toBeNull();
    expect(event.detail).toMatchObject({ mode: 'preview', actorName: expect.any(String), teamIds: [cardio.id] });
  });

  it('gives 404 and no audit row to a team member when the file went only to another team', async () => {
    const f = await makeFile({ deliveries: [{ team: oncology, status: 'completed' }] });
    expect((await ask(raj, f.fileId)).status).toBe(404);
    expect(await auditCount(f.fileId)).toBe(0);
  });

  it('gives 404 to a team member whose delivery is not completed yet', async () => {
    const pending = await makeFile({ deliveries: [{ team: cardio, status: 'pending' }] });
    const failed = await makeFile({ deliveries: [{ team: cardio, status: 'failed' }] });
    expect((await ask(raj, pending.fileId)).status).toBe(404);
    expect((await ask(raj, failed.fileId)).status).toBe(404);
  });

  it('gives 404 to someone in neither team, the same answer as for a file that does not exist', async () => {
    const f = await makeFile({ deliveries: [{ team: cardio, status: 'completed' }, { team: oncology, status: 'completed' }] });
    const outsider = await ask(sam, f.fileId);
    const missing = await ask(sam, randomUUID());
    expect(outsider.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(outsider.body).toEqual(missing.body);
    expect(await auditCount(f.fileId)).toBe(0);
  });

  it('gives 404 for an id that is not a UUID and 401 without a token', async () => {
    expect((await ask(priya, 'not-a-uuid')).status).toBe(404);
    const anonymous = await call(DOCBEAM_URL, `/files/${randomUUID()}/downloads`, { method: 'POST' });
    expect(anonymous.status).toBe(401);
  });

  it('gives 404 for a file that is not scanned clean, even to the sender', async () => {
    const f = await makeFile({ deliveries: [{ team: cardio, status: 'completed' }], scanStatus: 'infected' });
    expect((await ask(priya, f.fileId)).status).toBe(404);
  });

  it('answers 410 FILE_EXPIRED after 33 days to an allowed caller and 404 to an outsider', async () => {
    const f = await makeFile({ deliveries: [{ team: cardio, status: 'completed' }], uploadedDaysAgo: 34, store: false });
    const sender = await ask(priya, f.fileId);
    expect(sender.status).toBe(410);
    expect(sender.body.error.code).toBe('FILE_EXPIRED');
    expect((await ask(raj, f.fileId)).status).toBe(410);
    expect((await ask(sam, f.fileId)).status).toBe(404);
    expect(await auditCount(f.fileId)).toBe(0);
  });

  it('refuses a mode other than download or preview', async () => {
    const f = await makeFile({ deliveries: [{ team: cardio, status: 'completed' }] });
    const reply = await ask(priya, f.fileId, { mode: 'stream' });
    expect(reply.status).toBe(400);
    expect(reply.body.error.code).toBe('VALIDATION_ERROR');
  });

  // D-M5-5: a POST with no body and no content type works for any client. Through CloudFront and the gateway it can arrive
  // chunked, which used to get 415. A body of another type is still refused.
  it('accepts a POST with no body, empty or chunked, and no content type, as a download', async () => {
    const f = await makeFile({ deliveries: [{ team: cardio, status: 'completed' }] });
    const rawPost = (headers: Record<string, string>, body?: string) =>
      new Promise<number>((resolve, reject) => {
        const req = httpRequest(`${DOCBEAM_URL}/files/${f.fileId}/downloads`, { method: 'POST', headers: { authorization: `Bearer ${tokens[priya]}`, ...headers } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
      });
    expect(await rawPost({ 'content-length': '0' })).toBe(201);
    expect(await rawPost({ 'transfer-encoding': 'chunked' })).toBe(201);
    expect(await rawPost({ 'content-type': 'application/octet-stream', 'content-length': '0' })).toBe(201);
    expect(await rawPost({ 'content-type': 'application/x-www-form-urlencoded' }, 'mode=preview')).toBe(415);
  });

  // A link used after its 2 minutes is refused by S3. LocalStack does not enforce expiry, so this is proved on dev
  // (M4-TESTING.md section 3); the unit test pins X-Amz-Expires to 120.
});

describe('who sees a download in GET /audit', () => {
  it('shows a team member\'s download to them and to the sender, and the sender\'s own only to the sender', async () => {
    const f = await makeFile({ deliveries: [{ team: cardio, status: 'completed' }] });
    expect((await ask(raj, f.fileId)).status).toBe(201);
    expect((await ask(priya, f.fileId)).status).toBe(201);

    const seen = async (email: string) =>
      ((await call(DOCBEAM_URL, '/audit?action=download.issued&limit=200', { token: tokens[email] })).body.events as Array<{ detail: { fileId: string }; actorId: string }>)
        .filter((e) => e.detail.fileId === f.fileId)
        .map((e) => e.actorId);

    expect((await seen(priya)).sort()).toEqual([ids[priya], ids[raj]].sort());
    expect(await seen(raj)).toEqual([ids[raj]]);
    expect(await seen(sam)).toEqual([]);
  });
});
