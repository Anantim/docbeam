// Pushes can arrive out of order, so the page ignores one that is older than what it already shows, by
// `updatedAt` (TDD "WebSocket API"). The rules are here, apart from React, so they are easy to test.
import type { Counts, LiveMessage } from '../live/socket.js';
import type { JobStatus, TaskRow } from './api.js';

export interface CountsState {
  counts: Counts;
  /** `updatedAt` (ms) of the newest push or fetch the counts come from. */
  at: number;
}

const ms = (iso: string): number => new Date(iso).getTime();

/** The same rule as the API's "Job status" table, so a live push can change the chip without a fetch. */
export function statusFromCounts(counts: Counts, cancelled: boolean): JobStatus {
  const open = counts.pending + counts.in_progress;
  const total = open + counts.completed + counts.failed + counts.cancelled;
  if (open === 0 && cancelled) return 'cancelled';
  if (total === 0) return 'pending'; // nothing to deliver is never "Completed" (D-F1-62)
  if (open === 0) return counts.failed > 0 ? 'completed_with_errors' : 'completed';
  return counts.pending === total ? 'pending' : 'in_progress';
}

/** Counts from `GET /jobs/:id`, stamped with the server's own clock (`asOf`), so a browser clock cannot skew the order. */
export function countsFromFetch(counts: Counts, asOf: string): CountsState {
  return { counts, at: ms(asOf) };
}

/** New counts when the push is newer; the same state when it is older. */
export function applyCounts(state: CountsState, message: Pick<LiveMessage, 'counts' | 'updatedAt'>): CountsState {
  const at = ms(message.updatedAt);
  return at < state.at ? state : { counts: message.counts, at };
}

/** The row after a task push, or the same row when the push is not newer than the row. */
export function applyTaskUpdate(row: TaskRow, message: Extract<LiveMessage, { type: 'task_update' }>): TaskRow {
  if (row.taskId !== message.taskId || ms(message.updatedAt) <= ms(row.updatedAt)) return row;
  return {
    ...row,
    status: message.status,
    failureCode: message.failureCode ?? null,
    failureReason: message.failureReason ?? null,
    // A delivery that completed took at least one attempt, even if this push does not say how many.
    attemptCount: message.attemptCount ?? (message.status === 'completed' ? Math.max(row.attemptCount, 1) : row.attemptCount),
    updatedAt: message.updatedAt,
  };
}
