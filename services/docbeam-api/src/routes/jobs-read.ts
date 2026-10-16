// GET /jobs, GET /jobs/:jobId and GET /jobs/:jobId/tasks (TDD Step 3.1). The sender sees every delivery;
// anyone else sees only the deliveries to their own teams, with counts that cover only those.
import { ApiError, LIMITS, TASK_STATUSES } from '@docbeam/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';
import { loadAccess } from '../job-access.js';
import type { PlatformClient } from '../platform.js';
import { pgArray } from '../sql.js';
import { addCount, emptyCounts, fileExpired, pageOf, retryState, statusOf, totalOf, type Counts } from '../tracking.js';

const RETRYABLE_CODES = ['RETRIES_EXHAUSTED', 'FANOUT_FAILED'];

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
      SELECT j.id AS job_id, t.status, count(*)::int AS n
        FROM jobs j JOIN tasks t ON t.job_id = j.id
       WHERE j.id = ANY(${pgArray(jobIds, 'uuid')})
         AND (j.submitted_by_user_id = ${userId} OR t.team_id = ANY(${pgArray(teams, 'uuid')}))
       GROUP BY j.id, t.status`);
    for (const r of result.rows) {
      const c = out.get(r.job_id) ?? emptyCounts();
      addCount(c, r.status, r.n);
      out.set(r.job_id, c);
    }
    return out;
  }

  app.get('/jobs', user, async (request) => {
    const userId = caller(request);
    const query = request.query as { scope?: string; page?: string; limit?: string };
    const scope = query.scope ?? 'mine';
    if (scope !== 'mine' && scope !== 'team') throw new ApiError(400, 'VALIDATION_ERROR', 'scope must be mine or team.');
    const { limit, offset } = pageOf(query, LIMITS.jobsPageDefault, LIMITS.jobsPageMax);

    let teams: string[] = [];
    let rows: Array<{ id: string; submitted_by_user_id: string; submitted_by_name: string; created_at: Date; cancelled_at: Date | null }>;
    if (scope === 'mine') {
      rows = (
        await db.execute<(typeof rows)[number]>(sql`
          SELECT id, submitted_by_user_id, submitted_by_name, created_at, cancelled_at FROM jobs
           WHERE submitted_by_user_id = ${userId}
           ORDER BY created_at DESC, id LIMIT ${limit} OFFSET ${offset}`)
      ).rows;
    } else {
      teams = await platform.userTeams(userId);
      if (teams.length === 0) return [];
      // Jobs by others with at least one delivery to one of the caller's teams, found through idx_tasks_team.
      rows = (
        await db.execute<(typeof rows)[number]>(sql`
          SELECT id, submitted_by_user_id, submitted_by_name, created_at, cancelled_at FROM jobs
           WHERE submitted_by_user_id <> ${userId}
             AND id IN (SELECT job_id FROM tasks WHERE team_id = ANY(${pgArray(teams, 'uuid')}))
           ORDER BY created_at DESC, id LIMIT ${limit} OFFSET ${offset}`)
      ).rows;
    }

    const counts = await countsFor(rows.map((r) => r.id), userId, teams);
    return rows.map((r) => {
      const c = counts.get(r.id) ?? emptyCounts();
      return {
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
      SELECT status, count(*)::int AS n FROM tasks
       WHERE job_id = ${jobId} AND (${isSender}::boolean OR team_id = ANY(${pgArray(teams ?? [], 'uuid')}))
       GROUP BY status`);
    for (const r of rows.rows) addCount(counts, r.status, r.n);

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
    if (query.status !== undefined && !(TASK_STATUSES as readonly string[]).includes(query.status)) {
      throw new ApiError(400, 'VALIDATION_ERROR', `status must be one of ${TASK_STATUSES.join(', ')}.`);
    }
    const page = pageOf(query, LIMITS.tasksPage, LIMITS.tasksPage);
    const access = await loadAccess(db, platform, jobId, userId);
    const teamIds = pgArray(access.teams ?? [], 'uuid');
    const sender = access.isSender;
    const status = query.status ?? null;

    const total = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM tasks
       WHERE job_id = ${jobId} AND (${sender}::boolean OR team_id = ANY(${teamIds})) AND (${status}::text IS NULL OR status = ${status})`);
    const rows = await db.execute<{
      id: string; file_id: string; original_name: string; destination_path: string; team_id: string; status: string;
      attempt_count: number; failure_code: string | null; failure_reason: string | null; updated_at: Date; file_at: Date;
    }>(sql`
      SELECT t.id, t.file_id, f.original_name, t.destination_path, t.team_id, t.status, t.attempt_count,
             t.failure_code, t.failure_reason, t.updated_at, COALESCE(f.uploaded_at, f.created_at) AS file_at
        FROM tasks t JOIN files f ON f.id = t.file_id
       WHERE t.job_id = ${jobId} AND (${sender}::boolean OR t.team_id = ANY(${teamIds})) AND (${status}::text IS NULL OR t.status = ${status})
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
