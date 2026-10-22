import { GetObjectCommand, HeadObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import {
  FAILURE_REASON,
  finishTask,
  pushTaskUpdate,
  type Connectable,
  type FailureCode,
  type Logger,
  type Poster,
  type Queryable,
  type ServiceTokenClient,
} from '@docbeam/shared';
import type { Readable } from 'node:stream';
import { classifyPlatformAnswer, retryGapSeconds, type PlatformOutcome } from './classify.js';
import { buildMultipart } from './multipart.js';

/** The platform call gives up before the Lambda's own 120 s, so a slow platform is a normal temporary error. */
export const PLATFORM_TIMEOUT_MS = 100_000;

export interface Deps {
  db: Queryable & Connectable;
  s3: Pick<S3Client, 'send'>;
  tokens: Pick<ServiceTokenClient, 'get' | 'invalidate'>;
  fetchImpl: typeof fetch;
  platformUrl: string;
  bucket: string;
  /** Local only (D-M2-15): LocalStack stores no checksum for a presigned POST. Never set on AWS. */
  checksumOptional: boolean;
  post: Poster | undefined;
  log: Logger;
}

interface ClaimedTask {
  id: string;
  job_id: string;
  team_id: string;
  binder_id: string;
  folder_id: string | null;
  destination_path: string | null;
  attempt_count: number;
  updated_at: Date;
  original_name: string;
  content_type: string;
  checksum_sha256: string;
  s3_key: string;
  s3_checksum: string | null;
  sender_id: string;
}

export type DeliveryResult = { kind: 'done' } | { kind: 'retry'; gapSeconds: number };

/**
 * Claim and read the task in one statement. A task that is already final returns no row (TDD Step 2.4),
 * so a repeated or late message stops here.
 */
async function claim(db: Queryable, taskId: string): Promise<ClaimedTask | undefined> {
  const { rows } = await db.query<ClaimedTask>(
    `WITH c AS (
       UPDATE tasks SET status = 'in_progress', attempt_count = attempt_count + 1, updated_at = now()
        WHERE id = $1 AND status IN ('pending', 'in_progress')
        RETURNING id, job_id, file_id, team_id, binder_id, folder_id, destination_path, attempt_count, updated_at)
     SELECT c.id, c.job_id, c.team_id, c.binder_id, c.folder_id, c.destination_path, c.attempt_count, c.updated_at,
            f.original_name, f.content_type, f.checksum_sha256, f.s3_key, f.s3_checksum,
            j.submitted_by_user_id AS sender_id
       FROM c JOIN files f ON f.id = c.file_id JOIN jobs j ON j.id = c.job_id`,
    [taskId],
  );
  return rows[0];
}

const isNotFound = (error: unknown): boolean => {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404;
};

async function sendToPlatform(deps: Deps, task: ClaimedTask): Promise<Response> {
  const attempt = async (): Promise<Response> => {
    const object = await deps.s3.send(new GetObjectCommand({ Bucket: deps.bucket, Key: task.s3_key }));
    const fields: Array<[string, string]> = [
      ['taskId', task.id],
      ['binderId', task.binder_id],
      ...(task.folder_id ? ([['folderId', task.folder_id]] as Array<[string, string]>) : []),
      ['name', task.original_name],
      ['contentType', task.content_type],
      ['checksumSha256', task.checksum_sha256],
      ['onBehalfOf', task.sender_id],
    ];
    const { body, contentType } = buildMultipart(fields, {
      fieldName: 'file',
      fileName: task.original_name,
      contentType: task.content_type,
      stream: object.Body as Readable,
    });
    try {
      return await deps.fetchImpl(`${deps.platformUrl}/documents`, {
        method: 'POST',
        headers: { authorization: `Bearer ${await deps.tokens.get()}`, 'content-type': contentType },
        // Node's fetch needs `duplex` for a streamed request body.
        body: body as unknown as RequestInit['body'],
        duplex: 'half',
        signal: AbortSignal.timeout(PLATFORM_TIMEOUT_MS),
      } as RequestInit);
    } finally {
      body.destroy();
      (object.Body as Readable).destroy();
    }
  };

  const first = await attempt();
  if (first.status !== 401) return first;
  // The token was rejected: get a new one and try again at once, once.
  await first.body?.cancel().catch(() => undefined);
  deps.tokens.invalidate();
  return attempt();
}

async function outcomeFromResponse(res: Response): Promise<PlatformOutcome> {
  const body = (await res.json().catch(() => null)) as { documentId?: string; error?: { code?: string } } | null;
  return classifyPlatformAnswer(res.status, body?.error?.code, body?.documentId);
}

async function finishAndPush(
  deps: Deps,
  task: ClaimedTask,
  result: { status: 'completed'; documentId: string } | { status: 'failed'; code: FailureCode; reason: string },
): Promise<void> {
  const finished = await finishTask(deps.db, {
    taskId: task.id,
    jobId: task.job_id,
    status: result.status,
    ...(result.status === 'completed'
      ? { documentId: result.documentId }
      : { failureCode: result.code, failureReason: result.reason }),
  });
  if (!finished) {
    deps.log.info('task already final', { taskId: task.id });
    return;
  }
  deps.log.info(result.status === 'completed' ? 'task delivered' : 'task failed', {
    taskId: task.id,
    jobId: task.job_id,
    ...(result.status === 'failed' ? { failureCode: result.code } : {}),
    attempt: task.attempt_count,
  });
  await pushTaskUpdate(
    { db: deps.db, post: deps.post, log: deps.log },
    {
      jobId: task.job_id,
      taskId: task.id,
      teamId: task.team_id,
      status: finished.status,
      failureCode: finished.failureCode,
      failureReason: finished.failureReason,
      updatedAt: finished.updatedAt,
      attemptCount: finished.attemptCount,
    },
  );
}

/** Sends the task back to pending with the latest error. Returns false when another copy already finished it. */
async function backToPending(db: Queryable, taskId: string, lastError: string): Promise<boolean> {
  const out = await db.query(
    `UPDATE tasks SET status = 'pending', last_error = $2, updated_at = now() WHERE id = $1 AND status = 'in_progress'`,
    [taskId, lastError.slice(0, 1000)],
  );
  return (out.rowCount ?? 0) > 0;
}

/**
 * One delivery (TDD Step 2.4). Returns `retry` with the gap to wait when the error is temporary; every
 * other outcome is final and the message can be deleted.
 */
export async function deliverTask(deps: Deps, taskId: string, receiveCount: number): Promise<DeliveryResult> {
  const task = await claim(deps.db, taskId);
  if (!task) {
    deps.log.info('task already final; message dropped', { taskId });
    return { kind: 'done' };
  }
  // A delivery that starts its second try or a later one tells the dashboards (D-F1-65): the "Retrying" chip and the counts change
  // live. One small push per attempt, never for the first try (nothing is different yet) and never able to fail the delivery.
  if (task.attempt_count >= 2) {
    await pushTaskUpdate(
      { db: deps.db, post: deps.post, log: deps.log },
      { jobId: task.job_id, taskId: task.id, teamId: task.team_id, status: 'in_progress', updatedAt: task.updated_at, attemptCount: task.attempt_count },
    );
  }
  const where = `${task.original_name} to ${task.destination_path ?? 'the destination'}`;
  const fail = (code: FailureCode, detail: string) =>
    ({ status: 'failed', code, reason: `${where}: ${detail}` }) as const;

  let temporary: string;
  try {
    let head;
    try {
      head = await deps.s3.send(new HeadObjectCommand({ Bucket: deps.bucket, Key: task.s3_key, ChecksumMode: 'ENABLED' }));
    } catch (error) {
      if (!isNotFound(error)) throw error;
      await finishAndPush(deps, task, fail('FILE_NOT_UPLOADED', FAILURE_REASON.FILE_NOT_UPLOADED));
      return { kind: 'done' };
    }

    // On AWS every staged object has a checksum. Without one it is not trusted (D-M2-15).
    const stored = head.ChecksumSHA256;
    const missing = stored === undefined && !deps.checksumOptional;
    if (missing || (stored !== undefined && stored !== task.s3_checksum)) {
      await finishAndPush(deps, task, fail('CHECKSUM_MISMATCH', FAILURE_REASON.CHECKSUM_MISMATCH));
      return { kind: 'done' };
    }

    const outcome = await outcomeFromResponse(await sendToPlatform(deps, task));
    if (outcome.kind === 'completed') {
      await finishAndPush(deps, task, { status: 'completed', documentId: outcome.documentId });
      return { kind: 'done' };
    }
    if (outcome.kind === 'permanent') {
      await finishAndPush(deps, task, fail(outcome.code, outcome.detail));
      return { kind: 'done' };
    }
    temporary = outcome.detail;
  } catch (error) {
    temporary = `${(error as { name?: string }).name ?? 'Error'}: ${(error as Error).message}`;
  }

  const stillOpen = await backToPending(deps.db, task.id, temporary);
  if (!stillOpen) {
    deps.log.info('task finished by another copy', { taskId });
    return { kind: 'done' };
  }
  deps.log.warn('temporary delivery error', { taskId, attempt: task.attempt_count, receiveCount, error: temporary });
  return { kind: 'retry', gapSeconds: retryGapSeconds(receiveCount) };
}
