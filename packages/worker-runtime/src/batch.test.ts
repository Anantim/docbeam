import type { Message } from '@aws-sdk/client-sqs';
import { describe, expect, it } from 'vitest';
import { runBatch, toSqsEvent } from './batch.js';

const ARN = 'arn:aws:sqs:ap-southeast-2:000000000000:docbeam-local-task';
const messages: Message[] = [
  { MessageId: 'a', ReceiptHandle: 'ra', Body: '{"taskId":"1"}', Attributes: { ApproximateReceiveCount: '3' } },
  { MessageId: 'b', ReceiptHandle: 'rb', Body: '{"taskId":"2"}' },
];

describe('toSqsEvent', () => {
  it('builds records the way the Lambda SQS trigger does', () => {
    const event = toSqsEvent(messages, ARN, 'ap-southeast-2');
    expect(event.Records).toHaveLength(2);
    expect(event.Records[0]).toMatchObject({
      messageId: 'a',
      receiptHandle: 'ra',
      body: '{"taskId":"1"}',
      eventSource: 'aws:sqs',
      eventSourceARN: ARN,
      awsRegion: 'ap-southeast-2',
      attributes: { ApproximateReceiveCount: '3' },
    });
    expect(event.Records[1]?.attributes.ApproximateReceiveCount).toBe('1');
  });
});

describe('runBatch', () => {
  const event = toSqsEvent(messages, ARN, 'ap-southeast-2');

  it('deletes every message when the handler reports no failures', async () => {
    expect(await runBatch(async () => ({ batchItemFailures: [] }), event)).toEqual(['ra', 'rb']);
  });

  it('deletes every message when the handler returns nothing', async () => {
    expect(await runBatch(async () => undefined, event)).toEqual(['ra', 'rb']);
  });

  it('keeps the messages listed in batchItemFailures', async () => {
    const kept = await runBatch(async () => ({ batchItemFailures: [{ itemIdentifier: 'a' }] }), event);
    expect(kept).toEqual(['rb']);
  });

  it('keeps every message when the handler throws', async () => {
    expect(
      await runBatch(async () => {
        throw new Error('crash');
      }, event),
    ).toEqual([]);
  });
});
