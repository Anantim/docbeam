// GET /jobs, GET /jobs/:jobId and GET /jobs/:jobId/tasks (TDD Step 3.1). The sender sees every delivery;
// anyone else sees only the deliveries to their own teams, with counts that cover only those.
import { ApiError, JOB_STATUSES, LIMITS, TASK_STATUSES } from '@docbeam/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';
import { loadAccess } from '../job-access.js';
import type { PlatformClient } from '../platform.js';
import { pgArray } from '../sql.js';
import { addCount, emptyCounts, fileExpired, pageOf, retryState, statusOf, totalOf, type Counts } from '../tracking.js';

const RETRYABLE_CODES = ['RETRIES_EXHAUSTED', 'FANOUT_FAILED'];

// A delivery the sender cancelled is stored as failed with the code CANCELLED. It is shown and counted as its
// own kind, `cancelled`; `failed` is real failures only (D-M3-17). The same expression, with and without the alias.
const KIND_OF_TASK = sql.raw(`CASE WHEN t.status = 'failed' AND t.failure_code = 'CANCELLED' THEN 'cancelled' ELSE t.status END`);
const KIND = sql.raw(`CASE WHEN status = 'failed' AND failure_code = 'CANCELLED' THEN 'cancelled' ELSE status END`);
const TASK_FILTERS = [...TASK_STATUSES, 'cancelled'] as const;

export interface ReadDeps {
  platform: PlatformClient;
}

