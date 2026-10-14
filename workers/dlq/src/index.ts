import { createLogger } from '@docbeam/shared';
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';

const log = createLogger('dlq');

/**
 * Consumer of the Job DLQ, Task DLQ and Upload DLQ.
 * Returns the IDs of failed records so SQS retries only those (ReportBatchItemFailures).
 */
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  for (const record of event.Records) {
    log.info('dead-letter message received', {
      messageId: record.messageId,
      source: record.eventSourceARN,
      receiveCount: Number(record.attributes.ApproximateReceiveCount),
    });
  }
  return { batchItemFailures: [] };
}
