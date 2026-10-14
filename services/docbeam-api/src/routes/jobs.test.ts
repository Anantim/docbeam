import { describe, expect, it } from 'vitest';
import { type FileState, firstFileProblem } from './jobs.js';

const now = new Date('2026-10-15T12:00:00Z');
const hex = (c: string) => c.repeat(64);

const file = (over: Partial<FileState> = {}): FileState => ({
  id: 'f1',
  ownerUserId: 'u1',
  jobId: null,
  checksumSha256: hex('a'),
  uploadedAt: new Date('2026-10-15T11:59:00Z'),
  scanStatus: 'clean',
  createdAt: new Date('2026-10-15T11:58:00Z'),
  ...over,
});
const wanted = [{ fileId: 'f1', sha256: hex('a') }];

describe('firstFileProblem', () => {
  it('accepts a confirmed, clean, unclaimed file with the declared fingerprint', () => {
    expect(firstFileProblem(wanted, [file()], 'u1', now)).toBeNull();
  });

  it('accepts an upper-case fingerprint from the browser', () => {
    expect(firstFileProblem([{ fileId: 'f1', sha256: hex('A') }], [file()], 'u1', now)).toBeNull();
  });

  it('treats a missing file and another user\'s file the same way', () => {
    const missing = firstFileProblem(wanted, [], 'u1', now);
    const theirs = firstFileProblem(wanted, [file({ ownerUserId: 'u2' })], 'u1', now);
    expect(missing).toMatchObject({ statusCode: 422, code: 'INVALID_BATCH' });
    expect(theirs?.message).toBe(missing?.message);
  });

  it('refuses a file uploaded more than 24 hours ago', () => {
    const old = file({ createdAt: new Date('2026-10-14T11:59:59Z') });
    expect(firstFileProblem(wanted, [old], 'u1', now)).toMatchObject({ statusCode: 422, code: 'FILE_TOO_OLD' });
    const edge = file({ createdAt: new Date('2026-10-14T12:00:00Z') }); // exactly 24 hours is still allowed
    expect(firstFileProblem(wanted, [edge], 'u1', now)).toBeNull();
  });

  it.each([
    ['not confirmed yet', { uploadedAt: null }],
    ['still pending', { scanStatus: 'pending' }],
    ['infected', { scanStatus: 'infected' }],
    ['could not be checked', { scanStatus: 'failed' }],
  ])('refuses a file that is %s with FILE_NOT_READY', (_label, over) => {
    expect(firstFileProblem(wanted, [file(over)], 'u1', now)).toMatchObject({ statusCode: 422, code: 'FILE_NOT_READY' });
  });

  it('answers 409 for a file that is in another job', () => {
    expect(firstFileProblem(wanted, [file({ jobId: 'j1' })], 'u1', now)).toMatchObject({
      statusCode: 409,
      code: 'FILE_ALREADY_SUBMITTED',
    });
  });

  it('refuses a fingerprint that differs from the declared one', () => {
    expect(firstFileProblem([{ fileId: 'f1', sha256: hex('b') }], [file()], 'u1', now)).toMatchObject({
      statusCode: 422,
      code: 'CHECKSUM_MISMATCH',
    });
  });

  it('reports the first problem in the order of the files', () => {
    const rows = [file({ id: 'f1' }), file({ id: 'f2', scanStatus: 'pending' }), file({ id: 'f3', jobId: 'j' })];
    const all = ['f1', 'f2', 'f3'].map((fileId) => ({ fileId, sha256: hex('a') }));
    expect(firstFileProblem(all, rows, 'u1', now)).toMatchObject({ code: 'FILE_NOT_READY' });
  });
});
