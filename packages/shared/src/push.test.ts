import { describe, expect, it, vi } from 'vitest';
import { pushJobUpdate, pushTaskUpdate, pushTaskUpdates, type Poster, type PushDeps } from './push.js';

const update = {
  jobId: 'job-1',
  taskId: 'task-1',
  teamId: 'team-a',
  status: 'completed' as const,
  updatedAt: new Date('2026-10-15T00:00:00Z'),
};

function setup(connections: Array<{ connection_id: string; user_id: string; team_ids: string[] }>, post: Poster | undefined) {
  const deleted: unknown[] = [];
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    if (text.startsWith('DELETE FROM ws_connections')) {
      deleted.push(values?.[0]);
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('FROM ws_connections')) return { rows: connections, rowCount: connections.length };
    if (text.includes('FROM jobs')) return { rows: [{ submitted_by_user_id: 'sender' }], rowCount: 1 };
    if (text.includes('GROUP BY team_id')) {
      return {
        rows: [
          { team_id: 'team-a', status: 'completed', n: '3' },
          { team_id: 'team-a', status: 'pending', n: '1' },
          { team_id: 'team-b', status: 'completed', n: '5' },
          { team_id: 'team-b', status: 'failed', n: '2' },
        ],
        rowCount: 4,
      };
    }
    return { rows: [], rowCount: 0 };
  });
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const deps = { db: { query }, post, log } as unknown as PushDeps;
  return { deps, deleted, log, query };
}

describe('pushTaskUpdate', () => {
  it('gives the sender the whole job and a team viewer only their teams', async () => {
    const sent: Record<string, { counts: unknown }> = {};
    const post: Poster = async (id, body) => {
      sent[id] = JSON.parse(body);
      return true;
    };
    const s = setup(
      [
        { connection_id: 'c-sender', user_id: 'sender', team_ids: [] },
        { connection_id: 'c-viewer', user_id: 'viewer', team_ids: ['team-a'] },
      ],
      post,
    );
    await pushTaskUpdate(s.deps, update);
    expect(sent['c-sender']?.counts).toEqual({ pending: 1, in_progress: 0, completed: 8, failed: 2 });
    expect(sent['c-viewer']?.counts).toEqual({ pending: 1, in_progress: 0, completed: 3, failed: 0 });
    expect(sent['c-sender']).toMatchObject({ type: 'task_update', jobId: 'job-1', taskId: 'task-1', status: 'completed' });
  });

  it('skips a viewer whose teams do not include the delivery team', async () => {
    const post = vi.fn(async () => true);
    const s = setup([{ connection_id: 'c-other', user_id: 'viewer', team_ids: ['team-b'] }], post);
    await pushTaskUpdate(s.deps, update);
    expect(post).not.toHaveBeenCalled();
  });

  it('only reads connections that have not expired', async () => {
    const s = setup([], vi.fn());
    await pushTaskUpdate(s.deps, update);
    expect(String(s.query.mock.calls[0]?.[0])).toContain('expires_at > now()');
  });

  it('deletes a connection that answers gone', async () => {
    const s = setup([{ connection_id: 'c-gone', user_id: 'sender', team_ids: [] }], async () => false);
    await pushTaskUpdate(s.deps, update);
    expect(s.deleted).toEqual(['c-gone']);
  });

  it('logs and carries on when a post fails, and when the database fails', async () => {
    const post: Poster = async () => {
      throw new Error('throttled');
    };
    const s = setup([{ connection_id: 'c1', user_id: 'sender', team_ids: [] }], post);
    await expect(pushTaskUpdate(s.deps, update)).resolves.toBeUndefined();
    expect(s.log.warn).toHaveBeenCalled();

    const broken = setup([], post);
    broken.query.mockRejectedValueOnce(new Error('db down'));
    await expect(pushTaskUpdate(broken.deps, update)).resolves.toBeUndefined();
  });

  it('reads connections and counts once for a batch of updates', async () => {
    const post = vi.fn(async () => true);
    const s = setup([{ connection_id: 'c1', user_id: 'sender', team_ids: [] }], post);
    await pushTaskUpdates(s.deps, 'job-1', [update, { ...update, taskId: 'task-2' }, { ...update, taskId: 'task-3' }]);
    expect(post).toHaveBeenCalledTimes(3);
    expect(s.query).toHaveBeenCalledTimes(3);
  });

  it('does nothing when no endpoint is configured', async () => {
    const s = setup([{ connection_id: 'c1', user_id: 'sender', team_ids: [] }], undefined);
    await pushTaskUpdate(s.deps, update);
    expect(s.query).not.toHaveBeenCalled();
  });
});

describe('pushJobUpdate', () => {
  it('sends each dashboard the counts it may see and no task', async () => {
    const sent: Record<string, { type: string; counts: unknown; taskId?: string }> = {};
    const post: Poster = async (id, body) => {
      sent[id] = JSON.parse(body);
      return true;
    };
    const s = setup(
      [
        { connection_id: 'c-sender', user_id: 'sender', team_ids: [] },
        { connection_id: 'c-viewer', user_id: 'viewer', team_ids: ['team-b'] },
      ],
      post,
    );
    await pushJobUpdate(s.deps, 'job-1', new Date('2026-10-16T00:00:00Z'));
    expect(sent['c-sender']).toMatchObject({ type: 'job_update', jobId: 'job-1', counts: { pending: 1, in_progress: 0, completed: 8, failed: 2 } });
    expect(sent['c-viewer']?.counts).toEqual({ pending: 0, in_progress: 0, completed: 5, failed: 2 });
    expect(sent['c-sender']?.taskId).toBeUndefined();
  });

  it('does nothing without a poster and deletes a connection that returns 410', async () => {
    const none = setup([{ connection_id: 'c1', user_id: 'sender', team_ids: [] }], undefined);
    await pushJobUpdate(none.deps, 'job-1', new Date());
    expect(none.query).not.toHaveBeenCalled();

    const gone = setup([{ connection_id: 'c1', user_id: 'sender', team_ids: [] }], async () => false);
    await pushJobUpdate(gone.deps, 'job-1', new Date());
    expect(gone.deleted).toEqual(['c1']);
  });
});
