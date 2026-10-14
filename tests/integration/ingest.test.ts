import { createHash, randomUUID } from 'node:crypto';
import { HeadObjectCommand, ListObjectVersionsCommand } from '@aws-sdk/client-s3';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PLATFORM_URL, PREFIX, call, env, s3, serviceToken } from './helpers.js';
import { readFileSync } from 'node:fs';

// POST /documents (Step 1.3). Uses the seeded Cardio binder and a user in that team.
const demo = JSON.parse(readFileSync(new URL('../../services/platform/seed/demo.json', import.meta.url), 'utf8'));
const cardio = demo.teams.find((t: { name: string }) => t.name === 'Cardio');
const binderId: string = cardio.binders[0].id;
const folderId: string = cardio.binders[0].folders[0].id;
const neuroBinderId: string = demo.teams.find((t: { name: string }) => t.name === 'Neuro').binders[0].id;
const BUCKET = `${PREFIX}-platform-files`;

let db: pg.Client;
let token: string;
let priyaId: string;
let samId: string;
beforeAll(async () => {
  db = new pg.Client({ connectionString: `postgres://postgres:${env.POSTGRES_PASSWORD}@localhost:5432/platform_db` });
  await db.connect();
  token = await serviceToken('delivery-worker', 'documents:ingest');
  const users = await serviceToken('seed-script', 'users:read');
  const id = async (email: string) => (await call('http://localhost:3001', `/internal/users?email=${email}`, { token: users })).body.id;
  priyaId = await id('priya.shah@example.com');
  samId = await id('sam.ito@example.com');
});
afterAll(() => db.end());

const pdf = (text = 'hello'): Buffer => Buffer.from(`%PDF-1.7\n${text}\n%%EOF\n`);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

interface Options {
  taskId?: string;
  binder?: string;
  folder?: string | null;
  contentType?: string;
  checksum?: string;
  user?: string;
  file?: Buffer;
  fileFirst?: boolean;
  auth?: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ingest(o: Options = {}): Promise<{ status: number; body: any }> {
  const file = o.file ?? pdf();
  const form = new FormData();
  const fields: [string, string][] = [
    ['taskId', o.taskId ?? randomUUID()],
    ['binderId', o.binder ?? binderId],
    ...(o.folder === null ? [] : ([['folderId', o.folder ?? folderId]] as [string, string][])),
    ['name', 'protocol.pdf'],
    ['contentType', o.contentType ?? 'application/pdf'],
    ['checksumSha256', o.checksum ?? sha(file)],
    ['onBehalfOf', o.user ?? priyaId],
  ];
  const append = () => form.append('file', new Blob([file]), 'protocol.pdf');
  if (o.fileFirst) append();
  for (const [k, v] of fields) form.append(k, v);
  if (!o.fileFirst) append();
  const headers: Record<string, string> = {};
  const auth = o.auth === undefined ? token : o.auth;
  if (auth) headers.authorization = `Bearer ${auth}`;
  const res = await fetch(`${PLATFORM_URL}/documents`, { method: 'POST', headers, body: form });
  return { status: res.status, body: await res.json() };
}

const objectExists = async (documentId: string): Promise<boolean> =>
  s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: `documents/${documentId}` })).then(
    () => true,
    () => false,
  );

