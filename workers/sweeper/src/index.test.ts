import { AbortMultipartUploadCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import type { SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, createHandler, type Deps, resend } from './index.js';

function setup(queryRows: unknown[][] = []) {
  const queries: string[] = [];
  const rowsQueue = [...queryRows];
  const sent: Array<{ command: unknown }> = [];
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const deps = {
    db: {
      query: vi.fn(async (text: string) => {
        queries.push(text);
        return { rows: rowsQueue.shift() ?? [], rowCount: 0 };
      }),
    },
    sqs: { send: vi.fn(async (command: unknown) => (sent.push({ command }), {})) },
    s3: { send: vi.fn(async (command: unknown) => (sent.push({ command }), {})) },
    jobQueueUrl: 'http://q/job',
    bucket: 'bucket',
    log,
  } as unknown as Deps;
  return { deps, queries, sent };
}

describe('resend', () => {
  it('asks only for jobs with no fan-out and no end, two minutes after they were queued', async () => {
    const s = setup([[]]);
    await resend(s.deps);
    expect(s.queries[0]).toContain('fanned_out_at IS NULL');
    expect(s.queries[0]).toContain('completed_at IS NULL');
    expect(s.queries[0]).toContain("interval '2 minutes'");
    expect(s.sent).toHaveLength(0);
  });

  it('sends one job message per job, in groups of ten', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => ({ id: `job-${i}` }));
    const s = setup([ids]);
    expect(await resend(s.deps)).toHaveLength(12);
    const batches = s.sent.map((c) => c.command as SendMessageBatchCommand);
    expect(batches).toHaveLength(2);
    expect(batches[0]?.input.Entries).toHaveLength(10);
    expect(JSON.parse(batches[0]?.input.Entries?.[0]?.MessageBody ?? '{}')).toEqual({ jobId: 'job-0' });
    expect(batches[0]?.input.QueueUrl).toBe('http://q/job');
  });

  it('fails the run when SQS refuses a message, so the next minute tries again', async () => {
    const s = setup([[{ id: 'job-1' }]]);
    (s.deps.sqs.send as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ Failed: [{ Code: 'Throttled' }] });
    await expect(resend(s.deps)).rejects.toThrow('Throttled');
  });
});

describe('cleanup', () => {
  it('deletes the rows first, then the objects, and aborts open multipart uploads', async () => {
    const s = setup([
      [
        { s3_key: 'staging/u/a', multipart_upload_id: null },
        { s3_key: 'staging/u/b', multipart_upload_id: 'upload-1' },
      ],
    ]);
    expect(await cleanup(s.deps)).toEqual({ files: 2 });
    expect(s.queries[0]).toContain('DELETE FROM files');
    expect(s.queries[0]).toContain('job_id IS NULL');
    expect(s.queries[0]).toContain("interval '24 hours'");
    const commands = s.sent.map((c) => c.command);
    const abort = commands.find((c) => c instanceof AbortMultipartUploadCommand) as AbortMultipartUploadCommand;
    expect(abort.input).toMatchObject({ Key: 'staging/u/b', UploadId: 'upload-1' });
    const del = commands.find((c) => c instanceof DeleteObjectsCommand) as DeleteObjectsCommand;
    expect(del.input.Delete?.Objects).toEqual([{ Key: 'staging/u/a' }, { Key: 'staging/u/b' }]);
  });

  it('ignores an upload that is already gone', async () => {
    const s = setup([[{ s3_key: 'k', multipart_upload_id: 'u' }]]);
    (s.deps.s3.send as ReturnType<typeof vi.fn>).mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NoSuchUpload' }));
    await expect(cleanup(s.deps)).resolves.toEqual({ files: 1 });
  });

  it('does nothing when there are no old files', async () => {
    const s = setup([[]]);
    expect(await cleanup(s.deps)).toEqual({ files: 0 });
    expect(s.sent).toHaveLength(0);
  });
});

describe('handler', () => {
  it('runs the task named by the schedule and rejects an unknown one', async () => {
    const s = setup([[], []]);
    const handler = createHandler(async () => s.deps);
    await handler({ task: 'resend' });
    await handler({ task: 'cleanup' });
    expect(s.queries).toHaveLength(2);
    await expect(handler({ task: 'other' as never })).rejects.toThrow('Unknown sweeper task');
  });
});