export function registerJobReadRoutes(app: FastifyInstance, db: Db, { platform }: ReadDeps): void {
  const user = { preHandler: app.requireAuth({ use: 'user' }) };

  function caller(request: { principal?: { tokenUse: string; userId?: string } }): string {
    const p = request.principal;
    if (p?.tokenUse !== 'user' || !p.userId) throw new ApiError(401, 'UNAUTHORIZED', 'Sign in again.');
    return p.userId;
  }

  /** One query for a whole page (TDD "Job status"). For anyone but the sender it counts only their teams' tasks. */
  async function countsFor(jobIds: string[], userId: string, teams: string[]): Promise<Map<string, Counts>> {
    const out = new Map<string, Counts>();
    if (jobIds.length === 0) return out;
    const result = await db.execute<{ job_id: string; status: string; n: number }>(sql`
      SELECT j.id AS job_id, ${KIND_OF_TASK} AS status, count(*)::int AS n
        FROM jobs j JOIN tasks t ON t.job_id = j.id
       WHERE j.id = ANY(${pgArray(jobIds, 'uuid')})
         AND (j.submitted_by_user_id = ${userId} OR t.team_id = ANY(${pgArray(teams, 'uuid')}))
       GROUP BY 1, 2`);
    for (const r of result.rows) {
      const c = out.get(r.job_id) ?? emptyCounts();
      addCount(c, r.status, r.n);
      out.set(r.job_id, c);
    }
    return out;
  }

  /**
   * The files and the folders a distribution reaches, for the list. Counted over the deliveries the caller may see,
   * the same rows as the counts: the sender sees all of them, anyone else only the ones to their own teams.
   */
  async function reachFor(jobIds: string[], userId: string, teams: string[]): Promise<Map<string, { files: number; destinations: number }>> {
    const out = new Map<string, { files: number; destinations: number }>();
    if (jobIds.length === 0) return out;
    const result = await db.execute<{ job_id: string; files: number; destinations: number }>(sql`
      SELECT j.id AS job_id, count(DISTINCT t.file_id)::int AS files, count(DISTINCT t.destination_path)::int AS destinations
        FROM jobs j JOIN tasks t ON t.job_id = j.id
       WHERE j.id = ANY(${pgArray(jobIds, 'uuid')})
         AND (j.submitted_by_user_id = ${userId} OR t.team_id = ANY(${pgArray(teams, 'uuid')}))
       GROUP BY 1`);
    for (const r of result.rows) out.set(r.job_id, { files: r.files, destinations: r.destinations });
    return out;
  }

  app.get('/jobs', user, async (request) => {
    const userId = caller(request);
    const query = request.query as { scope?: string; page?: string; limit?: string; status?: string };
    const scope = query.scope ?? 'mine';
    if (scope !== 'mine' && scope !== 'team' && scope !== 'all') throw new ApiError(400, 'VALIDATION_ERROR', 'scope must be mine, team or all.');
    if (query.status !== undefined && !(JOB_STATUSES as readonly string[]).includes(query.status)) {
      throw new ApiError(400, 'VALIDATION_ERROR', `status must be one of ${JOB_STATUSES.join(', ')}.`);
    }
    const { limit, offset } = pageOf(query, LIMITS.jobsPageDefault, LIMITS.jobsPageMax);

    // `mine` is what I sent, `team` is what others sent to my teams, `all` is both (D-F1-9).
    const teams = scope === 'mine' ? [] : await platform.userTeams(userId);
    const sharedWithMe = sql`id IN (SELECT job_id FROM tasks WHERE team_id = ANY(${pgArray(teams, 'uuid')}))`;
    let where = sql`submitted_by_user_id = ${userId}`;
    if (scope === 'team') where = teams.length === 0 ? sql`false` : sql`submitted_by_user_id <> ${userId} AND ${sharedWithMe}`;
    else if (scope === 'all' && teams.length > 0) where = sql`(submitted_by_user_id = ${userId} OR ${sharedWithMe})`;

    type Row = { id: string; submitted_by_user_id: string; submitted_by_name: string; created_at: Date; cancelled_at: Date | null };
    let rows: Row[];
    if (query.status === undefined) {
      rows = (
        await db.execute<Row>(sql`
          SELECT id, submitted_by_user_id, submitted_by_name, created_at, cancelled_at FROM jobs
           WHERE ${where}
           ORDER BY created_at DESC, id LIMIT ${limit} OFFSET ${offset}`)
      ).rows;
    } else {
      // A status filter needs the counts first: the status is derived from the deliveries the caller may see, with the
      // same rule as `jobStatus` (open = pending + in progress; a cancelled delivery counts as failed there).
      rows = (
        await db.execute<Row>(sql`
          SELECT id, submitted_by_user_id, submitted_by_name, created_at, cancelled_at FROM (
            SELECT j.id, j.submitted_by_user_id, j.submitted_by_name, j.created_at, j.cancelled_at,
                   CASE
                     WHEN c.pending + c.in_progress = 0 AND j.cancelled_at IS NOT NULL THEN 'cancelled'
                     WHEN c.pending + c.in_progress = 0 AND c.failed > 0 THEN 'completed_with_errors'
                     WHEN c.pending + c.in_progress = 0 THEN 'completed'
                     WHEN c.pending = c.pending + c.in_progress + c.completed + c.failed THEN 'pending'
                     ELSE 'in_progress'
                   END AS status
              FROM (SELECT * FROM jobs WHERE ${where}) j
              CROSS JOIN LATERAL (
                SELECT count(*) FILTER (WHERE t.status = 'pending')::int AS pending,
                       count(*) FILTER (WHERE t.status = 'in_progress')::int AS in_progress,
                       count(*) FILTER (WHERE t.status = 'completed')::int AS completed,
                       count(*) FILTER (WHERE t.status = 'failed')::int AS failed
                  FROM tasks t
                 WHERE t.job_id = j.id AND (j.submitted_by_user_id = ${userId} OR t.team_id = ANY(${pgArray(teams, 'uuid')}))) c) x
           WHERE status = ${query.status}
           ORDER BY created_at DESC, id LIMIT ${limit} OFFSET ${offset}`)
      ).rows;
    }

    const ids = rows.map((r) => r.id);
    const [counts, reach] = await Promise.all([countsFor(ids, userId, teams), reachFor(ids, userId, teams)]);
    return rows.map((r) => {
      const c = counts.get(r.id) ?? emptyCounts();
      return {
        fileCount: reach.get(r.id)?.files ?? 0,
        destinationCount: reach.get(r.id)?.destinations ?? 0,
        jobId: r.id,
        submittedBy: { userId: r.submitted_by_user_id, name: r.submitted_by_name },
        createdAt: new Date(r.created_at).toISOString(),
        taskCount: totalOf(c),
        counts: c,
        status: statusOf(c, r.cancelled_at !== null),
      };
    });
  });

  app.get('/jobs/:jobId', user, async (request) => {
    const userId = caller(request);
    const { jobId } = request.params as { jobId: string };
    const { job, isSender, teams } = await loadAccess(db, platform, jobId, userId);

    const counts = emptyCounts();
    const rows = await db.execute<{ status: string; n: number }>(sql`
      SELECT ${KIND} AS status, count(*)::int AS n FROM tasks
       WHERE job_id = ${jobId} AND (${isSender}::boolean OR team_id = ANY(${pgArray(teams ?? [], 'uuid')}))
       GROUP BY 1`);
    for (const r of rows.rows) addCount(counts, r.status, r.n);

    // The folders the caller may see in this distribution (all of them for the sender), for the header's chips.
    const dests = await db.execute<{ destination_path: string }>(sql`
      SELECT DISTINCT destination_path FROM tasks
       WHERE job_id = ${jobId} AND (${isSender}::boolean OR team_id = ANY(${pgArray(teams ?? [], 'uuid')}))
       ORDER BY destination_path`);

    const now = new Date();
    const view = {
      // The counts were read just now. The page ignores pushes older than this (TDD "WebSocket API").
      asOf: now.toISOString(),
      jobId: job.id,
      submittedBy: { userId: job.submittedByUserId, name: job.submittedByName },
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
      cancelledAt: job.cancelledAt?.toISOString() ?? null,
      isSender,
      destinations: dests.rows.map((d) => d.destination_path),
      taskCount: totalOf(counts),
      counts,
      status: statusOf(counts, job.cancelledAt !== null),
    };
    if (!isSender) return view;

    // What the sender's buttons may do. The rules live here, so the page and the routes cannot disagree.
    const extra = await db.execute<{ retryable: number; oldest: Date | null; files: number }>(sql`
      SELECT (SELECT count(*)::int FROM tasks WHERE job_id = ${jobId} AND status = 'failed'
                 AND failure_code = ANY(${pgArray(RETRYABLE_CODES, 'text')})) AS retryable,
             (SELECT min(created_at) FROM files WHERE job_id = ${jobId}) AS oldest,
             (SELECT count(*)::int FROM files WHERE job_id = ${jobId}) AS files`);
    const e = extra.rows[0];
    const retryable = e?.retryable ?? 0;
    const retry = retryState({
      now,
      cancelled: job.cancelledAt !== null,
      retryable,
      firstCompletedAt: job.firstCompletedAt,
      oldestFileCreatedAt: e?.oldest ? new Date(e.oldest) : null,
    });
    return {
      ...view,
      fileCount: e?.files ?? 0,
      retry: { open: retry.open, retryable, ...(retry.open ? {} : { reason: retry.reason }) },
      cancel: { open: job.cancelledAt === null && counts.pending > 0, waiting: counts.pending },
    };
  });

  app.get('/jobs/:jobId/tasks', user, async (request) => {
    const userId = caller(request);
    const { jobId } = request.params as { jobId: string };
    const query = request.query as { status?: string; page?: string; limit?: string };
    if (query.status !== undefined && !(TASK_FILTERS as readonly string[]).includes(query.status)) {
      throw new ApiError(400, 'VALIDATION_ERROR', `status must be one of ${TASK_FILTERS.join(', ')}.`);
    }
    const page = pageOf(query, LIMITS.tasksPage, LIMITS.tasksPage);
    const access = await loadAccess(db, platform, jobId, userId);
    const teamIds = pgArray(access.teams ?? [], 'uuid');
    const sender = access.isSender;
    const status = query.status ?? null;

    const total = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM tasks
       WHERE job_id = ${jobId} AND (${sender}::boolean OR team_id = ANY(${teamIds})) AND (${status}::text IS NULL OR ${KIND} = ${status})`);
    const rows = await db.execute<{
      id: string; file_id: string; original_name: string; destination_path: string; team_id: string; status: string;
      attempt_count: number; failure_code: string | null; failure_reason: string | null; updated_at: Date; file_at: Date;
    }>(sql`
      SELECT t.id, t.file_id, f.original_name, t.destination_path, t.team_id, t.status, t.attempt_count,
             t.failure_code, t.failure_reason, t.updated_at, COALESCE(f.uploaded_at, f.created_at) AS file_at
        FROM tasks t JOIN files f ON f.id = t.file_id
       WHERE t.job_id = ${jobId} AND (${sender}::boolean OR t.team_id = ANY(${teamIds})) AND (${status}::text IS NULL OR ${KIND_OF_TASK} = ${status})
       ORDER BY f.original_name, t.destination_path, t.id
       LIMIT ${page.limit} OFFSET ${page.offset}`);

    const now = new Date();
    return {
      page: page.page,
      limit: page.limit,
      total: total.rows[0]?.n ?? 0,
      tasks: rows.rows.map((r) => ({
        taskId: r.id,
        fileId: r.file_id,
        fileName: r.original_name,
        destinationPath: r.destination_path,
        teamId: r.team_id,
        status: r.status,
        attemptCount: r.attempt_count,
        failureCode: r.failure_code,
        failureReason: r.failure_reason,
        updatedAt: new Date(r.updated_at).toISOString(),
        fileExpired: fileExpired(new Date(r.file_at), now),
      })),
    };
  });
}
