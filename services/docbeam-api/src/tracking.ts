// The rules for reading a job: counts, status, and when Retry and Cancel are open (TDD "Job status",
// the retry and cancel contracts). Pure functions, so the rules are tested without a database.
import { jobStatus, LIMITS, type JobStatus } from '@docbeam/shared';

/** Counts as the API and the pushes send them. */
export interface Counts {
  pending: number;
  in_progress: number;
  completed: number;
  /** Real failures only. */
  failed: number;
  /** Deliveries the sender cancelled (stored as failed with the code CANCELLED). */
  cancelled: number;
}

export const emptyCounts = (): Counts => ({ pending: 0, in_progress: 0, completed: 0, failed: 0, cancelled: 0 });

export function addCount(counts: Counts, status: string, n: number): void {
  if (status in counts) counts[status as keyof Counts] += n;
}

export function totalOf(counts: Counts): number {
  return counts.pending + counts.in_progress + counts.completed + counts.failed + counts.cancelled;
}

/** Job status is worked out when read, never stored. Cancelled wins once nothing is open. */
export function statusOf(counts: Counts, cancelled: boolean): JobStatus {
  return jobStatus(
    { pending: counts.pending, inProgress: counts.in_progress, completed: counts.completed, failed: counts.failed + counts.cancelled },
    cancelled,
  );
}

export interface RetryInput {
  now: Date;
  cancelled: boolean;
  /** Failed tasks with RETRIES_EXHAUSTED or FANOUT_FAILED. */
  retryable: number;
  /** Null while the job has never finished. */
  firstCompletedAt: Date | null;
  /** The oldest file of the job, by `files.created_at` (D-M2-3). Null when the job has no files. */
  oldestFileCreatedAt: Date | null;
}

export type RetryState =
  | { open: true }
  | { open: false; reason: 'JOB_CANCELLED' | 'RETRY_WINDOW_CLOSED' | 'NOTHING_TO_RETRY' };

/**
 * Retry is allowed while the job runs or within 24 hours of its first finish, and while all its files are
 * under 2 days old. A cancelled job never retries. The order of the reasons follows the contract's errors.
 */
export function retryState(input: RetryInput): RetryState {
  if (input.cancelled) return { open: false, reason: 'JOB_CANCELLED' };
  const afterWindow = input.firstCompletedAt !== null && input.now.getTime() - input.firstCompletedAt.getTime() > LIMITS.retryWindowMs;
  const filesTooOld =
    input.oldestFileCreatedAt !== null && input.now.getTime() - input.oldestFileCreatedAt.getTime() >= LIMITS.retryMaxFileAgeMs;
  if (afterWindow || filesTooOld) return { open: false, reason: 'RETRY_WINDOW_CLOSED' };
  if (input.retryable === 0) return { open: false, reason: 'NOTHING_TO_RETRY' };
  return { open: true };
}

/** A staged file is deleted 33 days after upload, so a download would fail (TDD "Retention"). */
export function fileExpired(uploadedOrCreatedAt: Date, now: Date): boolean {
  return now.getTime() - uploadedOrCreatedAt.getTime() > LIMITS.stagedFileDays * 24 * 60 * 60 * 1000;
}

/** `page` starts at 1. A missing or bad value falls back; a too-large limit is cut to the maximum. */
export function pageOf(
  query: { page?: unknown; limit?: unknown },
  fallback: number,
  max: number,
): { page: number; limit: number; offset: number } {
  const page = Math.max(1, Math.floor(Number(query.page)) || 1);
  const raw = Math.floor(Number(query.limit));
  const limit = Math.min(max, raw > 0 ? raw : fallback);
  return { page, limit, offset: (page - 1) * limit };
}
