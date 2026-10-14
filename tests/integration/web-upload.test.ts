import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emptyMapping, buildJobRequest, readiness, toggleDestination } from '../../web/src/distribute/mapping.js';
import { acceptFiles } from '../../web/src/distribute/files.js';
import type { UploadApi } from '../../web/src/upload/api-types.js';
import { hashFile } from '../../web/src/upload/hashing.js';
import { UploadManager, type PageFile } from '../../web/src/upload/manager.js';
import { TransportError, type Transport, type TransportResult } from '../../web/src/upload/transport.js';
import { AUTH_URL, call, DOCBEAM_URL, env, eventually } from './helpers.js';

// The web app's own upload queue (Step 2.6) run in Node against the Compose stack: real links, LocalStack, the real
// Upload Events Lambda with ClamAV, then POST /jobs and the deliveries. Only the browser's XMLHttpRequest and
// Web Worker are replaced (by fetch and a direct call).
const demo = JSON.parse(readFileSync(new URL('../../services/platform/seed/demo.json', import.meta.url), 'utf8'));
const cardio = demo.teams.find((t: { name: string }) => t.name === 'Cardio');
const binder = cardio.binders[0];
const folder = binder.folders[0];

let token = '';
let db: pg.Client;

beforeAll(async () => {
  db = new pg.Client({ connectionString: `postgres://postgres:${env.POSTGRES_PASSWORD}@localhost:5432/docbeam_db` });
  await db.connect();
  const login = await call(AUTH_URL, '/auth/login', { json: { email: 'priya.shah@example.com', password: env.SEED_USER_PASSWORD } });
  token = login.body.accessToken;
});
afterAll(() => db.end());

const api: UploadApi = {
  async requestUploads(files) {
    const r = await call(DOCBEAM_URL, '/uploads', { token, json: { files } });
    if (r.status !== 201) throw new Error(`POST /uploads ${r.status}`);
    return r.body.uploads;
  },
  async startMultipart(fileId, parts) {
    const r = await call(DOCBEAM_URL, `/files/${fileId}/multipart-uploads`, { token, json: { parts } });
    if (r.status !== 201) throw new Error(`start ${r.status}`);
    return r.body;
  },
  async resignParts(fileId, uploadId, parts) {
    return (await call(DOCBEAM_URL, `/files/${fileId}/multipart-uploads/${uploadId}/parts`, { token, json: { parts } })).body.parts;
  },
  async completeMultipart(fileId, uploadId, parts) {
    const r = await call(DOCBEAM_URL, `/files/${fileId}/multipart-uploads/${uploadId}/complete`, { token, json: { parts } });
    if (r.status !== 200) throw new Error(`complete ${r.status} ${JSON.stringify(r.body)}`);
  },
  async fileStates(ids) {
    return (await call(DOCBEAM_URL, `/files?ids=${ids.join(',')}`, { token })).body;
  },
};

const transport: Transport = {
  async post({ url, fields, file }): Promise<TransportResult> {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append('file', file);
    try {
      const res = await fetch(url, { method: 'POST', body: form });
      return { status: res.status, body: await res.text() };
    } catch (error) {
      throw new TransportError(String(error));
    }
  },
  async put({ url, body, sha256Base64 }): Promise<TransportResult> {
    try {
      const res = await fetch(url, { method: 'PUT', body, headers: { 'x-amz-checksum-sha256': sha256Base64 } });
      return { status: res.status, body: await res.text(), etag: res.headers.get('etag') ?? undefined };
    } catch (error) {
      throw new TransportError(String(error));
    }
  },
  async abort(url) {
    await fetch(url, { method: 'DELETE' }).catch(() => undefined);
  },
};

const pdf = (name: string, size: number): File => {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode(`%PDF-1.7\n% ${name} ${Math.random()}\n`));
  return new File([bytes], name, { type: 'application/pdf' });
};

describe('web upload queue against the Compose stack', () => {
  it('uploads a small file and a multipart file, verifies both, and sends them as one distribution', async () => {
    const manager = new UploadManager({ api, transport, hash: (file, multipart, onProgress) => hashFile(file, multipart, onProgress) });
    const picked = acceptFiles(0, [pdf('protocol.pdf', 5 * 1024), pdf('investigator-brochure.pdf', 101 * 1024 ** 2)]);
    expect(picked.rejected).toEqual([]);
    manager.add(picked.accepted);

    const seen = new Set<string>();
    manager.subscribe(() => manager.getSnapshot().forEach((f) => seen.add(`${f.name}:${f.status}`)));

    await eventually(() => manager.getSnapshot().every((f) => f.status === 'verified'), 120_000);
    // The 101 MiB file really went in parts, and was checked after the parts were joined.
    const big = manager.getSnapshot().find((f) => f.name === 'investigator-brochure.pdf') as PageFile;
    expect(big.partCount).toBe(7);
    expect(big.partsDone).toBe(7);
    expect(seen.has('investigator-brochure.pdf:uploading')).toBe(true);
    expect(seen.has('investigator-brochure.pdf:checking')).toBe(true);
    manager.dispose();

    // Map both files to one folder, with the same functions the page uses, then send.
    const files = [...manager.getSnapshot()];
    const destination = { binderId: binder.id as string, folderId: folder.id as string, path: 'Cardio / CARDIO-301 Regulatory / IRB approvals' };
    const ticked = toggleDestination(emptyMapping, files, new Set(), destination);
    expect(readiness(ticked.mapping, files).ready).toBe(true);
    const body = buildJobRequest(ticked.mapping, files);
    expect(body).not.toBeNull();

    const key = crypto.randomUUID();
    const sent = await call(DOCBEAM_URL, '/jobs', { token, headers: { 'idempotency-key': key }, json: body });
    expect(sent.status).toBe(201);
    expect(sent.body.taskCount).toBe(2);

    await eventually(async () => {
      const { rows } = await db.query('SELECT status FROM tasks WHERE job_id = $1', [sent.body.jobId]);
      return rows.length === 2 && rows.every((r) => r.status === 'completed') ? true : undefined;
    }, 120_000);
  }, 300_000);
});
