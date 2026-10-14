import { AbortMultipartUploadCommand, DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';
import { SendMessageBatchCommand, SQSClient } from '@aws-sdk/client-sqs';
import { createLogger, createSecretReader, lambdaPoolConfig, type Logger } from '@docbeam/shared';
import pg from 'pg';

const log = createLogger('sweeper');

/** What an EventBridge Scheduler schedule sends: re-send every minute, clean up once a day (ADR-014). */
export interface SweeperEvent {
  task: 'resend' | 'cleanup';
}

export interface Deps {
  db: Pick<pg.Pool, 'query'>;
  sqs: Pick<SQSClient, 'send'>;
  s3: Pick<S3Client, 'send'>;
  jobQueueUrl: string;
  bucket: string;
  log: Logger;
}

/** A job that should have started fan-out two minutes after it was queued (ADR-014). */
const STALE = "interval '2 minutes'";
/** A run handles at most this many jobs; the next minute handles the rest. */
const RESEND_LIMIT = 100;
/** Unsubmitted files are refused after 24 hours, so the same age is safe to delete (Step 2.5). */
const CLEANUP_BATCH = 1000;
const CLEANUP_MAX_BATCHES = 20;

/**
 * Sends the job message again for jobs whose fan-out has not started. Fan-out is safe to repeat, so
 * a job that is already being handled is harmless. Returns the job ids it sent.
 */
export async function resend(deps: Deps): Promise<string[]> {
  const { rows } = await deps.db.query<{ id: string }>(
    `SELECT id FROM jobs
      WHERE fanned_out_at IS NULL AND completed_at IS NULL AND queued_at < now() - ${STALE}
      ORDER BY queued_at LIMIT ${RESEND_LIMIT}`,
  );
  for (let at = 0; at < rows.length; at += 10) {
    const entries = rows.slice(at, at + 10).map((r, i) => ({ Id: String(i), MessageBody: JSON.stringify({ jobId: r.id }) }));
    const out = await deps.sqs.send(new SendMessageBatchCommand({ QueueUrl: deps.jobQueueUrl, Entries: entries }));
    if (out.Failed && out.Failed.length > 0) {
      // The next run tries again: the jobs are still unstarted.
      throw new Error(`SQS refused ${out.Failed.length} of ${entries.length} job messages: ${out.Failed[0]?.Code ?? 'unknown'}`);
    }
  }
  if (rows.length > 0) deps.log.warn('job messages sent again', { jobs: rows.map((r) => r.id) });
  return rows.map((r) => r.id);
}

const isNoSuchUpload = (error: unknown): boolean => (error as { name?: string }).name === 'NoSuchUpload';

/**
 * Deletes files nobody submitted, and their objects. The delete is one conditional statement on the same
 * column submission checks, so a file is either claimed by a job or deleted, never both (D-M2-3).
 */
export async function cleanup(deps: Deps): Promise<{ files: number }> {
  let total = 0;
  for (let batch = 0; batch < CLEANUP_MAX_BATCHES; batch += 1) {
    const { rows } = await deps.db.query<{ s3_key: string; multipart_upload_id: string | null }>(
      `DELETE FROM files WHERE id IN (
         SELECT id FROM files WHERE job_id IS NULL AND created_at < now() - interval '24 hours' LIMIT ${CLEANUP_BATCH})
       RETURNING s3_key, multipart_upload_id`,
    );
    if (rows.length === 0) break;
    total += rows.length;

    for (const r of rows) {
      if (!r.multipart_upload_id) continue;
      try {
        await deps.s3.send(new AbortMultipartUploadCommand({ Bucket: deps.bucket, Key: r.s3_key, UploadId: r.multipart_upload_id }));
      } catch (error) {
        // Already completed or already aborted: nothing is open.
        if (!isNoSuchUpload(error)) throw error;
      }
    }
    await deps.s3.send(
      new DeleteObjectsCommand({ Bucket: deps.bucket, Delete: { Objects: rows.map((r) => ({ Key: r.s3_key })), Quiet: true } }),
    );
    if (rows.length < CLEANUP_BATCH) break;
  }
  if (total > 0) deps.log.info('unsubmitted files deleted', { files: total });
  return { files: total };
}

export function createHandler(runtime: () => Promise<Deps>) {
  return async function handler(event: SweeperEvent): Promise<void> {
    const deps = await runtime();
    deps.log.info('sweeper run', { task: event.task });
    if (event.task === 'resend') await resend(deps);
    else if (event.task === 'cleanup') await cleanup(deps);
    else throw new Error(`Unknown sweeper task: ${String((event as { task?: unknown }).task)}`);
  };
}

let cached: Promise<Deps> | undefined;

function depsFromEnv(): Promise<Deps> {
  cached ??= (async () => {
    const env = process.env;
    const need = (name: string): string => {
      const value = env[name];
      if (!value) throw new Error(`${name} is not set.`);
      return value;
    };
    const aws = env.AWS_ENDPOINT_URL ? { endpoint: env.AWS_ENDPOINT_URL } : {};
    return {
      db: new pg.Pool(await lambdaPoolConfig(env, createSecretReader(env))),
      sqs: new SQSClient(aws),
      s3: new S3Client({ ...aws, ...(env.AWS_ENDPOINT_URL ? { forcePathStyle: true } : {}) }),
      jobQueueUrl: need('JOB_QUEUE_URL'),
      bucket: need('OBJECT_STORE_BUCKET'),
      log,
    };
  })();
  return cached;
}

export const handler = createHandler(depsFromEnv);