describe('POST /documents', () => {
  it('stores a new document: 201, one row, one object, checksum kept', async () => {
    const file = pdf('new document');
    const taskId = randomUUID();
    const res = await ingest({ taskId, file });
    expect(res.status).toBe(201);
    const { rows } = await db.query('SELECT * FROM documents WHERE source_task_id = $1', [taskId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: res.body.documentId,
      binder_id: binderId,
      folder_id: folderId,
      checksum_sha256: sha(file),
      storage_key: `documents/${res.body.documentId}`,
      uploaded_by_user_id: priyaId,
      content_type: 'application/pdf',
    });
    expect(Number(rows[0].size_bytes)).toBe(file.length);
    expect(await objectExists(res.body.documentId)).toBe(true);
  });

  it('answers 200 with the same document for the same task', async () => {
    const taskId = randomUUID();
    const first = await ingest({ taskId });
    const second = await ingest({ taskId, file: pdf('different bytes, never read') });
    expect(second.status).toBe(200);
    expect(second.body.documentId).toBe(first.body.documentId);
    const { rows } = await db.query('SELECT count(*) FROM documents WHERE source_task_id = $1', [taskId]);
    expect(Number(rows[0].count)).toBe(1);
  });

  it('stores one document for two parallel repeats of a task', async () => {
    const taskId = randomUUID();
    const file = pdf('x'.repeat(2_000_000));
    const results = await Promise.all([ingest({ taskId, file }), ingest({ taskId, file })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(results[0]!.body.documentId).toBe(results[1]!.body.documentId);
    const { rows } = await db.query('SELECT count(*) FROM documents WHERE source_task_id = $1', [taskId]);
    expect(Number(rows[0].count)).toBe(1);
    // The loser removed its own object: no live object exists under any other document id for this task.
    const listed = await s3.send(new ListObjectVersionsCommand({ Bucket: BUCKET, Prefix: 'documents/' }));
    const live = new Set((listed.Versions ?? []).filter((v) => v.IsLatest).map((v) => v.Key));
    const deleted = new Set((listed.DeleteMarkers ?? []).filter((m) => m.IsLatest).map((m) => m.Key));
    const kept = [...live].filter((k) => !deleted.has(k));
    expect(kept).toContain(`documents/${results[0]!.body.documentId}`);
  });

  it('puts a document at the top level of a binder when no folder is given', async () => {
    const taskId = randomUUID();
    const res = await ingest({ taskId, folder: null });
    expect(res.status).toBe(201);
    const { rows } = await db.query('SELECT folder_id FROM documents WHERE source_task_id = $1', [taskId]);
    expect(rows[0].folder_id).toBeNull();
  });

  it('answers 403 NOT_A_MEMBER when the user is not in the binder\'s team', async () => {
    const taskId = randomUUID();
    const res = await ingest({ taskId, user: samId });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_A_MEMBER');
    const { rows } = await db.query('SELECT count(*) FROM documents WHERE source_task_id = $1', [taskId]);
    expect(Number(rows[0].count)).toBe(0);
  });

  it('answers 404 DESTINATION_NOT_FOUND for a missing binder, and for a folder in another binder', async () => {
    const missing = await ingest({ binder: randomUUID() });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('DESTINATION_NOT_FOUND');
    const wrongFolder = await ingest({ binder: cardio.binders[1].id, folder: folderId });
    expect(wrongFolder.status).toBe(404);
  });

  it('answers 422 CHECKSUM_MISMATCH and leaves nothing behind', async () => {
    const taskId = randomUUID();
    const res = await ingest({ taskId, checksum: sha(Buffer.from('some other file')) });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CHECKSUM_MISMATCH');
    const { rows } = await db.query('SELECT count(*) FROM documents WHERE source_task_id = $1', [taskId]);
    expect(Number(rows[0].count)).toBe(0);
  });

  it('answers 422 UNSUPPORTED_TYPE for a program renamed to .pdf, and for a type off the list', async () => {
    const exe = Buffer.from('MZ\x90\x00\x03\x00\x00\x00 this is not a pdf');
    const renamed = await ingest({ file: exe });
    expect(renamed.status).toBe(422);
    expect(renamed.body.error.code).toBe('UNSUPPORTED_TYPE');
    const offList = await ingest({ file: exe, contentType: 'application/x-msdownload' });
    expect(offList.status).toBe(422);
    expect(offList.body.error.code).toBe('UNSUPPORTED_TYPE');
  });

  it('refuses the file before the fields with 400', async () => {
    const res = await ingest({ fileFirst: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires a service token with documents:ingest', async () => {
    expect((await ingest({ auth: null })).status).toBe(401);
    const wrongScope = await serviceToken('docbeam-api', 'memberships:read');
    expect((await ingest({ auth: wrongScope })).status).toBe(403);
  });

  it('is not reachable for a member of another binder\'s team through the neuro binder', async () => {
    const res = await ingest({ binder: neuroBinderId, folder: null });
    expect(res.status).toBe(403);
  });
});
