// The one place a task gets a final status (TDD Step 2.4). Delivery and the DLQ Consumer both call
// `finishTask`, so the job-row lock, the conditional write and the audit event always go together.
import type { FailureCode, JobStatus } from './constants.js';

/** What `pg.PoolClient` offers that these functions need. Keeps this package free of `pg`. */
export interface Queryable {
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }>;
}

export interface Connectable {
  connect(): Promise<Queryable & { release(): void }>;
}

export interface TaskCounts {
  pending: number;
  inProgress: number;
  completed: number;
  failed: number;
}

/** Job status is worked out when read, never stored (TDD "Job status"). */
export function jobStatus(counts: TaskCounts, cancelled: boolean): JobStatus {
  const open = counts.pending + counts.inProgress;
  if (open === 0 && cancelled) return 'cancelled';
  if (open === 0) return counts.failed > 0 ? 'completed_with_errors' : 'completed';
  const total = open + counts.completed + counts.failed;
  return counts.pending === total ? 'pending' : 'in_progress';
}

export interface FinishInput {
  taskId: string;
  jobId: string;
  status: 'completed' | 'failed';
  failureCode?: FailureCode;
  failureReason?: string;
  documentId?: string;
}

export interface FinishedTask {
  taskId: string;
  jobId: string;
  teamId: string;
  status: 'completed' | 'failed';
  failureCode?: FailureCode;
  failureReason?: string;
  updatedAt: Date;
  /** True when this write closed the job. */
  jobClosed: boolean;
}

export interface FailPendingInput {
  jobId: string;
  failureCode: FailureCode;
  /** Added after "<file name> to <destination>: ". */
  detail: string;
}

export interface FailedPendingResult {
  tasks: Array<{ taskId: string; teamId: string; failureReason: string; updatedAt: Date }>;
  jobClosed: boolean;
}

/**
 * Marks every task of a job that is still `pending` as failed, in one transaction under the job row lock,
 * with one `task.failed` audit event each (D-G13, Step 2.5). Tasks in progress are left to finish. Used by
 * the DLQ Consumer for a failed fan-out; the cancel route in M3 does the same with CANCELLED.
 */
export async function failPendingTasks(db: Connectable, input: FailPendingInput): Promise<FailedPendingResult> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT 1 FROM jobs WHERE id = $1 FOR UPDATE', [input.jobId]);

    const failed = await client.query<{
      id: string;
      team_id: string;
      file_id: string;
      destination_path: string | null;
      original_name: string;
      failure_reason: string;
      updated_at: Date;
    }>(
      `UPDATE tasks t
          SET status = 'failed', failure_code = $2, updated_at = now(),
              failure_reason = f.original_name || ' to ' || COALESCE(t.destination_path, 'the destination') || ': ' || $3
         FROM files f
        WHERE f.id = t.file_id AND t.job_id = $1 AND t.status = 'pending'
        RETURNING t.id, t.team_id, t.file_id, t.destination_path, f.original_name, t.failure_reason, t.updated_at`,
      [input.jobId, input.failureCode, input.detail],
    );

    if (failed.rows.length > 0) {
      await client.query(
        `INSERT INTO audit_events (actor_id, action, job_id, task_id, team_id, detail)
         SELECT NULL, 'task.failed', $1::uuid, a.task_id, a.team_id, a.detail::jsonb
           FROM unnest($2::uuid[], $3::uuid[], $4::text[]) AS a(task_id, team_id, detail)`,
        [
          input.jobId,
          failed.rows.map((r) => r.id),
          failed.rows.map((r) => r.team_id),
          failed.rows.map((r) =>
            JSON.stringify({
              fileId: r.file_id,
              fileName: r.original_name,
              destinationPath: r.destination_path,
              failureCode: input.failureCode,
              failureReason: r.failure_reason,
            }),
          ),
        ],
      );
    }

    const closed = await client.query(
      `UPDATE jobs
          SET completed_at = now(), first_completed_at = COALESCE(first_completed_at, now())
        WHERE id = $1 AND completed_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM tasks WHERE job_id = $1 AND status IN ('pending', 'in_progress'))`,
      [input.jobId],
    );
    await client.query('COMMIT');

    return {
      tasks: failed.rows.map((r) => ({ taskId: r.id, teamId: r.team_id, failureReason: r.failure_reason, updatedAt: r.updated_at })),
      jobClosed: (closed.rowCount ?? 0) > 0,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * One transaction: lock the job row, write the final status only if the task is still open, write the audit
 * event, and close the job if nothing is open. Returns null when another outcome already won, in which case
 * nothing was written and nothing should be pushed.
 */
export async function finishTask(db: Connectable, input: FinishInput): Promise<FinishedTask | null> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT 1 FROM jobs WHERE id = $1 FOR UPDATE', [input.jobId]);

    const updated = await client.query<{ updated_at: Date; team_id: string; file_id: string; destination_path: string | null }>(
      `UPDATE tasks
          SET status = $2, failure_code = $3, failure_reason = $4, platform_document_id = $5, updated_at = now()
        WHERE id = $1 AND job_id = $6 AND status IN ('pending', 'in_progress')
        RETURNING updated_at, team_id, file_id, destination_path`,
      [
        input.taskId,
        input.status,
        input.failureCode ?? null,
        input.failureReason ?? null,
        input.documentId ?? null,
        input.jobId,
      ],
    );
    const row = updated.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return null;
    }

    const file = await client.query<{ original_name: string }>('SELECT original_name FROM files WHERE id = $1', [row.file_id]);
    const detail =
      input.status === 'completed'
        ? { fileId: row.file_id, fileName: file.rows[0]?.original_name, destinationPath: row.destination_path, documentId: input.documentId }
        : {
            fileId: row.file_id,
            fileName: file.rows[0]?.original_name,
            destinationPath: row.destination_path,
            failureCode: input.failureCode,
            failureReason: input.failureReason,
          };
    await client.query(
      `INSERT INTO audit_events (actor_id, action, job_id, task_id, team_id, detail)
       VALUES (NULL, $1, $2, $3, $4, $5::jsonb)`,
      [input.status === 'completed' ? 'task.completed' : 'task.failed', input.jobId, input.taskId, row.team_id, JSON.stringify(detail)],
    );

    const closed = await client.query(
      `UPDATE jobs
          SET completed_at = now(), first_completed_at = COALESCE(first_completed_at, now())
        WHERE id = $1 AND completed_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM tasks WHERE job_id = $1 AND status IN ('pending', 'in_progress'))`,
      [input.jobId],
    );
    await client.query('COMMIT');

    return {
      taskId: input.taskId,
      jobId: input.jobId,
      teamId: row.team_id,
      status: input.status,
      ...(input.failureCode ? { failureCode: input.failureCode } : {}),
      ...(input.failureReason ? { failureReason: input.failureReason } : {}),
      updatedAt: row.updated_at,
      jobClosed: (closed.rowCount ?? 0) > 0,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
