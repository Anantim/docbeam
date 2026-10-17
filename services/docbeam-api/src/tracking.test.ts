import { describe, expect, it } from 'vitest';
import { addCount, emptyCounts, fileExpired, pageOf, retryState, statusOf, totalOf } from './tracking.js';

const now = new Date('2026-10-16T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const base = { now, cancelled: false, retryable: 2, firstCompletedAt: null, oldestFileCreatedAt: hoursAgo(1) };

describe('statusOf (TDD job status table)', () => {
  const c = (pending: number, in_progress: number, completed: number, failed: number, cancelled = 0) => ({ pending, in_progress, completed, failed, cancelled });
  it.each([
    ['all pending', c(3, 0, 0, 0), false, 'pending'],
    ['some started', c(1, 1, 1, 0), false, 'in_progress'],
    ['all completed', c(0, 0, 3, 0), false, 'completed'],
    ['none open, one failed', c(0, 0, 2, 1), false, 'completed_with_errors'],
    ['cancelled and nothing open', c(0, 0, 2, 1), true, 'cancelled'],
    ['cancelled but one still running', c(0, 1, 1, 1), true, 'in_progress'],
    ['cancelled deliveries only, nothing open', c(0, 0, 2, 0, 3), true, 'cancelled'],
    ['cancelled deliveries still count toward the total while one runs', c(0, 1, 0, 0, 3), true, 'in_progress'],
  ])('%s', (_label, counts, cancelled, expected) => {
    expect(statusOf(counts, cancelled)).toBe(expected);
  });
});

describe('totalOf', () => {
  it('counts every kind, cancelled included', () => {
    expect(totalOf({ pending: 1, in_progress: 2, completed: 3, failed: 4, cancelled: 5 })).toBe(15);
  });
});

describe('addCount', () => {
  it('adds known statuses and ignores others', () => {
    const counts = emptyCounts();
    addCount(counts, 'completed', 4);
    addCount(counts, 'bogus', 9);
    addCount(counts, 'cancelled', 2);
    expect(counts).toEqual({ pending: 0, in_progress: 0, completed: 4, failed: 0, cancelled: 2 });
  });
});

describe('retryState (the retry window)', () => {
  it('is open while the job has not finished', () => {
    expect(retryState(base)).toEqual({ open: true });
  });
  it('is open 24 hours after the first finish and closed after', () => {
    expect(retryState({ ...base, firstCompletedAt: hoursAgo(24) })).toEqual({ open: true });
    expect(retryState({ ...base, firstCompletedAt: hoursAgo(24.01) })).toEqual({ open: false, reason: 'RETRY_WINDOW_CLOSED' });
  });
  it('is closed once a file is 2 days old', () => {
    expect(retryState({ ...base, oldestFileCreatedAt: hoursAgo(47.9) })).toEqual({ open: true });
    expect(retryState({ ...base, oldestFileCreatedAt: hoursAgo(48) })).toEqual({ open: false, reason: 'RETRY_WINDOW_CLOSED' });
  });
  it('is refused for a cancelled job before any other reason', () => {
    expect(retryState({ ...base, cancelled: true, retryable: 0, firstCompletedAt: hoursAgo(100) })).toEqual({
      open: false,
      reason: 'JOB_CANCELLED',
    });
  });
  it('has nothing to retry when no task qualifies', () => {
    expect(retryState({ ...base, retryable: 0 })).toEqual({ open: false, reason: 'NOTHING_TO_RETRY' });
  });
  it('reports a closed window before nothing-to-retry', () => {
    expect(retryState({ ...base, retryable: 0, firstCompletedAt: hoursAgo(30) })).toMatchObject({ reason: 'RETRY_WINDOW_CLOSED' });
  });
});

describe('fileExpired', () => {
  it('turns true after 33 days', () => {
    expect(fileExpired(hoursAgo(33 * 24 - 1), now)).toBe(false);
    expect(fileExpired(hoursAgo(33 * 24 + 1), now)).toBe(true);
  });
});

describe('pageOf', () => {
  it('starts at page 1 and uses the default limit', () => {
    expect(pageOf({}, 20, 100)).toEqual({ page: 1, limit: 20, offset: 0 });
  });
  it('cuts a too-large limit and works out the offset', () => {
    expect(pageOf({ page: '3', limit: '500' }, 20, 100)).toEqual({ page: 3, limit: 100, offset: 200 });
  });
  it('falls back on rubbish', () => {
    expect(pageOf({ page: 'x', limit: '-4' }, 20, 100)).toEqual({ page: 1, limit: 20, offset: 0 });
  });
});
