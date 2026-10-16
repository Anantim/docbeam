import { describe, expect, it } from 'vitest';
import type { LiveMessage } from '../live/socket.js';
import type { TaskRow } from './api.js';
import { applyCounts, applyTaskUpdate, countsFromFetch, statusFromCounts } from './apply.js';

describe('statusFromCounts', () => {
  const c = (pending: number, in_progress: number, completed: number, failed: number) => ({ pending, in_progress, completed, failed });
  it.each([
    [c(3, 0, 0, 0), false, 'pending'],
    [c(1, 1, 1, 0), false, 'in_progress'],
    [c(0, 0, 3, 0), false, 'completed'],
    [c(0, 0, 2, 1), false, 'completed_with_errors'],
    [c(0, 0, 2, 1), true, 'cancelled'],
    [c(0, 1, 2, 1), true, 'in_progress'],
  ])('%j cancelled=%s is %s', (counts, cancelled, expected) => {
    expect(statusFromCounts(counts, cancelled)).toBe(expected);
  });
});

const counts = (completed: number, pending = 0) => ({ pending, in_progress: 0, completed, failed: 0 });
const row: TaskRow = {
  taskId: 't1',
  fileId: 'f1',
  fileName: 'a.pdf',
  destinationPath: 'Cardio / Reg',
  teamId: 'team',
  status: 'pending',
  attemptCount: 0,
  failureCode: null,
  failureReason: null,
  updatedAt: '2026-10-16T10:00:00.000Z',
  fileExpired: false,
};
const failed = (updatedAt: string): Extract<LiveMessage, { type: 'task_update' }> => ({
  type: 'task_update',
  jobId: 'j',
  taskId: 't1',
  status: 'failed',
  failureCode: 'CHECKSUM_MISMATCH',
  failureReason: 'a.pdf to Cardio / Reg: the checksum differs',
  updatedAt,
  counts: counts(0),
});

describe('applyTaskUpdate', () => {
  it('takes a newer push: status, code and reason', () => {
    const out = applyTaskUpdate(row, failed('2026-10-16T10:00:05.000Z'));
    expect(out).toMatchObject({ status: 'failed', failureCode: 'CHECKSUM_MISMATCH', updatedAt: '2026-10-16T10:00:05.000Z' });
    expect(out.failureReason).toContain('checksum');
  });

  it('ignores a push that is older than, or the same as, the row', () => {
    expect(applyTaskUpdate(row, failed('2026-10-16T09:59:59.000Z'))).toBe(row);
    expect(applyTaskUpdate(row, failed('2026-10-16T10:00:00.000Z'))).toBe(row);
  });

  it('keeps a newer result when an older push arrives later', () => {
    const newer = applyTaskUpdate(row, { ...failed('2026-10-16T10:00:09.000Z'), status: 'completed' });
    const after = applyTaskUpdate(newer, failed('2026-10-16T10:00:03.000Z'));
    expect(after.status).toBe('completed');
  });

  it('ignores a push for another task', () => {
    expect(applyTaskUpdate(row, { ...failed('2026-10-16T10:00:05.000Z'), taskId: 'other' })).toBe(row);
  });
});

describe('applyCounts', () => {
  const start = countsFromFetch(counts(2, 8), '2026-10-16T10:00:00.000Z');

  it('takes the counts of a newer push', () => {
    const next = applyCounts(start, { counts: counts(3, 7), updatedAt: '2026-10-16T10:00:01.000Z' });
    expect(next.counts).toEqual(counts(3, 7));
  });

  it('ignores the counts of a push older than what the page shows', () => {
    const newer = applyCounts(start, { counts: counts(5, 5), updatedAt: '2026-10-16T10:00:05.000Z' });
    const stale = applyCounts(newer, { counts: counts(3, 7), updatedAt: '2026-10-16T10:00:02.000Z' });
    expect(stale).toBe(newer);
  });

  it('ignores a push older than the fetch it follows', () => {
    expect(applyCounts(start, { counts: counts(1, 9), updatedAt: '2026-10-16T09:59:59.000Z' })).toBe(start);
  });
});
