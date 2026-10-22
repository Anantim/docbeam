import { createHash, randomUUID } from 'node:crypto';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, DOCBEAM_URL, env, PREFIX, registerAndLogin, s3 } from './helpers.js';

// Upload links, single and multipart (Step 2.1a). The file goes from this test straight to LocalStack,
// the way the browser sends it.
const BUCKET = `${PREFIX}-object-store`;
const MIB = 1024 * 1024;

let db: pg.Client;
let owner: Awaited<ReturnType<typeof registerAndLogin>>;
let other: Awaited<ReturnType<typeof registerAndLogin>>;

beforeAll(async () => {
  db = new pg.Client({ connectionString: `postgres://postgres:${env.POSTGRES_PASSWORD}@localhost:5432/docbeam_db` });
  await db.connect();
  owner = await registerAndLogin(undefined, 'Upload Owner');
  other = await registerAndLogin(undefined, 'Someone Else');
});
afterAll(() => db.end());

const pdf = (text: string): Buffer => Buffer.from(`%PDF-1.7\n${text}\n%%EOF\n`);
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const b64 = (hex: string): string => Buffer.from(hex, 'hex').toString('base64');

interface Post {
  url: string;
  fields: Record<string, string>;
}

async function postForm(post: Post, body: Buffer): Promise<Response> {
  const form = new FormData();
  for (const [k, v] of Object.entries(post.fields)) form.append(k, v);
  form.append('file', new Blob([body]), 'upload.bin'); // the file part must be last
  return fetch(post.url, { method: 'POST', body: form });
}

async function requestUploads(token: string, files: object[]) {
  return call(DOCBEAM_URL, '/uploads', { token, json: { files } });
}

const fileRow = async (id: string) => (await db.query('SELECT * FROM files WHERE id = $1', [id])).rows[0];

