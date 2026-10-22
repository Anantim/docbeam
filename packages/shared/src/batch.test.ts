import { describe, expect, it } from 'vitest';
import { type BatchInput, validateBatch } from './batch.js';
import { isMultipart, LIMITS, partCount } from './limits.js';

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const dest = (n: number) => ({ binderId: id(1000 + n), folderId: id(2000 + n) });

/** `files` files, each sent to the first `perFile` of `destinations` destinations. */
function batch(files: number, perFile: number, destinations = perFile): BatchInput {
  return {
    files: Array.from({ length: files }, (_, i) => ({ fileId: id(i) })),
    mappings: Array.from({ length: files }, (_, i) => ({
      fileId: id(i),
      destinations: Array.from({ length: Math.min(perFile, destinations) }, (_, d) => dest(d)),
    })),
  };
}

describe('validateBatch', () => {
  it('accepts the largest batch: 100 files x 20 destinations = 2,000 deliveries', () => {
    expect(validateBatch(batch(100, 20))).toEqual({ ok: true, taskCount: 2000, destinationCount: 20 });
  });

  it('refuses an empty batch', () => {
    expect(validateBatch({ files: [], mappings: [] })).toMatchObject({ ok: false });
  });

  it('never accepts a batch with no deliveries, however it is empty (D-F1-62)', () => {
    expect(validateBatch({ files: [{ fileId: id(1) }], mappings: [] })).toMatchObject({ ok: false }); // a file with no mapping
    expect(validateBatch({ files: [{ fileId: id(1) }], mappings: [{ fileId: id(1), destinations: [] }] })).toMatchObject({ ok: false }); // a mapping with no folder
    expect(validateBatch({ files: [], mappings: [{ fileId: id(1), destinations: [dest(1)] }] })).toMatchObject({ ok: false }); // folders but no file
  });

  it('refuses 101 files', () => {
    expect(validateBatch(batch(101, 1))).toMatchObject({ ok: false, reason: expect.stringContaining('100 files') });
  });

  it('refuses 21 distinct destinations', () => {
    const b = batch(21, 1);
    b.mappings.forEach((m, i) => {
      m.destinations = [dest(i)];
    });
    expect(validateBatch(b)).toMatchObject({ ok: false, reason: expect.stringContaining('20 destinations') });
  });

  it('refuses a file with no destination', () => {
    const b = batch(2, 1);
    b.mappings[1]!.destinations = [];
    expect(validateBatch(b)).toMatchObject({ ok: false });
  });

  it('refuses a file that is not mapped at all', () => {
    const b = batch(2, 1);
    b.mappings.pop();
    expect(validateBatch(b)).toMatchObject({ ok: false });
  });

  it('refuses a mapping for a file that is not in the batch', () => {
    const b = batch(1, 1);
    b.mappings.push({ fileId: id(99), destinations: [dest(0)] });
    expect(validateBatch(b)).toMatchObject({ ok: false });
  });

  it('refuses the same destination twice for one file', () => {
    const b = batch(1, 1);
    b.mappings[0]!.destinations.push(dest(0));
    expect(validateBatch(b)).toMatchObject({ ok: false, reason: expect.stringContaining('twice') });
  });

  it('treats two folders of one binder as different destinations', () => {
    const b = batch(1, 1);
    b.mappings[0]!.destinations.push({ binderId: id(1000), folderId: id(5) });
    expect(validateBatch(b)).toMatchObject({ ok: true, taskCount: 2, destinationCount: 2 });
  });

  it('refuses a destination with no folder: a binder is not a destination (D-F1-3)', () => {
    for (const folderId of [null, undefined, '']) {
      const b = batch(1, 1);
      b.mappings[0]!.destinations.push({ binderId: id(1000), folderId });
      expect(validateBatch(b)).toEqual({ ok: false, reason: "Choose a folder. Files can't go to a binder." });
    }
  });

  it('refuses a file listed twice', () => {
    const b = batch(1, 1);
    b.files.push({ fileId: id(0) });
    expect(validateBatch(b)).toMatchObject({ ok: false });
  });
});

describe('limits', () => {
  it('uses multipart only above 100 MiB', () => {
    expect(isMultipart(LIMITS.multipartThresholdBytes)).toBe(false);
    expect(isMultipart(LIMITS.multipartThresholdBytes + 1)).toBe(true);
  });

  it('cuts a 1 GiB file into 64 parts of 16 MiB', () => {
    expect(partCount(LIMITS.maxFileBytes)).toBe(64);
    expect(partCount(LIMITS.partBytes + 1)).toBe(2);
  });
});
