import { SendMessageBatchCommand, SQSClient } from '@aws-sdk/client-sqs';
import { createLogger, createSecretReader, lambdaPoolConfig, type Logger } from '@docbeam/shared';
import type { SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from 'aws-lambda';
import pg from 'pg';

const log = createLogger('fanout');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** SQS takes at most 10 messages in one SendMessageBatch call. */
const BATCH = 10;

export interface Deps {
  db: Pick<pg.Pool, 'query'>;
  sqs: Pick<SQSClient, 'send'>;
  taskQueueUrl: string;
  log: Logger;
}

/**
 * Sends one message per pending task of the job (ADR-008). Safe to repeat: a message for a task that already
 * finished stops at the delivery claim, and one for an open task is stored once by source_task_id.
 * Returns how many task messages it sent.
 */
export async function fanOut(deps: Deps, jobId: string): Promise<number> {
  // The sweeper watches this column. A retry clears it, so setting it again is correct.
  await deps.db.query('UPDATE jobs SET fanned_out_at = now() WHERE id = $1', [jobId]);

  const { rows } = await deps.db.query<{ id: string }>(
    `SELECT id FROM tasks WHERE job_id = $1 AND status = 'pending' ORDER BY created_at, id`,
    [jobId],
  );

  for (let at = 0; at < rows.length; at += BATCH) {
    const entries = rows.slice(at, at + BATCH).map((r, i) => ({ Id: String(i), MessageBody: JSON.stringify({ taskId: r.id }) }));
    const out = await deps.sqs.send(new SendMessageBatchCommand({ QueueUrl: deps.taskQueueUrl, Entries: entries }));
    // A partial send fails the job message, so SQS offers it again and the whole job is sent again.
    if (out.Failed && out.Failed.length > 0) {
      throw new Error(`SQS refused ${out.Failed.length} of ${entries.length} task messages: ${out.Failed[0]?.Code ?? 'unknown'}`);
    }
  }
  return rows.length;
}

/** The handler. Consumer of the Job Queue; returns the failed records (ReportBatchItemFailures). */
export function createHandler(runtime: () => Promise<Deps>) {
  return async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
    const deps = await runtime();
    const failures: SQSBatchItemFailure[] = [];

    for (const record of event.Records) {
      let jobId: unknown;
      try {
        jobId = (JSON.parse(record.body) as { jobId?: unknown }).jobId;
      } catch {
        jobId = undefined;
      }
      if (typeof jobId !== 'string' || !UUID.test(jobId)) {
        // A message that can never work is dropped, not retried three times for nothing.
        deps.log.error('job message has no job id', { messageId: record.messageId });
        continue;
      }
      try {
        const tasks = await fanOut(deps, jobId);
        deps.log.info('job fanned out', { jobId, tasks, receiveCount: Number(record.attributes.ApproximateReceiveCount) });
      } catch (error) {
        deps.log.error('fan-out failed', { jobId, messageId: record.messageId, error: String(error) });
        failures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures: failures };
  };
}

let cached: Promise<Deps> | undefined;

function depsFromEnv(): Promise<Deps> {
  cached ??= (async () => {
    const env = process.env;
    const taskQueueUrl = env.TASK_QUEUE_URL;
    if (!taskQueueUrl) throw new Error('TASK_QUEUE_URL is not set.');
    const pool = new pg.Pool(await lambdaPoolConfig(env, createSecretReader(env)));
    const sqs = new SQSClient(env.AWS_ENDPOINT_URL ? { endpoint: env.AWS_ENDPOINT_URL } : {});
    return { db: pool, sqs, taskQueueUrl, log };
  })();
  return cached;
}

export const handler = createHandler(depsFromEnv);
