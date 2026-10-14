import { describe, expect, it, vi } from 'vitest';
import { finishTask, jobStatus, type Connectable } from './task-outcome.js';

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
