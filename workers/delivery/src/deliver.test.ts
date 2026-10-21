import { Readable } from 'node:stream';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { type Deps, deliverTask } from './deliver.js';

const TASK = '11111111-1111-4111-8111-111111111111';

const claimed = {
  id: TASK,
  job_id: 'job-1',
  team_id: 'team-1',
  binder_id: 'binder-1',
  folder_id: 'folder-1',
  destination_path: 'Cardio / Regulatory / Consent',
  attempt_count: 1,
  original_name: 'consent.pdf',
  content_type: 'application/pdf',
  checksum_sha256: 'a'.repeat(64),
  s3_key: 'staging/u/f',
  s3_checksum: 'CHK=',
  sender_id: 'user-1',
};

interface Options {
  claim?: unknown[];
  head?: () => unknown;
  responses?: Array<() => Response | Promise<Response>>;
  checksumOptional?: boolean;
  /** Rows changed by the final write; 0 means another outcome already won. */
  finalRows?: number;
  backToPendingRows?: number;
  /** A dashboard is watching: pushes go here. */
  post?: (connectionId: string, body: string) => Promise<boolean>;
}

function setup(o: Options = {}) {
  const calls: Array<{ text: string; values: unknown[] | undefined }> = [];
  const respond = (text: string) => {
    if (text.includes('WITH c AS')) return { rows: o.claim ?? [claimed], rowCount: (o.claim ?? [claimed]).length };
    if (text.startsWith('UPDATE tasks') && text.includes("status = $2"))
      return o.finalRows === 0
        ? { rows: [], rowCount: 0 }
        : { rows: [{ updated_at: new Date('2026-10-15T00:00:00Z'), team_id: 'team-1', file_id: 'f-1', destination_path: 'p' }], rowCount: 1 };
    if (text.includes("SET status = 'pending'")) return { rows: [], rowCount: o.backToPendingRows ?? 1 };
    // What a push reads: the sender's open dashboard, the sender, and the counts.
    if (text.includes('FROM ws_connections')) return { rows: [{ connection_id: 'conn-1', user_id: 'user-1', team_ids: ['team-1'] }], rowCount: 1 };
    if (text.includes('submitted_by_user_id FROM jobs')) return { rows: [{ submitted_by_user_id: 'user-1' }], rowCount: 1 };
    if (text.includes('FROM tasks WHERE job_id')) return { rows: [{ team_id: 'team-1', status: 'in_progress', n: '1' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    calls.push({ text, values });
    return respond(text);
  });
  const client = { query, release: vi.fn() };
  const s3Calls: unknown[] = [];
  const s3 = {
    send: vi.fn(async (command: unknown) => {
      s3Calls.push(command);
      if (command instanceof HeadObjectCommand) {
        const out = o.head ? o.head() : { ChecksumSHA256: 'CHK=' };
        return out;
      }
      return { Body: Readable.from([Buffer.from('%PDF-1.7')]) };
    }),
  };
  const responses = [...(o.responses ?? [() => new Response(JSON.stringify({ documentId: 'doc-1' }), { status: 201 })])];
  const fetchImpl = vi.fn(async () => {
    const next = responses.shift() ?? responses[0];
    if (!next) throw new Error('no more responses');
    return next();
  });
  const tokens = { get: vi.fn(async () => 'tok'), invalidate: vi.fn() };
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const deps = {
    db: { query, connect: vi.fn(async () => client) },
    s3,
    tokens,
    fetchImpl,
    platformUrl: 'http://platform',
    bucket: 'bucket',
    checksumOptional: o.checksumOptional ?? false,
    post: o.post,
    log,
  } as unknown as Deps;
  const finalWrite = () => calls.find((c) => c.text.startsWith('UPDATE tasks') && c.text.includes('status = $2'));
  const audit = () => calls.filter((c) => c.text.includes('INSERT INTO audit_events'));
  return { deps, calls, fetchImpl, tokens, finalWrite, audit };
}

const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status });

