// The delivery failure rate (blueprint success metric, TDD Launch plan "Monitoring").
// System failures (RETRIES_EXHAUSTED, FANOUT_FAILED) divided by all tasks that were not cancelled.
// Failures caused by the user's data or access are counted apart, and cancelled tasks are left out.
export const SYSTEM_FAILURE_CODES = ['RETRIES_EXHAUSTED', 'FANOUT_FAILED'] as const;

export interface TaskCountRow {
  status: string;
  failure_code: string | null;
  count: number;
}

export interface FailureRate {
  days: number;
  /** All tasks created in the window, cancelled ones left out. */
  total: number;
  completed: number;
  open: number;
  systemFailures: number;
  userFailures: number;
  cancelled: number;
  /** systemFailures / total, as a percentage. 0 when there are no tasks. */
  systemFailurePercent: number;
  /** Counts per failure code, for the report. */
  byCode: Record<string, number>;
}

/** Turns grouped counts (status, failure code) into the report. */
export function summariseFailureRate(rows: readonly TaskCountRow[], days: number): FailureRate {
  const out: FailureRate = {
    days,
    total: 0,
    completed: 0,
    open: 0,
    systemFailures: 0,
    userFailures: 0,
    cancelled: 0,
    systemFailurePercent: 0,
    byCode: {},
  };
  for (const { status, failure_code: code, count } of rows) {
    if (status === 'failed' && code === 'CANCELLED') {
      out.cancelled += count;
      continue;
    }
    out.total += count;
    if (status === 'completed') out.completed += count;
    else if (status === 'failed') {
      const key = code ?? 'UNKNOWN';
      out.byCode[key] = (out.byCode[key] ?? 0) + count;
      if ((SYSTEM_FAILURE_CODES as readonly string[]).includes(key)) out.systemFailures += count;
      else out.userFailures += count;
    } else out.open += count;
  }
  out.systemFailurePercent = out.total === 0 ? 0 : Math.round((out.systemFailures / out.total) * 1e6) / 1e4;
  return out;
}

/** The grouped counts, for tasks created in the last `days` days, or since `since` when it is given. */
export const FAILURE_RATE_SQL = `
  SELECT status, failure_code, count(*)::int AS count
    FROM tasks
   WHERE created_at >= COALESCE($2::timestamptz, now() - make_interval(days => $1::int))
   GROUP BY status, failure_code`;
