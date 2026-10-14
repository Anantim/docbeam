import { createLogger } from '@docbeam/shared';
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';

const log = createLogger('fanout');

/**
 * Consumer of the Job Queue.
 * Returns the IDs of failed records so SQS retries only those (ReportBatchItemFailures).
 */
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  for (const record of event.Records) {
    log.info('job message received', {
      messageId: record.messageId,
      source: record.eventSourceARN,
      receiveCount: Number(record.attributes.ApproximateReceiveCount),
    });
  }
  return { batchItemFailures: [] };
}
