// Pushes can arrive out of order, so the page ignores one that is older than what it already shows, by
// `updatedAt` (TDD "WebSocket API"). The rules are here, apart from React, so they are easy to test.
import type { Counts, LiveMessage } from '../live/socket.js';
import type { TaskRow } from './api.js';

export interface CountsState {
  counts: Counts;
  /** `updatedAt` (ms) of the newest push or fetch the counts come from. */
  at: number;
}

const ms = (iso: string): number => new Date(iso).getTime();

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
    updatedAt: message.updatedAt,
  };
}
