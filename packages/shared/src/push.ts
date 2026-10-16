// Pushes a task update to the dashboards that watch the job (ADR-007, TDD "WebSocket API").
// A push problem is logged and never fails a delivery.
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import type { FailureCode } from './constants.js';
import type { Logger } from './logger.js';
import type { Queryable } from './task-outcome.js';

/** Sends one message to one connection. Resolves `false` when the connection is gone (410). */
export type Poster = (connectionId: string, body: string) => Promise<boolean>;

export function createPoster(endpoint: string): Poster {
  const client = new ApiGatewayManagementApiClient({ endpoint });
  return async (connectionId, body) => {
    try {
      await client.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: new TextEncoder().encode(body) }));
      return true;
    } catch (error) {
      const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === 'GoneException' || e.$metadata?.httpStatusCode === 410) return false;
      throw error;
    }
  };
}

export interface PushDeps {
  db: Queryable;
  post: Poster | undefined;
  log: Logger;
}

export interface TaskUpdate {
  jobId: string;
  taskId: string;
  teamId: string;
  status: 'completed' | 'failed';
  failureCode?: FailureCode | undefined;
  failureReason?: string | undefined;
  updatedAt: Date;
  /** Attempts the task took. Left out when it is not known (a task failed before it ever ran). */
  attemptCount?: number | undefined;
}

interface Connection {
  connection_id: string;
  user_id: string;
  team_ids: string[];
}

interface CountRow {
  team_id: string;
  status: string;
  n: string;
}

const EMPTY = { pending: 0, in_progress: 0, completed: 0, failed: 0 };
type Counts = typeof EMPTY;

function sum(rows: CountRow[], teams?: ReadonlySet<string>): Counts {
  const out: Counts = { ...EMPTY };
  for (const r of rows) {
    if (teams && !teams.has(r.team_id)) continue;
    if (r.status in out) out[r.status as keyof Counts] += Number(r.n);
  }
  return out;
}

/** The sender sees the whole job; a team viewer sees only the deliveries to their teams. */
export async function pushTaskUpdate(deps: PushDeps, update: TaskUpdate): Promise<void> {
  await pushTaskUpdates(deps, update.jobId, [update]);
}

/**
 * One `job_update` to each open dashboard of the job, after a cancel (TDD "WebSocket API"). It carries the
 * counts that viewer may see and no task, so the page reloads its tasks. The sender gets the whole job; a team
 * viewer only their teams' deliveries. Problems are logged and never fail the caller.
 */
export async function pushJobUpdate(deps: PushDeps, jobId: string, updatedAt: Date): Promise<void> {
  if (!deps.post) return;
  try {
    const { rows: connections } = await deps.db.query<Connection>(
      `SELECT c.connection_id, c.user_id, c.team_ids::text[] AS team_ids
         FROM ws_connections c
        WHERE c.job_id = $1 AND c.expires_at > now()`,
      [jobId],
    );
    if (connections.length === 0) return;
    const sender = await deps.db.query<{ submitted_by_user_id: string }>('SELECT submitted_by_user_id FROM jobs WHERE id = $1', [jobId]);
    const senderId = sender.rows[0]?.submitted_by_user_id;
    const counts = await deps.db.query<CountRow>(
      'SELECT team_id, status, count(*)::text AS n FROM tasks WHERE job_id = $1 GROUP BY team_id, status',
      [jobId],
    );
    for (const c of connections) {
      const isSender = c.user_id === senderId;
      const body = JSON.stringify({
        type: 'job_update',
        jobId,
        updatedAt: updatedAt.toISOString(),
        counts: isSender ? sum(counts.rows) : sum(counts.rows, new Set(c.team_ids)),
      });
      try {
        if (!(await deps.post(c.connection_id, body))) {
          await deps.db.query('DELETE FROM ws_connections WHERE connection_id = $1', [c.connection_id]);
          deps.log.info('connection gone (410); row deleted', { jobId, connectionId: c.connection_id });
        }
      } catch (error) {
        deps.log.warn('push failed', { jobId, connectionId: c.connection_id, error: String(error) });
      }
    }
  } catch (error) {
    deps.log.warn('push skipped', { jobId, error: String(error) });
  }
}

/**
 * Several updates of one job (for example every task a failed fan-out marked). The connections and the
 * counts are read once, so 2,000 updates cost three queries, not 6,000.
 */
export async function pushTaskUpdates(deps: PushDeps, jobId: string, updates: TaskUpdate[]): Promise<void> {
  if (!deps.post || updates.length === 0) return;
  try {
    const { rows: connections } = await deps.db.query<Connection>(
      `SELECT c.connection_id, c.user_id, c.team_ids::text[] AS team_ids
         FROM ws_connections c
        WHERE c.job_id = $1 AND c.expires_at > now()`,
      [jobId],
    );
    if (connections.length === 0) return;

    const sender = await deps.db.query<{ submitted_by_user_id: string }>('SELECT submitted_by_user_id FROM jobs WHERE id = $1', [jobId]);
    const senderId = sender.rows[0]?.submitted_by_user_id;
    const counts = await deps.db.query<CountRow>(
      'SELECT team_id, status, count(*)::text AS n FROM tasks WHERE job_id = $1 GROUP BY team_id, status',
      [jobId],
    );

    const gone = new Set<string>();
    for (const update of updates) {
      for (const c of connections) {
        if (gone.has(c.connection_id)) continue;
        const isSender = c.user_id === senderId;
        if (!isSender && !c.team_ids.includes(update.teamId)) continue;
        const body = JSON.stringify({
          type: 'task_update',
          jobId: update.jobId,
          taskId: update.taskId,
          status: update.status,
          ...(update.failureCode ? { failureCode: update.failureCode } : {}),
          ...(update.failureReason ? { failureReason: update.failureReason } : {}),
          ...(update.attemptCount !== undefined ? { attemptCount: update.attemptCount } : {}),
          updatedAt: update.updatedAt.toISOString(),
          counts: isSender ? sum(counts.rows) : sum(counts.rows, new Set(c.team_ids)),
        });
        try {
          const delivered = await deps.post(c.connection_id, body);
          if (!delivered) {
            gone.add(c.connection_id);
            await deps.db.query('DELETE FROM ws_connections WHERE connection_id = $1', [c.connection_id]);
            deps.log.info('connection gone (410); row deleted', { jobId, connectionId: c.connection_id });
          }
        } catch (error) {
          deps.log.warn('push failed', { jobId, connectionId: c.connection_id, error: String(error) });
        }
      }
    }
  } catch (error) {
    deps.log.warn('push skipped', { jobId, error: String(error) });
  }
}
