import { FAILURE_REASON, FILE_REASON } from '@docbeam/shared';
import type { SQSEvent, SQSRecord } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { createHandler } from './index.js';
import { type Deps, kindOf } from './process.js';

const arn = (name: string) => `arn:aws:sqs:ap-southeast-2:000000000000:${name}`;

const record = (queue: string, body: unknown, id = 'm-1'): SQSRecord =>
  ({
    messageId: id,
    receiptHandle: 'r',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    attributes: { ApproximateReceiveCount: '1' },
    eventSourceARN: arn(queue),
  }) as unknown as SQSRecord;

const TASK = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const FILE = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';

function setup(handlers: Record<string, (values: unknown[]) => { rows: unknown[]; rowCount: number }> = {}) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const respond = (text: string, values: unknown[] = []) => {
    calls.push({ text, values });
    for (const [needle, fn] of Object.entries(handlers)) if (text.includes(needle)) return fn(values);
    return { rows: [], rowCount: 0 };
  };
  const query = vi.fn(async (text: string, values?: unknown[]) => respond(text, values));
  const client = { query, release: vi.fn() };
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const deps = { db: { query, connect: vi.fn(async () => client) }, post: undefined, log } as unknown as Deps;
  return { calls, handler: createHandler(async () => deps), log };
}

describe('kindOf', () => {
  it('tells the three DLQs apart by name, whatever the prefix', () => {
    expect(kindOf(arn('docbeam-dev-job-dlq'))).toBe('job');
    expect(kindOf(arn('docbeam-dev-task-dlq'))).toBe('task');
    expect(kindOf(arn('docbeam-local-upload-events-dlq'))).toBe('upload');
    expect(kindOf(arn('docbeam-dev-task'))).toBeUndefined();
  });
});

describe('dlq handler', () => {
  it("fails a task from the Task DLQ with RETRIES_EXHAUSTED, and the stored reason ends with the one sentence the web app shows (D-F1-78)", async () => {
    const s = setup({
      'FROM tasks t JOIN files': () => ({ rows: [{ job_id: JOB, destination_path: 'Cardio / Reg', original_name: 'a.pdf' }], rowCount: 1 }),
      'RETURNING updated_at': () => ({ rows: [{ updated_at: new Date(), team_id: 't', file_id: 'f', destination_path: 'p' }], rowCount: 1 }),
    });
    const out = await s.handler({ Records: [record('docbeam-dev-task-dlq', { taskId: TASK })] } satisfies SQSEvent);
    expect(out).toEqual({ batchItemFailures: [] });
    const write = s.calls.find((c) => c.text.includes('RETURNING updated_at'));
    expect(write?.values.slice(0, 4)).toEqual([TASK, 'failed', 'RETRIES_EXHAUSTED', `a.pdf to Cardio / Reg: ${FAILURE_REASON.RETRIES_EXHAUSTED}`]);
    expect(s.calls.some((c) => c.text.includes('INSERT INTO audit_events'))).toBe(true);
  });

  it('does nothing more for a task that is already final', async () => {
    const s = setup({
      'FROM tasks t JOIN files': () => ({ rows: [{ job_id: JOB, destination_path: null, original_name: 'a.pdf' }], rowCount: 1 }),
    });
    const out = await s.handler({ Records: [record('docbeam-dev-task-dlq', { taskId: TASK })] } satisfies SQSEvent);
    expect(out).toEqual({ batchItemFailures: [] });
    expect(s.calls.some((c) => c.text.includes('INSERT INTO audit_events'))).toBe(false);
  });

  it('fails the pending tasks of a job from the Job DLQ with FANOUT_FAILED', async () => {
    const s = setup({
      'SET status = \'failed\', failure_code = $2': () => ({
        rows: [
          { id: 'k1', team_id: 't', file_id: 'f', destination_path: 'p', original_name: 'a.pdf', failure_reason: 'a.pdf to p: x', updated_at: new Date() },
          { id: 'k2', team_id: 't', file_id: 'f', destination_path: 'p', original_name: 'a.pdf', failure_reason: 'a.pdf to p: x', updated_at: new Date() },
        ],
        rowCount: 2,
      }),
    });
    const out = await s.handler({ Records: [record('docbeam-dev-job-dlq', { jobId: JOB })] } satisfies SQSEvent);
    expect(out).toEqual({ batchItemFailures: [] });
    const write = s.calls.find((c) => c.text.includes("failure_code = $2"));
    expect(write?.values[1]).toBe('FANOUT_FAILED');
    const audit = s.calls.find((c) => c.text.includes('INSERT INTO audit_events'));
    expect(audit?.values[1]).toEqual(['k1', 'k2']);
  });

  it('marks the file failed from the Upload DLQ, only while it is still pending', async () => {
    const s = setup();
    const body = {
      Records: [
        { eventName: 'ObjectCreated:Post', s3: { bucket: { name: 'b' }, object: { key: `staging/${OWNER}/${FILE}` } } },
      ],
    };
    const out = await s.handler({ Records: [record('docbeam-dev-upload-events-dlq', body)] } satisfies SQSEvent);
    expect(out).toEqual({ batchItemFailures: [] });
    const write = s.calls.find((c) => c.text.includes("scan_status = 'failed'"));
    expect(write?.text).toContain("scan_status = 'pending'");
    expect(write?.values).toEqual([FILE, `staging/${OWNER}/${FILE}`, FILE_REASON.SCAN_FAILED]); // the reason is the sentence the web app shows
  });

  it('reports a message as failed when the database is down, so it stays in the DLQ', async () => {
    const s = setup({
      'FROM tasks t JOIN files': () => {
        throw new Error('connection refused');
      },
    });
    const out = await s.handler({ Records: [record('docbeam-dev-task-dlq', { taskId: TASK }, 'm-9')] } satisfies SQSEvent);
    expect(out).toEqual({ batchItemFailures: [{ itemIdentifier: 'm-9' }] });
  });

  it('keeps a message from an unknown queue', async () => {
    const s = setup();
    const out = await s.handler({ Records: [record('somewhere-else', {}, 'm-2')] } satisfies SQSEvent);
    expect(out).toEqual({ batchItemFailures: [{ itemIdentifier: 'm-2' }] });
  });
});
