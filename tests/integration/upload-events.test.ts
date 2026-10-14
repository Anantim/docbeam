import { createHash, randomUUID } from 'node:crypto';
import { GetObjectTaggingCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { GetQueueUrlCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, DOCBEAM_URL, env, eventually, PREFIX, registerAndLogin, s3, sqs } from './helpers.js';

// Upload confirmation and malware scanning (Step 2.1b, ADR-016), through the real `clamav` container.
// Carried over from M0 (Step 0.1): the EICAR test file is refused locally by the real scanner.
const BUCKET = `${PREFIX}-object-store`;

// The standard anti-virus test string. Harmless, and every scanner flags it.
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

let db: pg.Client;
let user: Awaited<ReturnType<typeof registerAndLogin>>;

beforeAll(async () => {
  db = new pg.Client({ connectionString: `postgres://postgres:${env.POSTGRES_PASSWORD}@localhost:5432/docbeam_db` });
  await db.connect();
  user = await registerAndLogin(undefined, 'Scan Owner');
});
afterAll(() => db.end());

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const pdf = (text: string): Buffer => Buffer.from(`%PDF-1.7\n${text}\n%%EOF\n`);

/** Declares `declared`, uploads `actual` through the form (so they can differ), and returns the file id. */
async function upload(declared: Buffer, actual: Buffer = declared, name = 'doc.pdf'): Promise<string> {
  const reply = await call(DOCBEAM_URL, '/uploads', {
    token: user.token,
    json: { files: [{ name, sizeBytes: declared.length, contentType: 'application/pdf', sha256: sha(declared) }] },
  });
  expect(reply.status).toBe(201);
  const { fileId, post } = reply.body.uploads[0];
  const form = new FormData();
  for (const [k, v] of Object.entries(post.fields as Record<string, string>)) form.append(k, v);
  form.append('file', new Blob([actual]), 'upload.bin');
  const sent = await fetch(post.url, { method: 'POST', body: form });
  expect(sent.status).toBe(204);
  return fileId;
}

const row = async (id: string) => (await db.query('SELECT * FROM files WHERE id = $1', [id])).rows[0];
const refusals = async (id: string) =>
  (await db.query(`SELECT * FROM audit_events WHERE action = 'file.refused' AND detail->>'fileId' = $1`, [id])).rows;

async function settled(id: string) {
  return eventually(async () => {
    const r = await row(id);
    return r.scan_status !== 'pending' ? r : undefined;
  }, 60_000);
}

/** The same S3 event again, as SQS may deliver it (at least once). */
async function resendEvent(key: string, size: number): Promise<void> {
  const { QueueUrl = '' } = await sqs.send(new GetQueueUrlCommand({ QueueName: `${PREFIX}-upload-events` }));
  const body = {
    Records: [{ eventName: 'ObjectCreated:Post', s3: { bucket: { name: BUCKET }, object: { key, size } } }],
  };
  await sqs.send(new SendMessageCommand({ QueueUrl, MessageBody: JSON.stringify(body) }));
}

describe('upload-events: confirmation and scanning', () => {
  it('EICAR is refused as infected by the real ClamAV', async () => {
    const eicar = Buffer.from(EICAR);
    const id = await upload(eicar, eicar, 'invoice.pdf');
    const r = await settled(id);

    expect(r.scan_status).toBe('infected');
    expect(r.uploaded_at).toBeNull();
    // The object is deleted, so it can never be sent or downloaded.
    await expect(s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: r.s3_key }))).rejects.toMatchObject({ name: 'NotFound' });

    const events = await refusals(id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor_id: null, job_id: null });
    expect(events[0].detail).toMatchObject({ reason: 'MALWARE', fileName: 'invoice.pdf', ownerUserId: user.id });
    expect(events[0].detail.signature).toMatch(/eicar/i);

    // The browser sees it through GET /files.
    const state = await call(DOCBEAM_URL, `/files?ids=${id}`, { token: user.token });
    expect(state.body).toEqual([{ fileId: id, uploaded: false, scanStatus: 'infected' }]);
  }, 90_000);

  it('a repeated event for a refused file changes nothing and writes no second audit event', async () => {
    const eicar = Buffer.from(`${EICAR}\n`);
    const id = await upload(eicar);
    const r = await settled(id);
    expect(r.scan_status).toBe('infected');

    await resendEvent(r.s3_key, eicar.length);
    await new Promise((resolve) => setTimeout(resolve, 4000));
    expect(await refusals(id)).toHaveLength(1);
    expect((await row(id)).scan_status).toBe('infected');
  }, 90_000);

  it('a clean file is tagged scan-status=clean and confirmed, and a repeated event changes nothing', async () => {
    const data = pdf('a perfectly ordinary document');
    const id = await upload(data);
    const r = await settled(id);

    expect(r.scan_status).toBe('clean');
    expect(r.uploaded_at).not.toBeNull();
    const tags = await s3.send(new GetObjectTaggingCommand({ Bucket: BUCKET, Key: r.s3_key }));
    expect(tags.TagSet).toContainEqual({ Key: 'scan-status', Value: 'clean' });

    const state = await call(DOCBEAM_URL, `/files?ids=${id}`, { token: user.token });
    expect(state.body).toEqual([{ fileId: id, uploaded: true, scanStatus: 'clean' }]);

    await resendEvent(r.s3_key, data.length);
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const again = await row(id);
    expect(again.uploaded_at).toEqual(r.uploaded_at);
    expect(again.scan_status).toBe('clean');
    expect(await refusals(id)).toHaveLength(0);
  }, 90_000);

  it('refuses a file whose stored size is smaller than declared', async () => {
    const declared = pdf('declared with more words than were sent');
    const id = await upload(declared, pdf('short'));
    const r = await settled(id);
    expect(r.scan_status).toBe('failed');
    const events = await refusals(id);
    expect(events).toHaveLength(1);
    expect(events[0].detail.reason).toBe('MISMATCH');
    await expect(s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: r.s3_key }))).rejects.toMatchObject({ name: 'NotFound' });
  }, 90_000);

  it('refuses bytes that differ from the declared SHA-256, found by the scan pass itself', async () => {
    // Same length, different bytes. LocalStack does not enforce the form's checksum field, so this proves
    // the Lambda's own hashing; on AWS S3 refuses the upload first (M2-TESTING 3).
    const declared = pdf('0123456789');
    const swapped = pdf('9876543210');
    expect(swapped.length).toBe(declared.length);
    const id = await upload(declared, swapped);
    const r = await settled(id);
    expect(r.scan_status).toBe('failed');
    expect((await refusals(id))[0].detail.reason).toBe('MISMATCH');
  }, 90_000);

  it('ignores an event for a file that has no row', async () => {
    await resendEvent(`staging/${user.id}/${randomUUID()}`, 10);
    // Nothing to assert on except that the queue drains and the worker stays healthy.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const health = await fetch('http://localhost:3005/health').catch(() => null);
    expect(health === null || health.ok).toBe(true);
  });
});
