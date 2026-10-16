import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import {
  createLogger,
  createPoster,
  createSecretReader,
  createServiceTokenClient,
  createVisibilityChanger,
  lambdaPoolConfig,
  type VisibilityChanger,
} from '@docbeam/shared';
import type { SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from 'aws-lambda';
import pg from 'pg';
import { type Deps, deliverTask } from './deliver.js';
import { retryGapSeconds } from './classify.js';

const log = createLogger('delivery');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Runtime {
  deps: Deps;
  visibility: VisibilityChanger;
}

/**
 * Consumer of the Task Queue (ADR-005). Returns the IDs of failed records so SQS retries only those
 * (ReportBatchItemFailures). A temporary error hides the message for the gap in TDD Step 2.4 first.
 */
export function createHandler(runtime: () => Promise<Runtime>) {
  return async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
    const { deps, visibility } = await runtime();
    const failures: SQSBatchItemFailure[] = [];

    for (const record of event.Records) {
      const receiveCount = Number(record.attributes.ApproximateReceiveCount);
      let taskId: unknown;
      try {
        taskId = (JSON.parse(record.body) as { taskId?: unknown }).taskId;
      } catch {
        taskId = undefined;
      }
      if (typeof taskId !== 'string' || !UUID.test(taskId)) {
        // A message that can never work is dropped, not retried five times for nothing.
        deps.log.error('task message has no task id', { messageId: record.messageId });
        continue;
      }

      let gap: number | undefined;
      try {
        const result = await deliverTask(deps, taskId, receiveCount);
        if (result.kind === 'retry') gap = result.gapSeconds;
      } catch (error) {
        // The database or the queue failed outside the delivery itself. Try again like a temporary error.
        deps.log.error('delivery failed', { taskId, messageId: record.messageId, receiveCount, error: String(error) });
        gap = retryGapSeconds(receiveCount);
      }
      if (gap !== undefined) {
        await visibility.change(record, gap).catch((e: unknown) => deps.log.error('could not change visibility', { error: String(e) }));
        failures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures: failures };
  };
}

let cached: Promise<Runtime> | undefined;

/** Built once per cold start. Locally `.env` gives plain values; on AWS secrets are read by ARN (D-M2-5). */
function runtimeFromEnv(): Promise<Runtime> {
  cached ??= (async () => {
    const env = process.env;
    const need = (name: string): string => {
      const value = env[name];
      if (!value) throw new Error(`${name} is not set.`);
      return value;
    };
    const secrets = createSecretReader(env);
    const aws = env.AWS_ENDPOINT_URL ? { endpoint: env.AWS_ENDPOINT_URL } : {};
    const pool = new pg.Pool(await lambdaPoolConfig(env, secrets));
    const wsEndpoint = env.WS_MANAGEMENT_ENDPOINT;
    if (!wsEndpoint) log.info('WS_MANAGEMENT_ENDPOINT is not set; no pushes');

    const deps: Deps = {
      db: pool as unknown as Deps['db'],
      s3: new S3Client({ ...aws, ...(env.AWS_ENDPOINT_URL ? { forcePathStyle: true } : {}) }),
      tokens: createServiceTokenClient({
        authUrl: need('AUTH_URL'),
        clientId: 'delivery-worker',
        clientSecret: () => secrets.readField('CLIENT_SECRET_DELIVERY_WORKER', 'client_secret'),
        scope: 'documents:ingest',
      }),
      fetchImpl: fetch,
      platformUrl: need('PLATFORM_URL'),
      bucket: need('OBJECT_STORE_BUCKET'),
      checksumOptional: env.S3_CHECKSUM_OPTIONAL === 'true',
      post: wsEndpoint ? createPoster(wsEndpoint) : undefined,
      log,
    };
    return { deps, visibility: createVisibilityChanger(new SQSClient(aws)) };
  })();
  return cached;
}

export const handler = createHandler(runtimeFromEnv);
