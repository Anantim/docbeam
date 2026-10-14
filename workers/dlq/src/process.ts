import {
  failPendingTasks,
  finishTask,
  parseUploadEvents,
  pushTaskUpdate,
  pushTaskUpdates,
  queueNameFromArn,
  type Connectable,
  type Logger,
  type Poster,
  type Queryable,
} from '@docbeam/shared';

export interface Deps {
  db: Queryable & Connectable;
  post: Poster | undefined;
  log: Logger;
}

export type DlqKind = 'job' | 'task' | 'upload';

/** The queue a record came from. Names end in the DLQ's own name, whatever the environment prefix is. */
export function kindOf(eventSourceArn: string): DlqKind | undefined {
  const name = queueNameFromArn(eventSourceArn);
  if (name.endsWith('-upload-events-dlq')) return 'upload';
  if (name.endsWith('-task-dlq')) return 'task';
  if (name.endsWith('-job-dlq')) return 'job';
  return undefined;
}

const bodyField = (body: string, field: string): string | undefined => {
  try {
    const value = (JSON.parse(body) as Record<string, unknown>)[field];
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
};

/**
 * A task whose messages ran out of attempts. Final unless another outcome got there first (the write is
 * conditional on the task still being open, so a late result never flips).
 */
async function taskDlq(deps: Deps, body: string): Promise<void> {
  const taskId = bodyField(body, 'taskId');
  if (!taskId) {
    deps.log.error('task dead letter has no task id');
    return;
  }
  const { rows } = await deps.db.query<{ job_id: string; last_error: string | null; destination_path: string | null; original_name: string }>(
    `SELECT t.job_id, t.last_error, t.destination_path, f.original_name
       FROM tasks t JOIN files f ON f.id = t.file_id WHERE t.id = $1`,
    [taskId],
  );
  const task = rows[0];
  if (!task) {
    deps.log.warn('task dead letter for an unknown task', { taskId });
    return;
  }
  const reason = `${task.original_name} to ${task.destination_path ?? 'the destination'}: The platform did not accept it after 5 attempts.${
    task.last_error ? ` Last error: ${task.last_error}` : ''
  }`;
  const finished = await finishTask(deps.db, {
    taskId,
    jobId: task.job_id,
    status: 'failed',
    failureCode: 'RETRIES_EXHAUSTED',
    failureReason: reason,
  });
  if (!finished) {
    deps.log.info('task dead letter: already final', { taskId });
    return;
  }
  deps.log.warn('task failed: retries exhausted', { taskId, jobId: task.job_id, jobClosed: finished.jobClosed });
  await pushTaskUpdate(deps, {
    jobId: task.job_id,
    taskId,
    teamId: finished.teamId,
    status: 'failed',
    failureCode: finished.failureCode,
    failureReason: finished.failureReason,
    updatedAt: finished.updatedAt,
  });
}

/** Fan-out failed three times: every task still pending is failed, so the job can finish. */
async function jobDlq(deps: Deps, body: string): Promise<void> {
  const jobId = bodyField(body, 'jobId');
  if (!jobId) {
    deps.log.error('job dead letter has no job id');
    return;
  }
  const result = await failPendingTasks(deps.db, {
    jobId,
    failureCode: 'FANOUT_FAILED',
    detail: 'The distribution could not be started. Retry the failed deliveries.',
  });
  deps.log.warn('job failed: fan-out exhausted', { jobId, tasks: result.tasks.length, jobClosed: result.jobClosed });
  await pushTaskUpdates(
    deps,
    jobId,
    result.tasks.map((t) => ({
      jobId,
      taskId: t.taskId,
      teamId: t.teamId,
      status: 'failed' as const,
      failureCode: 'FANOUT_FAILED' as const,
      failureReason: t.failureReason,
      updatedAt: t.updatedAt,
    })),
  );
}

/** A file whose upload events could not be handled: the page shows that it could not be checked. */
async function uploadDlq(deps: Deps, body: string): Promise<void> {
  for (const object of parseUploadEvents(body)) {
    const out = await deps.db.query(
      `UPDATE files SET scan_status = 'failed' WHERE id = $1 AND s3_key = $2 AND scan_status = 'pending'`,
      [object.fileId, object.key],
    );
    deps.log.warn('file could not be checked', { fileId: object.fileId, changed: out.rowCount });
  }
}

export async function processDeadLetter(deps: Deps, kind: DlqKind, body: string): Promise<void> {
  if (kind === 'task') return taskDlq(deps, body);
  if (kind === 'job') return jobDlq(deps, body);
  return uploadDlq(deps, body);
}