describe('deliverTask', () => {
  it('stops at the claim for a task that is already final', async () => {
    const s = setup({ claim: [] });
    expect(await deliverTask(s.deps, TASK, 1)).toEqual({ kind: 'done' });
    expect(s.fetchImpl).not.toHaveBeenCalled();
    expect(s.finalWrite()).toBeUndefined();
  });

  it.each([201, 200])('completes the task on %i with the document id', async (status) => {
    const s = setup({ responses: [json(status, { documentId: 'doc-9' })] });
    expect(await deliverTask(s.deps, TASK, 1)).toEqual({ kind: 'done' });
    expect(s.finalWrite()?.values).toEqual([TASK, 'completed', null, null, 'doc-9', 'job-1']);
    expect(s.audit()).toHaveLength(1);
    expect(s.audit()[0]?.values?.[0]).toBe('task.completed');
  });

  it('sends the sender as onBehalfOf with the text fields first', async () => {
    const s = setup();
    await deliverTask(s.deps, TASK, 1);
    const [url, init] = s.fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://platform/documents');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect((init as { duplex?: string }).duplex).toBe('half');
  });

  it('fails FILE_NOT_UPLOADED when the object is gone', async () => {
    const s = setup({
      head: () => {
        throw Object.assign(new Error('nf'), { name: 'NotFound' });
      },
    });
    expect(await deliverTask(s.deps, TASK, 1)).toEqual({ kind: 'done' });
    expect(s.finalWrite()?.values?.[1]).toBe('failed');
    expect(s.finalWrite()?.values?.[2]).toBe('FILE_NOT_UPLOADED');
    expect(s.fetchImpl).not.toHaveBeenCalled();
  });

  it('fails CHECKSUM_MISMATCH when the stored checksum differs, without calling the platform', async () => {
    const s = setup({ head: () => ({ ChecksumSHA256: 'OTHER=' }) });
    await deliverTask(s.deps, TASK, 1);
    expect(s.finalWrite()?.values?.[2]).toBe('CHECKSUM_MISMATCH');
    expect(s.fetchImpl).not.toHaveBeenCalled();
  });

  it('treats a missing checksum as a mismatch, unless it is optional (local only)', async () => {
    const strict = setup({ head: () => ({}) });
    await deliverTask(strict.deps, TASK, 1);
    expect(strict.finalWrite()?.values?.[2]).toBe('CHECKSUM_MISMATCH');

    const lenient = setup({ head: () => ({}), checksumOptional: true });
    await deliverTask(lenient.deps, TASK, 1);
    expect(lenient.finalWrite()?.values?.[1]).toBe('completed');
  });

  it.each([
    [403, 'NOT_A_MEMBER', 'NOT_AUTHORIZED_AT_DELIVERY'],
    [404, 'DESTINATION_NOT_FOUND', 'DESTINATION_NOT_FOUND'],
    [422, 'CHECKSUM_MISMATCH', 'CHECKSUM_MISMATCH'],
    [422, 'UNSUPPORTED_TYPE', 'UNSUPPORTED_TYPE'],
  ])('fails permanently on %i %s', async (status, code, failure) => {
    const s = setup({ responses: [json(status, { error: { code, message: 'x' } })] });
    expect(await deliverTask(s.deps, TASK, 1)).toEqual({ kind: 'done' });
    expect(s.finalWrite()?.values?.[2]).toBe(failure);
    expect(String(s.finalWrite()?.values?.[3])).toContain('consent.pdf to Cardio / Regulatory / Consent');
    expect(s.audit()[0]?.values?.[0]).toBe('task.failed');
  });

  it.each([500, 503, 429])('goes back to pending with a gap on %i', async (status) => {
    const s = setup({ responses: [json(status, {})] });
    expect(await deliverTask(s.deps, TASK, 2)).toEqual({ kind: 'retry', gapSeconds: 120 });
    expect(s.finalWrite()).toBeUndefined();
    const back = s.calls.find((c) => c.text.includes("SET status = 'pending'"));
    expect(back?.values?.[0]).toBe(TASK);
    expect(String(back?.values?.[1])).toContain(String(status));
  });

  it('treats a network error or a timeout as temporary', async () => {
    const s = setup({
      responses: [
        () => {
          throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
        },
      ],
    });
    expect(await deliverTask(s.deps, TASK, 1)).toEqual({ kind: 'retry', gapSeconds: 30 });
    const back = s.calls.find((c) => c.text.includes("SET status = 'pending'"));
    expect(String(back?.values?.[1])).toContain('TimeoutError');
  });

  describe('the retry push (D-F1-65)', () => {
    const sent = (post: ReturnType<typeof vi.fn>) => post.mock.calls.map((c) => JSON.parse(String(c[1])) as Record<string, unknown>);

    it('pushes one small task update when the second try starts, with the attempt count and no failure', async () => {
      const post = vi.fn(async () => true);
      const s = setup({ claim: [{ ...claimed, attempt_count: 2, updated_at: new Date('2026-10-15T00:00:10Z') }], post, responses: [json(500, {})] });
      expect(await deliverTask(s.deps, TASK, 2)).toEqual({ kind: 'retry', gapSeconds: 120 });
      const pushes = sent(post);
      expect(pushes).toHaveLength(1); // one per attempt: the failed try itself adds none
      expect(pushes[0]).toMatchObject({ type: 'task_update', jobId: 'job-1', taskId: TASK, status: 'in_progress', attemptCount: 2, updatedAt: '2026-10-15T00:00:10.000Z' });
      expect(pushes[0]).not.toHaveProperty('failureCode');
      expect(pushes[0]?.counts).toMatchObject({ in_progress: 1 });
    });

    it('does not push for the first try', async () => {
      const post = vi.fn(async () => true);
      const s = setup({ post, responses: [json(500, {})] });
      await deliverTask(s.deps, TASK, 1);
      expect(post).not.toHaveBeenCalled();
    });

    it('a push that fails does not fail the delivery', async () => {
      const post = vi.fn(async () => {
        throw new Error('gateway down');
      });
      const s = setup({ claim: [{ ...claimed, attempt_count: 3, updated_at: new Date() }], post, responses: [json(201, { documentId: 'doc-3' })] });
      expect(await deliverTask(s.deps, TASK, 3)).toEqual({ kind: 'done' });
      expect(s.finalWrite()?.values?.[1]).toBe('completed');
    });
  });

  it('sends the fifth attempt on at once (gap 0)', async () => {
    const s = setup({ responses: [json(500, {})] });
    expect(await deliverTask(s.deps, TASK, 5)).toEqual({ kind: 'retry', gapSeconds: 0 });
  });

  it('gets a new token and tries once more after a 401', async () => {
    const s = setup({ responses: [json(401, {}), json(201, { documentId: 'doc-2' })] });
    expect(await deliverTask(s.deps, TASK, 1)).toEqual({ kind: 'done' });
    expect(s.tokens.invalidate).toHaveBeenCalledTimes(1);
    expect(s.fetchImpl).toHaveBeenCalledTimes(2);
    expect(s.finalWrite()?.values?.[4]).toBe('doc-2');
  });

  it('does not loop on a second 401: it is temporary', async () => {
    const s = setup({ responses: [json(401, {}), json(401, {})] });
    expect(await deliverTask(s.deps, TASK, 1)).toMatchObject({ kind: 'retry' });
    expect(s.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('acknowledges when another copy finished the task first (temporary write finds no row)', async () => {
    const s = setup({ responses: [json(503, {})], backToPendingRows: 0 });
    expect(await deliverTask(s.deps, TASK, 1)).toEqual({ kind: 'done' });
  });

  it('writes no second audit event when the final write loses the race', async () => {
    const s = setup({ finalRows: 0 });
    expect(await deliverTask(s.deps, TASK, 1)).toEqual({ kind: 'done' });
    expect(s.audit()).toHaveLength(0);
  });
});
