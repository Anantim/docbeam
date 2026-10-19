import { describe, expect, it, vi } from 'vitest';
import { ApiFailure } from '../auth/errors.js';
import type { JobBody } from './mapping.js';
import { Submission } from './submit.js';

const body = (extra = ''): JobBody => ({
  files: [{ fileId: `f1${extra}`, sha256: 'a'.repeat(64) }],
  mappings: [{ fileId: `f1${extra}`, destinations: [{ binderId: 'b1', folderId: 'f1' }] }],
});
const describeIt = (binderId: string, folderId: string | null) => `${binderId}/${folderId ?? 'top'}`;

describe('Submission', () => {
  it('sends the batch with an Idempotency-Key and returns the job', async () => {
    const send = vi.fn(async () => ({ jobId: 'job-1', taskCount: 3 }));
    const s = new Submission(send, () => 'key-1');
    const out = await s.submit(body(), describeIt);
    expect(out).toEqual({ ok: true, jobId: 'job-1', taskCount: 3 });
    expect(send).toHaveBeenCalledWith(body(), 'key-1');
  });

  it('reuses the same key after 503 PLATFORM_UNAVAILABLE', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new ApiFailure(503, 'down', 'PLATFORM_UNAVAILABLE'))
      .mockResolvedValueOnce({ jobId: 'job-1', taskCount: 1 });
    let n = 0;
    const s = new Submission(send, () => `key-${++n}`);
    const first = await s.submit(body(), describeIt);
    expect(first).toEqual({ ok: false, message: 'The platform is not answering. Try again.' });
    expect((await s.submit(body(), describeIt)).ok).toBe(true);
    expect(send.mock.calls.map((c) => c[1])).toEqual(['key-1', 'key-1']);
  });

  it('reuses the same key after a dropped connection', async () => {
    const send = vi.fn().mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce({ jobId: 'j', taskCount: 1 });
    let n = 0;
    const s = new Submission(send, () => `key-${++n}`);
    expect((await s.submit(body(), describeIt)).ok).toBe(false);
    await s.submit(body(), describeIt);
    expect(send.mock.calls.map((c) => c[1])).toEqual(['key-1', 'key-1']);
  });

  it('makes a new key when the batch changed, and after a success', async () => {
    const send = vi.fn().mockRejectedValueOnce(new ApiFailure(503, 'down', 'PLATFORM_UNAVAILABLE')).mockResolvedValue({ jobId: 'j', taskCount: 1 });
    let n = 0;
    const s = new Submission(send, () => `key-${++n}`);
    await s.submit(body(), describeIt);
    await s.submit(body('-changed'), describeIt);
    await s.submit(body('-changed'), describeIt);
    expect(send.mock.calls.map((c) => c[1])).toEqual(['key-1', 'key-2', 'key-3']);
  });

  it('names the destinations that were not found', async () => {
    const send = vi.fn().mockRejectedValue(
      new ApiFailure(422, 'Some destinations were not found.', 'DESTINATION_NOT_FOUND', {
        notFound: [{ binderId: 'b9', folderId: 'f9' }, { binderId: 'b8', folderId: null }],
      }),
    );
    const out = await new Submission(send).submit(body(), describeIt);
    expect(out).toEqual({ ok: false, message: 'These destinations were not found or are not in your teams: b9/f9, b8/top.' });
  });

  it('shows the API message for any other refusal', async () => {
    const send = vi.fn().mockRejectedValue(new ApiFailure(409, 'A file is already part of another distribution.', 'FILE_ALREADY_SUBMITTED'));
    const out = await new Submission(send).submit(body(), describeIt);
    expect(out).toEqual({ ok: false, message: 'A file is already part of another distribution.' });
  });
});
