import { describe, expect, it, vi } from 'vitest';
import { failPendingTasks, finishTask, jobStatus, type Connectable } from './task-outcome.js';

describe('jobStatus', () => {
  const c = (pending: number, inProgress: number, completed: number, failed: number) => ({ pending, inProgress, completed, failed });

  it.each([
    [c(3, 0, 0, 0), false, 'pending'],
    [c(2, 0, 1, 0), false, 'in_progress'],
    [c(0, 1, 2, 0), false, 'in_progress'],
    [c(0, 0, 3, 0), false, 'completed'],
    [c(0, 0, 2, 1), false, 'completed_with_errors'],
    [c(0, 0, 2, 1), true, 'cancelled'],
    [c(1, 0, 2, 1), true, 'in_progress'],
    [c(0, 0, 0, 0), false, 'pending'], // no deliveries at all is never "completed" (D-F1-62)
    [c(0, 0, 0, 0), true, 'cancelled'],
  ])('%j cancelled=%s is %s', (counts, cancelled, expected) => {
    expect(jobStatus(counts, cancelled)).toBe(expected);
  });
});

function fakeDb(taskRows: unknown[], closedRows = 1) {
  const calls: string[] = [];
  const query = vi.fn(async (text: string) => {
    calls.push(text.trim().split(/\s+/).slice(0, 3).join(' '));
    if (text.includes('RETURNING updated_at')) return { rows: taskRows, rowCount: taskRows.length };
    if (text.includes('original_name')) return { rows: [{ original_name: 'a.pdf' }], rowCount: 1 };
    if (text.includes('UPDATE jobs')) return { rows: [], rowCount: closedRows };
    return { rows: [], rowCount: 0 };
  });
  const client = { query, release: vi.fn() };
  const db = { connect: vi.fn(async () => client) } as unknown as Connectable;
  return { db, calls, client };
}

const row = { updated_at: new Date('2026-10-15T00:00:00Z'), team_id: 't', file_id: 'f', destination_path: 'p' };

describe('failPendingTasks', () => {
  function failDb(failedRows: unknown[]) {
    const calls: Array<{ text: string; values: unknown[] | undefined }> = [];
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      calls.push({ text, values });
      if (text.includes("SET status = 'failed'")) return { rows: failedRows, rowCount: failedRows.length };
      if (text.includes('UPDATE jobs')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const client = { query, release: vi.fn() };
    return { db: { connect: vi.fn(async () => client) } as unknown as Connectable, calls, client };
  }

  const failedRow = (id: string) => ({
    id,
    team_id: 't',
    file_id: 'f',
    destination_path: 'p',
    original_name: 'a.pdf',
    failure_reason: 'a.pdf to p: x',
    updated_at: new Date(),
  });

  it('fails only pending tasks under the job lock, with one audit event each, and closes the job', async () => {
    const { db, calls } = failDb([failedRow('k1'), failedRow('k2')]);
    const out = await failPendingTasks(db, { jobId: 'j', failureCode: 'FANOUT_FAILED', detail: 'x' });
    expect(out.tasks.map((t) => t.taskId)).toEqual(['k1', 'k2']);
    expect(out.jobClosed).toBe(true);
    expect(calls[1]?.text).toContain('FOR UPDATE');
    expect(calls[2]?.text).toContain("t.status = 'pending'");
    expect(calls[3]?.values?.[1]).toEqual(['k1', 'k2']);
    expect(calls.at(-1)?.text).toBe('COMMIT');
  });

  it('writes no audit events when nothing is pending', async () => {
    const { db, calls } = failDb([]);
    const out = await failPendingTasks(db, { jobId: 'j', failureCode: 'FANOUT_FAILED', detail: 'x' });
    expect(out.tasks).toEqual([]);
    expect(calls.some((c) => c.text.includes('INSERT INTO audit_events'))).toBe(false);
  });

  describe('as a cancel', () => {
    const by = { userId: 'u1', name: 'Priya Shah', email: 'priya@example.com' };

    it('marks the job cancelled and writes the sender into the task events and a job.cancelled event', async () => {
      const { db, calls } = failDb([failedRow('k1'), failedRow('k2')]);
      const out = await failPendingTasks(db, { jobId: 'j', failureCode: 'CANCELLED', detail: 'x', cancelledBy: by });
      expect(out.tasks).toHaveLength(2);
      const taskEvents = calls.find((c) => c.text.includes("'task.failed'"));
      expect(taskEvents?.values?.[4]).toBe('u1');
      expect(JSON.parse(String((taskEvents?.values?.[3] as string[])[0]))).toMatchObject({ failureCode: 'CANCELLED', actorName: 'Priya Shah' });
      expect(calls.some((c) => c.text.includes('SET cancelled_at = now()'))).toBe(true);
      const jobEvent = calls.find((c) => c.text.includes("'job.cancelled'"));
      expect(jobEvent?.values?.[0]).toBe('u1');
      expect(JSON.parse(String(jobEvent?.values?.[2]))).toMatchObject({ cancelled: 2, actorEmail: 'priya@example.com' });
      expect(calls.at(-1)?.text).toBe('COMMIT');
    });

    it('writes and commits nothing when no delivery is pending', async () => {
      const { db, calls } = failDb([]);
      const out = await failPendingTasks(db, { jobId: 'j', failureCode: 'CANCELLED', detail: 'x', cancelledBy: by });
      expect(out).toEqual({ tasks: [], jobClosed: false });
      expect(calls.some((c) => c.text.includes('cancelled_at'))).toBe(false);
      expect(calls.some((c) => c.text.includes('INSERT INTO audit_events'))).toBe(false);
      expect(calls.at(-1)?.text).toBe('ROLLBACK');
    });
  });
});

describe('finishTask', () => {
  it('locks the job, writes the task and the audit event, closes the job, commits', async () => {
    const { db, calls, client } = fakeDb([row]);
    const out = await finishTask(db, { taskId: 'k', jobId: 'j', status: 'completed', documentId: 'd' });
    expect(out).toMatchObject({ taskId: 'k', teamId: 't', status: 'completed', jobClosed: true });
    expect(calls[0]).toBe('BEGIN');
    expect(calls[1]).toBe('SELECT 1 FROM');
    expect(calls.at(-1)).toBe('COMMIT');
    expect(calls.some((c) => c.startsWith('INSERT INTO audit_events'))).toBe(true);
    expect(client.release).toHaveBeenCalled();
  });

  it('returns null and writes nothing when the task is already final', async () => {
    const { db, calls } = fakeDb([]);
    const out = await finishTask(db, { taskId: 'k', jobId: 'j', status: 'failed', failureCode: 'CANCELLED' });
    expect(out).toBeNull();
    expect(calls).toContain('ROLLBACK');
    expect(calls.some((c) => c.startsWith('INSERT INTO audit_events'))).toBe(false);
  });

  it('rolls back and releases the connection on an error', async () => {
    const { db, client } = fakeDb([row]);
    client.query.mockImplementation(async (text: string) => {
      if (text.includes('RETURNING updated_at')) throw new Error('boom');
      return { rows: [], rowCount: 0 };
    });
    await expect(finishTask(db, { taskId: 'k', jobId: 'j', status: 'completed' })).rejects.toThrow('boom');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});
