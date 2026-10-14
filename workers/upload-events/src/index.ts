import { createLogger } from '@docbeam/shared';
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';

const log = createLogger('upload-events');

/**
 * Consumer of the Upload Events Queue (ADR-016).
 * Returns the IDs of failed records so SQS retries only those (ReportBatchItemFailures).
 */
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  for (const record of event.Records) {
    log.info('upload event received', {
      messageId: record.messageId,
      source: record.eventSourceARN,
      receiveCount: Number(record.attributes.ApproximateReceiveCount),
    });
  }
  return { batchItemFailures: [] };
}