describe('POST /uploads and the single-part form', () => {
  it('returns one form per file, in order, and stores a pending file row', async () => {
    const a = pdf('first');
    const b = pdf('second');
    const reply = await requestUploads(owner.token, [
      { name: 'a.pdf', sizeBytes: a.length, contentType: 'application/pdf', sha256: sha(a) },
      { name: 'b.pdf', sizeBytes: b.length, contentType: 'application/pdf', sha256: sha(b) },
    ]);
    expect(reply.status).toBe(201);
    expect(reply.body.uploads).toHaveLength(2);
    const [first, second] = reply.body.uploads;

    const row = await fileRow(first.fileId);
    expect(row).toMatchObject({
      owner_user_id: owner.id,
      original_name: 'a.pdf',
      content_type: 'application/pdf',
      checksum_sha256: sha(a),
      // The form makes S3 enforce the SHA-256, so the row is confirmed already (D-M2-7).
      s3_checksum: b64(sha(a)),
      scan_status: 'pending',
      uploaded_at: null,
      job_id: null,
      // The key ends in the file's name (D-F1-81), so a viewer with no title for a PDF shows the name.
      s3_key: `staging/${owner.id}/${first.fileId}/a.pdf`,
    });
    expect((await fileRow(second.fileId)).original_name).toBe('b.pdf');

    // Upload straight to the Object Store with the form.
    const sent = await postForm(first.post, a);
    expect(sent.status).toBe(204);
    const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: row.s3_key }));
    expect(head.ContentLength).toBe(a.length);
    // LocalStack 4.14 does not enforce or report the checksum of a presigned POST, so S3's refusal of a
    // swapped body is proved on dev (M2-TESTING 3). The Upload Events Lambda hashes the bytes itself as well.
  });

  it('stores a file under a key that ends in its safe name, whatever it is called (D-F1-81)', async () => {
    const data = pdf('named');
    const reply = await requestUploads(owner.token, [
      { name: '../Protocol amendment 3 "final".pdf', sizeBytes: data.length, contentType: 'application/pdf', sha256: sha(data) },
    ]);
    expect(reply.status).toBe(201);
    const grant = reply.body.uploads[0];
    const row = await fileRow(grant.fileId);
    expect(row.original_name).toBe('../Protocol amendment 3 "final".pdf'); // the name is shown as it was added
    expect(row.s3_key).toBe(`staging/${owner.id}/${grant.fileId}/_Protocol amendment 3 _final_.pdf`);
    expect((await postForm(grant.post, data)).status).toBe(204);
    expect((await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: row.s3_key }))).ContentLength).toBe(data.length);
  });

  it('refuses a name longer than 255 characters', async () => {
    const reply = await requestUploads(owner.token, [{ name: `${'a'.repeat(252)}.pdf`, sizeBytes: 10, contentType: 'application/pdf', sha256: 'a'.repeat(64) }]);
    expect(reply.status).toBe(400);
  });

  it('refuses a body that is larger than the declared size', async () => {
    const declared = pdf('small');
    const big = Buffer.concat([declared, Buffer.alloc(64, 1)]);
    const reply = await requestUploads(owner.token, [
      { name: 'big.pdf', sizeBytes: declared.length, contentType: 'application/pdf', sha256: sha(big) },
    ]);
    const sent = await postForm(reply.body.uploads[0].post, big);
    expect(sent.status).toBeGreaterThanOrEqual(400);
  });

  it.each([
    ['a type outside the allow-list', [{ name: 'a.exe', sizeBytes: 10, contentType: 'application/x-msdownload', sha256: 'a'.repeat(64) }]],
    ['a file over 1 GiB', [{ name: 'a.pdf', sizeBytes: 1024 ** 3 + 1, contentType: 'application/pdf', sha256: 'a'.repeat(64) }]],
    ['an empty file', [{ name: 'a.pdf', sizeBytes: 0, contentType: 'application/pdf', sha256: 'a'.repeat(64) }]],
    ['a bad SHA-256', [{ name: 'a.pdf', sizeBytes: 10, contentType: 'application/pdf', sha256: 'zz' }]],
    ['no files', []],
    [
      'more than 20 files',
      Array.from({ length: 21 }, (_, i) => ({ name: `f${i}.pdf`, sizeBytes: 10, contentType: 'application/pdf', sha256: 'a'.repeat(64) })),
    ],
  ])('answers 400 VALIDATION_ERROR for %s', async (_label, files) => {
    const reply = await requestUploads(owner.token, files);
    expect(reply.status).toBe(400);
    expect(reply.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('answers 401 without a token', async () => {
    const reply = await call(DOCBEAM_URL, '/uploads', { json: { files: [] } });
    expect(reply.status).toBe(401);
  });
});

describe('multipart upload', () => {
  // 100 MiB + 1 byte is the smallest multipart file: six parts of 16 MiB and a last part of 4 MiB + 1 byte.
  const size = 100 * MIB + 1;
  const body = Buffer.alloc(size, 7);
  const parts = Array.from({ length: Math.ceil(size / (16 * MIB)) }, (_, i) => body.subarray(i * 16 * MIB, (i + 1) * 16 * MIB));
  const partShas = parts.map(sha);

  async function start(token = owner.token) {
    const reply = await requestUploads(token, [
      { name: 'big.pdf', sizeBytes: size, contentType: 'application/pdf', sha256: sha(body) },
    ]);
    expect(reply.status).toBe(201);
    const upload = reply.body.uploads[0];
    expect(upload).toMatchObject({ multipart: true, partSize: 16 * MIB, partCount: 7 });
    const started = await call(DOCBEAM_URL, `/files/${upload.fileId}/multipart-uploads`, {
      token,
      json: { parts: partShas.map((s, i) => ({ partNumber: i + 1, sha256: s })) },
    });
    return { fileId: upload.fileId as string, started };
  }

  async function putPart(url: string, n: number, data = parts[n - 1] as Buffer, sum = partShas[n - 1] as string) {
    return fetch(url, { method: 'PUT', headers: { 'x-amz-checksum-sha256': b64(sum) }, body: data });
  }

  it('starts, uploads every part, re-signs one, and completes with the combined checksum', async () => {
    const { fileId, started } = await start();
    expect(started.status).toBe(201);
    expect(started.body.parts).toHaveLength(7);
    expect(started.body.abortUrl).toContain('uploadId=');
    const uploadId: string = started.body.uploadId;
    expect((await fileRow(fileId)).multipart_upload_id).toBe(uploadId);
    expect((await fileRow(fileId)).s3_checksum).toBeNull();

    // A second start for the same file is refused.
    const again = await call(DOCBEAM_URL, `/files/${fileId}/multipart-uploads`, {
      token: owner.token,
      json: { parts: partShas.map((s, i) => ({ partNumber: i + 1, sha256: s })) },
    });
    expect(again.status).toBe(400);

    const etags: { partNumber: number; etag: string }[] = [];
    for (const p of started.body.parts as { partNumber: number; url: string }[]) {
      let url = p.url;
      if (p.partNumber === 7) {
        // The last part gets a fresh link, as when an upload outlasts 15 minutes.
        const resigned = await call(DOCBEAM_URL, `/files/${fileId}/multipart-uploads/${uploadId}/parts`, {
          token: owner.token,
          json: { parts: [{ partNumber: 7, sha256: partShas[6] }] },
        });
        expect(resigned.status).toBe(201);
        url = resigned.body.parts[0].url;
      }
      const res = await putPart(url, p.partNumber);
      expect(res.status).toBe(200);
      etags.push({ partNumber: p.partNumber, etag: res.headers.get('etag') as string });
    }

    const done = await call(DOCBEAM_URL, `/files/${fileId}/multipart-uploads/${uploadId}/complete`, {
      token: owner.token,
      json: { parts: etags },
    });
    expect(done.status).toBe(200);
    expect(done.body).toEqual({ fileId });
    const row = await fileRow(fileId);
    expect(row.s3_checksum).toMatch(/^[A-Za-z0-9+/]+=*-7$/);

    // Completing again gives the same answer and changes nothing.
    const repeat = await call(DOCBEAM_URL, `/files/${fileId}/multipart-uploads/${uploadId}/complete`, {
      token: owner.token,
      json: { parts: etags },
    });
    expect(repeat.status).toBe(200);
    expect((await fileRow(fileId)).s3_checksum).toBe(row.s3_checksum);
  }, 120_000);

  it('refuses a part whose bytes do not match its signed SHA-256', async () => {
    const { started } = await start();
    const bad = await putPart(started.body.parts[0].url, 1, Buffer.alloc(16 * MIB, 9));
    expect(bad.status).toBeGreaterThanOrEqual(400);
  }, 60_000);

  it('answers 422 MULTIPART_INCOMPLETE when a part is missing', async () => {
    const { fileId, started } = await start();
    const uploadId: string = started.body.uploadId;
    const first = await putPart(started.body.parts[0].url, 1);
    const reply = await call(DOCBEAM_URL, `/files/${fileId}/multipart-uploads/${uploadId}/complete`, {
      token: owner.token,
      json: { parts: [{ partNumber: 1, etag: first.headers.get('etag') }] },
    });
    expect(reply.status).toBe(422);
    expect(reply.body.error.code).toBe('MULTIPART_INCOMPLETE');
    expect((await fileRow(fileId)).s3_checksum).toBeNull();
  }, 60_000);

  it('gives another user the same 404 as for a file that does not exist', async () => {
    const { fileId, started } = await start();
    const uploadId: string = started.body.uploadId;
    const probes = [
      call(DOCBEAM_URL, `/files/${fileId}/multipart-uploads`, { token: other.token, json: { parts: [{ partNumber: 1, sha256: partShas[0] }] } }),
      call(DOCBEAM_URL, `/files/${fileId}/multipart-uploads/${uploadId}/parts`, { token: other.token, json: { parts: [{ partNumber: 1, sha256: partShas[0] }] } }),
      call(DOCBEAM_URL, `/files/${fileId}/multipart-uploads/${uploadId}/complete`, { token: other.token, json: { parts: [{ partNumber: 1, etag: 'x' }] } }),
      call(DOCBEAM_URL, `/files/${randomUUID()}/multipart-uploads`, { token: other.token, json: { parts: [{ partNumber: 1, sha256: partShas[0] }] } }),
    ];
    for (const reply of await Promise.all(probes)) {
      expect(reply.status).toBe(404);
      expect(reply.body.error.code).toBe('NOT_FOUND');
    }
  }, 60_000);

  it('refuses to start a multipart upload for a small file', async () => {
    const small = pdf('small');
    const created = await requestUploads(owner.token, [
      { name: 's.pdf', sizeBytes: small.length, contentType: 'application/pdf', sha256: sha(small) },
    ]);
    const reply = await call(DOCBEAM_URL, `/files/${created.body.uploads[0].fileId}/multipart-uploads`, {
      token: owner.token,
      json: { parts: [{ partNumber: 1, sha256: sha(small) }] },
    });
    expect(reply.status).toBe(400);
  });
});

describe('GET /files?ids=', () => {
  it('reports the state of the caller’s own files only', async () => {
    const data = pdf('state');
    const created = await requestUploads(owner.token, [
      { name: 's.pdf', sizeBytes: data.length, contentType: 'application/pdf', sha256: sha(data) },
    ]);
    const id: string = created.body.uploads[0].fileId;

    const mine = await call(DOCBEAM_URL, `/files?ids=${id},${randomUUID()}`, { token: owner.token });
    expect(mine.status).toBe(200);
    expect(mine.body).toEqual([{ fileId: id, uploaded: false, scanStatus: 'pending' }]);

    const theirs = await call(DOCBEAM_URL, `/files?ids=${id}`, { token: other.token });
    expect(theirs.status).toBe(200);
    expect(theirs.body).toEqual([]);
  });

  it.each([['missing', ''], ['not uuids', '?ids=abc'], ['101 ids', `?ids=${Array.from({ length: 101 }, () => randomUUID()).join(',')}`]])(
    'answers 400 when ids are %s',
    async (_label, query) => {
      const reply = await call(DOCBEAM_URL, `/files${query}`, { token: owner.token });
      expect(reply.status).toBe(400);
    },
  );
});
