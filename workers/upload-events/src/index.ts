import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import {
  createLogger,
  createSecretReader,
  createVisibilityChanger,
  lambdaPoolConfig,
  type VisibilityChanger,
} from '@docbeam/shared';
import type { SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from 'aws-lambda';
import pg from 'pg';
import { parseUploadEvents } from './events.js';
import { type Deps, processUpload, retryDelaySeconds } from './process.js';
import { scannerFromEnv } from './scanner.js';

const log = createLogger('upload-events');

/** How long to wait for the API to record a completed multipart upload before looking again (D-G9). */
const WAIT_SECONDS = 30;

interface Runtime {
  deps: Deps;
  visibility: VisibilityChanger;
}

/**
 * The handler, with its dependencies supplied by a function so tests can pass fakes.
 * Consumer of the Upload Events Queue (ADR-016); returns the failed records (ReportBatchItemFailures).
 */
export function createHandler(runtime: () => Promise<Runtime>) {
  return async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
    const { deps, visibility } = await runtime();
    const failures: SQSBatchItemFailure[] = [];

    for (const record of event.Records) {
      const receiveCount = Number(record.attributes.ApproximateReceiveCount);
      try {
        let wait = false;
        for (const object of parseUploadEvents(record.body)) {
          if ((await processUpload(deps, object)) === 'wait') wait = true;
        }
        if (wait) {
          await visibility.change(record, WAIT_SECONDS);
          failures.push({ itemIdentifier: record.messageId });
        }
      } catch (error) {
        // The scanner or storage could not finish. Try again soon, not after the queue's 1-hour timeout.
        log.error('upload event failed', { messageId: record.messageId, receiveCount, error: String(error) });
        await visibility.change(record, retryDelaySeconds(receiveCount)).catch((e: unknown) => log.error('could not change visibility', { error: String(e) }));
        failures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures: failures };
  };
}

let cached: Promise<Runtime> | undefined;

/** Built once per cold start. Locally `.env` gives plain values; on AWS the database secret is read by ARN. */
function runtimeFromEnv(): Promise<Runtime> {
  cached ??= (async () => {
    const env = process.env;
    const secrets = createSecretReader(env);
    const aws = env.AWS_ENDPOINT_URL ? { endpoint: env.AWS_ENDPOINT_URL } : {};
    const s3 = new S3Client({ ...aws, ...(env.AWS_ENDPOINT_URL ? { forcePathStyle: true } : {}) });
    const pool = new pg.Pool(await lambdaPoolConfig(env, secrets));
    return {
      deps: { db: pool, s3, scanner: scannerFromEnv(env), log },
      visibility: createVisibilityChanger(new SQSClient(aws)),
    };
  })();
  return cached;
}

export const handler = createHandler(runtimeFromEnv);
