import type { SQSEvent, SQSRecord } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import type { Deps } from './deliver.js';
import { createHandler } from './index.js';

const TASK = '11111111-1111-4111-8111-111111111111';

const record = (body: string, receiveCount = 1): SQSRecord =>
  ({
    messageId: 'm-1',
    receiptHandle: 'r-1',
    body,
    attributes: { ApproximateReceiveCount: String(receiveCount) },
    eventSourceARN: 'arn:aws:sqs:ap-southeast-2:000000000000:docbeam-local-task',
  }) as unknown as SQSRecord;

/** A database whose claim finds no row: the handler reports the task as already final. */
function setup(claimRows: unknown[] = []) {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const query = vi.fn(async (text: string) => {
    if (text.includes('WITH c AS')) return { rows: claimRows, rowCount: claimRows.length };
    return { rows: [], rowCount: 0 };
  });
  const deps = {
    db: { query, connect: vi.fn() },
    s3: { send: vi.fn() },
    tokens: { get: vi.fn(), invalidate: vi.fn() },
    fetchImpl: vi.fn(),
    platformUrl: 'http://platform',
    bucket: 'b',
    checksumOptional: false,
    post: undefined,
    log,
  } as unknown as Deps;
  const visibility = { change: vi.fn(async () => undefined) };
  return { deps, visibility, log, query, handler: createHandler(async () => ({ deps, visibility })) };
}

describe('delivery handler', () => {
  it('acknowledges a message for a task that is already final', async () => {
    const s = setup();
    const out = await s.handler({ Records: [record(JSON.stringify({ taskId: TASK }))] } satisfies SQSEvent);
    expect(out).toEqual({ batchItemFailures: [] });
    expect(s.visibility.change).not.toHaveBeenCalled();
  });

  it('drops a message with no task id', async () => {
    const s = setup();
    const out = await s.handler({ Records: [record('{}'), record('not json')] } satisfies SQSEvent);
    expect(out).toEqual({ batchItemFailures: [] });
    expect(s.query).not.toHaveBeenCalled();
    expect(s.log.error).toHaveBeenCalledTimes(2);
  });

  it('hides the message for the gap and reports it when the database fails', async () => {
    const s = setup();
    s.query.mockRejectedValueOnce(new Error('connection refused'));
    const out = await s.handler({ Records: [record(JSON.stringify({ taskId: TASK }), 2)] } satisfies SQSEvent);
    expect(out).toEqual({ batchItemFailures: [{ itemIdentifier: 'm-1' }] });
    expect(s.visibility.change).toHaveBeenCalledWith(expect.objectContaining({ receiptHandle: 'r-1' }), 120);
  });
});
