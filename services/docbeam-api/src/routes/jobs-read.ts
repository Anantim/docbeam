// GET /jobs, GET /jobs/:jobId and GET /jobs/:jobId/tasks (TDD Step 3.1). The sender sees every delivery;
// anyone else sees only the deliveries to their own teams, with counts that cover only those.
import { ApiError, JOB_STATUSES, LIMITS, TASK_STATUSES } from '@docbeam/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';
import { loadAccess } from '../job-access.js';
import type { PlatformClient } from '../platform.js';
import { pgArray } from '../sql.js';
import { addCount, decodeJobCursor, emptyCounts, encodeJobCursor, fileExpired, pageOf, retryState, statusOf, totalOf, type Counts } from '../tracking.js';
import { UUID_PATTERN } from '../validate.js';

/** An id typed as its first 8 characters finds at most this many distributions (the popover lets the person choose). */
const ID_PREFIX_MATCHES = 5;

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
  async function reachFor(jobIds: string[], userId: string, teams: string[]): Promise<Map<string, { fileNames: string[]; destinations: string[] }>> {
    const out = new Map<string, { fileNames: string[]; destinations: string[] }>();
    if (jobIds.length === 0) return out;
    // The names, not only the counts: the list shows the first file and the first two folders and lists the rest in a
    // popover (D-F1-40). A distribution has at most 100 files and 20 folders, so the lists are small. Files are in the
    // order they were added; folders by path.
    const result = await db.execute<{ job_id: string; file_names: string[]; destinations: string[] }>(sql`
      SELECT v.job_id,
             array_agg(v.name ORDER BY v.added, v.name) FILTER (WHERE v.name IS NOT NULL) AS file_names,
             (SELECT array_agg(DISTINCT t2.destination_path ORDER BY t2.destination_path)
                FROM tasks t2 JOIN jobs j2 ON j2.id = t2.job_id
               WHERE t2.job_id = v.job_id AND (j2.submitted_by_user_id = ${userId} OR t2.team_id = ANY(${pgArray(teams, 'uuid')}))) AS destinations
        FROM (
          SELECT DISTINCT j.id AS job_id, f.id AS file_id, f.original_name AS name, f.created_at AS added
            FROM jobs j JOIN tasks t ON t.job_id = j.id JOIN files f ON f.id = t.file_id
           WHERE j.id = ANY(${pgArray(jobIds, 'uuid')})
             AND (j.submitted_by_user_id = ${userId} OR t.team_id = ANY(${pgArray(teams, 'uuid')}))
        ) v
       GROUP BY v.job_id`);
    for (const r of result.rows) out.set(r.job_id, { fileNames: r.file_names ?? [], destinations: r.destinations ?? [] });
    return out;
  }

  app.get('/jobs', user, async (request) => {
    const userId = caller(request);
    const query = request.query as { scope?: string; cursor?: string; limit?: string; status?: string; sender?: string; sentSince?: string; team?: string; idPrefix?: string };
    const scope = query.scope ?? 'mine';
    if (scope !== 'mine' && scope !== 'team' && scope !== 'all') throw new ApiError(400, 'VALIDATION_ERROR', 'scope must be mine, team or all.');
    if (query.status !== undefined && !(JOB_STATUSES as readonly string[]).includes(query.status)) {
      throw new ApiError(400, 'VALIDATION_ERROR', `status must be one of ${JOB_STATUSES.join(', ')}.`);
    }
    if (query.sender !== undefined && query.sender !== 'me' && !UUID_PATTERN.test(query.sender)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'sender must be me or a user id.');
    }
    // An ISO 8601 date or a date-time with a zone (2026-10-20 or 2026-10-20T10:00:00Z); a repeated parameter is not one.
    const ISO = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2}))?$/;
    const sentSince = query.sentSince === undefined ? null : typeof query.sentSince === 'string' && ISO.test(query.sentSince) ? new Date(query.sentSince) : new Date(NaN);
    if (sentSince !== null && Number.isNaN(sentSince.getTime())) throw new ApiError(400, 'VALIDATION_ERROR', 'sentSince must be an ISO date.');
    if (query.team !== undefined && !UUID_PATTERN.test(query.team)) throw new ApiError(400, 'VALIDATION_ERROR', 'team must be a team id.');
    // The first 8 characters of an id, as the list shows them (D-F1-32). Looked up by a range on the primary key, so it uses the index.
    if (query.idPrefix !== undefined && !(typeof query.idPrefix === 'string' && /^[0-9a-f]{8}$/i.test(query.idPrefix))) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'idPrefix must be the first 8 characters of an id.');
    }
    const after = query.cursor === undefined ? null : decodeJobCursor(query.cursor);
    if (query.cursor !== undefined && after === null) throw new ApiError(400, 'VALIDATION_ERROR', 'cursor is not valid.');
    const limitRaw = Math.floor(Number(query.limit));
    const limit = query.idPrefix !== undefined ? ID_PREFIX_MATCHES : Math.min(LIMITS.jobsPageMax, limitRaw > 0 ? limitRaw : LIMITS.jobsPageDefault);

    // `mine` is what I sent, `team` is what others sent to my teams, `all` is both (D-F1-9).
    const teams = scope === 'mine' ? [] : await platform.userTeams(userId);
    // Filters only narrow what the scope already allows. A team that is not the caller's is refused, not shown empty.
    if (query.team !== undefined && !teams.includes(query.team.toLowerCase())) throw new ApiError(400, 'VALIDATION_ERROR', 'team must be one of your teams.');
    const sharedWithMe = sql`id IN (SELECT job_id FROM tasks WHERE team_id = ANY(${pgArray(teams, 'uuid')}))`;
    let where = sql`submitted_by_user_id = ${userId}`;
    if (scope === 'team') where = teams.length === 0 ? sql`false` : sql`submitted_by_user_id <> ${userId} AND ${sharedWithMe}`;
    else if (scope === 'all' && teams.length > 0) where = sql`(submitted_by_user_id = ${userId} OR ${sharedWithMe})`;
    if (query.sender !== undefined) where = sql`${where} AND submitted_by_user_id = ${query.sender === 'me' ? userId : query.sender}::uuid`;
    if (sentSince !== null) where = sql`${where} AND created_at >= ${sentSince.toISOString()}::timestamptz`;
    if (query.team !== undefined) where = sql`${where} AND id IN (SELECT job_id FROM tasks WHERE team_id = ${query.team}::uuid)`;
    if (query.idPrefix !== undefined) {
      const p = query.idPrefix.toLowerCase();
      where = sql`${where} AND id >= ${`${p}-0000-0000-0000-000000000000`}::uuid AND id <= ${`${p}-ffff-ffff-ffff-ffffffffffff`}::uuid`;
    }
    // The page after the cursor: newest first, ties broken by id, so the position is (created_at DESC, id DESC) and the
    // cursor carries both. Many distributions can share one sent time; the id keeps them in one fixed order (D-F1-40).
    const afterCursor = after ? sql`(created_at < ${after.createdAt}::timestamptz OR (created_at = ${after.createdAt}::timestamptz AND id < ${after.id}::uuid))` : sql`true`;
    const pageFields = sql`id, submitted_by_user_id, submitted_by_name, created_at, cancelled_at,
                           to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at`;

    type Row = { id: string; submitted_by_user_id: string; submitted_by_name: string; created_at: Date; cancelled_at: Date | null; cursor_at: string };
    let found: Row[];
    if (query.status === undefined) {
      found = (
        await db.execute<Row>(sql`
          SELECT ${pageFields} FROM jobs
           WHERE ${where} AND ${afterCursor}
           ORDER BY created_at DESC, id DESC LIMIT ${limit + 1}`)
      ).rows;
    } else {
      // A status filter needs the counts first: the status is derived from the deliveries the caller may see, with the
      // same rule as `jobStatus` (open = pending + in progress; a cancelled delivery counts as failed there).
      found = (
        await db.execute<Row>(sql`
          SELECT ${pageFields} FROM (
            SELECT j.id, j.submitted_by_user_id, j.submitted_by_name, j.created_at, j.cancelled_at,
                   CASE
                     WHEN c.pending + c.in_progress = 0 AND j.cancelled_at IS NOT NULL THEN 'cancelled'
                     WHEN c.pending + c.in_progress = 0 AND c.failed > 0 THEN 'completed_with_errors'
                     WHEN c.pending + c.in_progress = 0 THEN 'completed'
                     WHEN c.pending = c.pending + c.in_progress + c.completed + c.failed THEN 'pending'
                     ELSE 'in_progress'
                   END AS status
              FROM (SELECT * FROM jobs WHERE ${where} AND ${afterCursor}) j
              CROSS JOIN LATERAL (
                SELECT count(*) FILTER (WHERE t.status = 'pending')::int AS pending,
                       count(*) FILTER (WHERE t.status = 'in_progress')::int AS in_progress,
                       count(*) FILTER (WHERE t.status = 'completed')::int AS completed,
                       count(*) FILTER (WHERE t.status = 'failed')::int AS failed
                  FROM tasks t
                 WHERE t.job_id = j.id AND (j.submitted_by_user_id = ${userId} OR t.team_id = ANY(${pgArray(teams, 'uuid')}))) c) x
           WHERE status = ${query.status}
           ORDER BY created_at DESC, id DESC LIMIT ${limit + 1}`)
      ).rows;
    }

    // One row more than asked tells whether another page follows; the cursor is the position of the last row shown.
    const rows = found.slice(0, limit);
    const last = rows[rows.length - 1];
    const nextCursor = found.length > limit && last ? encodeJobCursor({ createdAt: last.cursor_at, id: last.id }) : null;
    const ids = rows.map((r) => r.id);
    const [counts, reach] = await Promise.all([countsFor(ids, userId, teams), reachFor(ids, userId, teams)]);
    const items = rows.map((r) => {
      const c = counts.get(r.id) ?? emptyCounts();
      return {
        fileCount: reach.get(r.id)?.fileNames.length ?? 0,
        destinationCount: reach.get(r.id)?.destinations.length ?? 0,
        fileNames: reach.get(r.id)?.fileNames ?? [],
        destinations: reach.get(r.id)?.destinations ?? [],
        jobId: r.id,
        submittedBy: { userId: r.submitted_by_user_id, name: r.submitted_by_name },
        createdAt: new Date(r.created_at).toISOString(),
        taskCount: totalOf(c),
        counts: c,
        status: statusOf(c, r.cancelled_at !== null),
      };
    });
    return { items, nextCursor };
  });

  // How many distributions the caller can see that are pending or in progress, for the badge on the Status tab (D-F1-34).
  // A distribution is one of those exactly when a delivery the caller may see is still open (the same deliveries the list
  // counts: all of them for the sender, the ones to the caller's teams for anyone else), so this equals the number of rows
  // under the Pending and In progress filters together, however many pages the list has.
  app.get('/jobs/running', user, async (request) => {
    const userId = caller(request);
    const teams = await platform.userTeams(userId);
    const result = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM jobs j
       WHERE EXISTS (
         SELECT 1 FROM tasks t
          WHERE t.job_id = j.id AND t.status IN ('pending', 'in_progress')
            AND (j.submitted_by_user_id = ${userId} OR t.team_id = ANY(${pgArray(teams, 'uuid')})))`);
    return { running: result.rows[0]?.n ?? 0 };
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
      attempt_count: number; failure_code: string | null; failure_reason: string | null; updated_at: Date; file_at: Date; file_type: string;
    }>(sql`
      SELECT t.id, t.file_id, f.original_name, t.destination_path, t.team_id, t.status, t.attempt_count,
             t.failure_code, t.failure_reason, t.updated_at, COALESCE(f.uploaded_at, f.created_at) AS file_at,
             COALESCE(f.detected_type, f.content_type) AS file_type
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
        // The type the file's own bytes showed (D-F1-44); the declared type for a file that was checked before this existed.
        fileType: r.file_type,
      })),
    };
  });
}
