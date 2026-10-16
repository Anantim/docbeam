import type { SQSRecord } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { createHandler, type Deps, fanOut } from './index.js';

const JOB = '11111111-1111-4111-8111-111111111111';
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const record = (body: string): SQSRecord =>
  ({ messageId: 'm-1', receiptHandle: 'r-1', body, attributes: { ApproximateReceiveCount: '1' } }) as unknown as SQSRecord;

function setup(taskCount: number, failed: { Code: string }[] = []) {
  const queries: { text: string; params: unknown[] }[] = [];
  const sent: { Entries: { Id: string; MessageBody: string }[] }[] = [];
  const deps = {
    db: {
      query: vi.fn(async (text: string, params: unknown[]) => {
        queries.push({ text, params });
        const rows = text.startsWith('SELECT') ? Array.from({ length: taskCount }, (_, i) => ({ id: `task-${i}` })) : [];
        return { rows };
      }),
    },
    sqs: {
      send: vi.fn(async (command: { input: { Entries: { Id: string; MessageBody: string }[] } }) => {
        sent.push(command.input);
        return { Failed: failed };
      }),
    },
    taskQueueUrl: 'http://queue/task',
    log,
  } as unknown as Deps;
  return { deps, queries, sent };
}

describe('fanOut', () => {
  it('marks the job fanned out and sends one message per pending task, ten at a time', async () => {
    const t = setup(25);
    expect(await fanOut(t.deps, JOB)).toBe(25);
    expect(t.queries[0]?.text).toContain('UPDATE jobs SET fanned_out_at');
    expect(t.queries[1]?.text).toContain("status = 'pending'");
    expect(t.sent.map((s) => s.Entries.length)).toEqual([10, 10, 5]);
    // The body carries the task id and nothing else: never a token, never a user.
    expect(JSON.parse(t.sent[0]?.Entries[0]?.MessageBody ?? '{}')).toEqual({ taskId: 'task-0' });
    expect(new Set(t.sent[0]?.Entries.map((e) => e.Id)).size).toBe(10);
  });

  it('sends nothing for a job with no pending task, but still marks it fanned out', async () => {
    const t = setup(0);
    expect(await fanOut(t.deps, JOB)).toBe(0);
    expect(t.sent).toEqual([]);
    expect(t.queries[0]?.text).toContain('fanned_out_at');
  });

  it('fails when SQS refuses some messages, so the job message is offered again', async () => {
    const t = setup(3, [{ Code: 'InternalError' }]);
    await expect(fanOut(t.deps, JOB)).rejects.toThrow('refused 1 of 3');
  });
});

describe('fanout handler', () => {
  it('fans out each job message and reports no failures', async () => {
    const t = setup(2);
    const out = await createHandler(async () => t.deps)({ Records: [record(JSON.stringify({ jobId: JOB }))] });
    expect(out).toEqual({ batchItemFailures: [] });
    expect(t.sent).toHaveLength(1);
  });

  it('reports the record as failed when fan-out throws', async () => {
    const t = setup(2, [{ Code: 'Throttled' }]);
    const out = await createHandler(async () => t.deps)({ Records: [record(JSON.stringify({ jobId: JOB }))] });
    expect(out).toEqual({ batchItemFailures: [{ itemIdentifier: 'm-1' }] });
  });

  it.each([['not JSON', 'hello'], ['no job id', '{}'], ['a bad job id', '{"jobId":"x"}']])(
    'drops a message with %s instead of retrying it',
    async (_label, body) => {
      const t = setup(2);
      const out = await createHandler(async () => t.deps)({ Records: [record(body)] });
      expect(out).toEqual({ batchItemFailures: [] });
      expect(t.queries).toEqual([]);
    },
  );
});
