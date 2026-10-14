import {
  createLogger,
  createPoster,
  createSecretReader,
  lambdaPoolConfig,
} from '@docbeam/shared';
import type { SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from 'aws-lambda';
import pg from 'pg';
import { type Deps, kindOf, processDeadLetter } from './process.js';

const log = createLogger('dlq');

/**
 * Consumer of the Job DLQ, Task DLQ and Upload DLQ (ADR-014). A message that cannot be handled is
 * reported as failed, so it stays in its DLQ (kept 14 days) and is offered again; nothing is dropped.
 */
export function createHandler(runtime: () => Promise<Deps>) {
  return async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
    const deps = await runtime();
    const failures: SQSBatchItemFailure[] = [];

    for (const record of event.Records) {
      const kind = kindOf(record.eventSourceARN);
      deps.log.info('dead-letter message received', {
        messageId: record.messageId,
        source: record.eventSourceARN,
        kind,
        receiveCount: Number(record.attributes.ApproximateReceiveCount),
      });
      if (!kind) {
        deps.log.error('dead letter from an unknown queue', { source: record.eventSourceARN });
        failures.push({ itemIdentifier: record.messageId });
        continue;
      }
      try {
        await processDeadLetter(deps, kind, record.body);
      } catch (error) {
        deps.log.error('dead letter not handled', { messageId: record.messageId, kind, error: String(error) });
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
    const pool = new pg.Pool(await lambdaPoolConfig(env, createSecretReader(env)));
    const wsEndpoint = env.WS_MANAGEMENT_ENDPOINT;
    return {
      db: pool as unknown as Deps['db'],
      post: wsEndpoint ? createPoster(wsEndpoint) : undefined,
      log,
    };
  })();
  return cached;
}

export const handler = createHandler(depsFromEnv);
