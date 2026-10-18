import { describe, expect, it } from 'vitest';
import { summariseFailureRate } from './failure-rate.js';

describe('summariseFailureRate', () => {
  it('counts only system failures against all tasks, apart from user failures, and leaves cancelled out', () => {
    const rate = summariseFailureRate(
      [
        { status: 'completed', failure_code: null, count: 990 },
        { status: 'failed', failure_code: 'RETRIES_EXHAUSTED', count: 1 },
        { status: 'failed', failure_code: 'FANOUT_FAILED', count: 1 },
        { status: 'failed', failure_code: 'NOT_AUTHORIZED_AT_DELIVERY', count: 5 },
        { status: 'failed', failure_code: 'CANCELLED', count: 50 },
        { status: 'pending', failure_code: null, count: 3 },
      ],
      7,
    );
    expect(rate).toMatchObject({ total: 1000, completed: 990, open: 3, systemFailures: 2, userFailures: 5, cancelled: 50, systemFailurePercent: 0.2 });
    expect(rate.byCode).toEqual({ RETRIES_EXHAUSTED: 1, FANOUT_FAILED: 1, NOT_AUTHORIZED_AT_DELIVERY: 5 });
  });

  it('reports 0 when there are no tasks', () => {
    expect(summariseFailureRate([], 7)).toMatchObject({ total: 0, systemFailurePercent: 0 });
  });
});
