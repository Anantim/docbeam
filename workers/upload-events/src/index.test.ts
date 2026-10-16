import type { SQSEvent, SQSRecord } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { createHandler } from './index.js';
import type { Deps } from './process.js';

const owner = '11111111-1111-4111-8111-111111111111';
const file = '22222222-2222-4222-8222-222222222222';

const record = (body: string, receiveCount = 1): SQSRecord =>
  ({
    messageId: 'm-1',
    receiptHandle: 'r-1',
    body,
    attributes: { ApproximateReceiveCount: String(receiveCount) },
    messageAttributes: {},
    md5OfBody: '',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:ap-southeast-2:000000000000:docbeam-local-upload-events',
    awsRegion: 'ap-southeast-2',
  }) as unknown as SQSRecord;

const s3Event = JSON.stringify({
  Records: [{ eventName: 'ObjectCreated:Post', s3: { bucket: { name: 'store' }, object: { key: `staging/${owner}/${file}` } } }],
});

function runtime(query: (text: string) => Promise<unknown>) {
  const visibility = { change: vi.fn(async () => undefined) };
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const deps = { db: { query: vi.fn(query), connect: vi.fn() }, s3: { send: vi.fn() }, scanner: { scan: vi.fn() }, log } as unknown as Deps;
  return { deps, visibility, handler: createHandler(async () => ({ deps, visibility })) };
}

describe('upload-events handler', () => {
  it('acknowledges the S3 test event without touching the database', async () => {
    const r = runtime(async () => ({ rows: [] }));
    const out = await r.handler({ Records: [record(JSON.stringify({ Event: 's3:TestEvent' }))] } satisfies SQSEvent);
    expect(out).toEqual({ batchItemFailures: [] });
    expect(r.deps.db.query).not.toHaveBeenCalled();
  });

  it('keeps the message and hides it for 30 seconds while a multipart upload is not completed yet', async () => {
    const r = runtime(async () => ({
      rows: [{ id: file, ownerUserId: owner, originalName: 'a.pdf', sizeBytes: 10, checksumSha256: 'a', s3Key: `staging/${owner}/${file}`, s3Checksum: null, scanStatus: 'pending' }],
    }));
    // The object exists, so HEAD answers; the row has no checksum yet.
    (r.deps.s3.send as ReturnType<typeof vi.fn>).mockResolvedValue({ ContentLength: 10 });
    const out = await r.handler({ Records: [record(s3Event)] });
    expect(out.batchItemFailures).toEqual([{ itemIdentifier: 'm-1' }]);
    expect(r.visibility.change).toHaveBeenCalledWith(expect.objectContaining({ receiptHandle: 'r-1' }), 30);
  });

  it('reports a failed record and backs off from its receive count when processing throws', async () => {
    const r = runtime(async () => {
      throw new Error('database is down');
    });
    const out = await r.handler({ Records: [record(s3Event, 3)] });
    expect(out.batchItemFailures).toEqual([{ itemIdentifier: 'm-1' }]);
    expect(r.visibility.change).toHaveBeenCalledWith(expect.anything(), 120);
  });
});
