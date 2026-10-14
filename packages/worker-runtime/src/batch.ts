import type { Message } from '@aws-sdk/client-sqs';
import type { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';

export type SqsHandler = (event: SQSEvent) => Promise<SQSBatchResponse | void>;

/** Turns messages from ReceiveMessage into the event Lambda's SQS trigger would send. */
export function toSqsEvent(messages: Message[], queueArn: string, region: string): SQSEvent {
  const Records = messages.map((m): SQSRecord => {
    const attrs = m.Attributes ?? {};
    return {
      messageId: m.MessageId ?? '',
      receiptHandle: m.ReceiptHandle ?? '',
      body: m.Body ?? '',
      attributes: {
        ApproximateReceiveCount: attrs.ApproximateReceiveCount ?? '1',
        SentTimestamp: attrs.SentTimestamp ?? '',
        SenderId: attrs.SenderId ?? '',
        ApproximateFirstReceiveTimestamp: attrs.ApproximateFirstReceiveTimestamp ?? '',
      },
      messageAttributes: Object.fromEntries(
        Object.entries(m.MessageAttributes ?? {}).map(([k, v]) => [
          k,
          { dataType: v.DataType ?? 'String', stringValue: v.StringValue, stringListValues: [], binaryListValues: [] },
        ]),
      ),
      md5OfBody: m.MD5OfBody ?? '',
      eventSource: 'aws:sqs',
      eventSourceARN: queueArn,
      awsRegion: region,
    };
  });
  return { Records };
}

/**
 * Runs the handler on one batch, the way the Lambda SQS trigger with ReportBatchItemFailures does:
 * returns the receipt handles to delete. A thrown error deletes nothing; listed failures stay
 * in the queue and come back after their visibility timeout (or the gap the handler set).
 */
export async function runBatch(handler: SqsHandler, event: SQSEvent): Promise<string[]> {
  let result: SQSBatchResponse | void;
  try {
    result = await handler(event);
  } catch {
    return [];
  }
  const failed = new Set((result?.batchItemFailures ?? []).map((f) => f.itemIdentifier));
  return event.Records.filter((r) => !failed.has(r.messageId)).map((r) => r.receiptHandle);
}
