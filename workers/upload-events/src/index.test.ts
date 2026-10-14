import type { SQSEvent, SQSRecord } from 'aws-lambda';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handler } from './index.js';

const record = {
  messageId: 'm-1',
  receiptHandle: 'r-1',
  body: '{}',
  attributes: { ApproximateReceiveCount: '1' },
  messageAttributes: {},
  md5OfBody: '',
  eventSource: 'aws:sqs',
  eventSourceARN: 'arn:aws:sqs:ap-southeast-2:000000000000:docbeam-local-test',
  awsRegion: 'ap-southeast-2',
} as unknown as SQSRecord;

afterEach(() => vi.restoreAllMocks());

describe('upload-events handler', () => {
  it('logs each record and reports no failures', async () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const result = await handler({ Records: [record] } satisfies SQSEvent);
    expect(result).toEqual({ batchItemFailures: [] });
    const line = JSON.parse(String(out.mock.calls[0]?.[0]));
    expect(line).toMatchObject({ name: 'upload-events', msg: 'upload event received', messageId: 'm-1', receiveCount: 1 });
  });
});
