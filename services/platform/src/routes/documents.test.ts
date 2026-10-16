import { describe, expect, it } from 'vitest';
import { UPLOAD_BUFFER } from './documents.js';

describe('Platform File Store upload buffering (D-M2-22)', () => {
  const buffered = UPLOAD_BUFFER.queueSize * UPLOAD_BUFFER.partSize;

  it('holds at most one part per upload, so 50 uploads at once stay far below the task memory', () => {
    expect(UPLOAD_BUFFER.queueSize).toBe(1);
    expect(buffered).toBeLessThanOrEqual(8 * 1024 * 1024);
    // 50 is the Delivery cap (ADR-011). Their buffers alone must leave most of a 1 GB task free.
    expect(50 * buffered).toBeLessThan(0.3 * 1024 * 1024 * 1024);
  });

  it('keeps parts at the S3 minimum of 5 MiB or more', () => {
    expect(UPLOAD_BUFFER.partSize).toBeGreaterThanOrEqual(5 * 1024 * 1024);
  });
});
