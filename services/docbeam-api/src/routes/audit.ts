// GET /audit (TDD API contracts, "audit_events"). Newest first, the whole history, never trimmed.
//  - The sender sees every event of their own distributions.
//  - Anyone else, for a distribution with a delivery to one of their teams, sees the events for their teams
//    and the job-wide events (sent, retried, cancelled) with only who and when.
//  - A file.refused event has no job and is shown only to the file's owner.
//  - A download by the sender has no team, so nobody else sees it.
import { ApiError, AUDIT_ACTIONS, LIMITS } from '@docbeam/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';
import type { PlatformClient } from '../platform.js';
import { pgArray } from '../sql.js';
import { pageOf } from '../tracking.js';
import { UUID_PATTERN } from '../validate.js';

const JOB_WIDE = ['job.submitted', 'job.retried', 'job.cancelled'];

export function registerAuditRoutes(app: FastifyInstance, db: Db, { platform }: { platform: PlatformClient }): void {
  app.get('/audit', { preHandler: app.requireAuth({ use: 'user' }) }, async (request) => {
    const p = request.principal;
    if (p?.tokenUse !== 'user') throw new ApiError(401, 'UNAUTHORIZED', 'Sign in again.');
    const userId = p.userId;
    const query = request.query as { jobId?: string; action?: string; page?: string; limit?: string };

    if (query.jobId !== undefined && !UUID_PATTERN.test(query.jobId)) throw new ApiError(400, 'VALIDATION_ERROR', 'jobId is not valid.');
    // `action` takes one action or several separated by commas (the page's "Deliveries" filter is two).
    const actions = query.action ? query.action.split(',').map((a) => a.trim()).filter(Boolean) : [];
    if (actions.some((a) => !(AUDIT_ACTIONS as readonly string[]).includes(a))) {
      throw new ApiError(400, 'VALIDATION_ERROR', `action must be among ${AUDIT_ACTIONS.join(', ')}.`);
    }
    const { page, limit, offset } = pageOf(query, LIMITS.auditPageDefault, LIMITS.auditPageMax);
    const teams = pgArray(await platform.userTeams(userId), 'uuid');

    const rows = await db.execute<{
      id: number; occurred_at: Date; actor_id: string | null; action: string; job_id: string | null; task_id: string | null;
      team_id: string | null; detail: Record<string, unknown>; sender: string | null;
    }>(sql`
      SELECT e.id, e.occurred_at, e.actor_id, e.action, e.job_id, e.task_id, e.team_id, e.detail,
             j.submitted_by_user_id AS sender
        FROM audit_events e LEFT JOIN jobs j ON j.id = e.job_id
       WHERE (
               (e.job_id IS NULL AND e.action = 'file.refused' AND e.detail->>'ownerUserId' = ${userId})
            OR j.submitted_by_user_id = ${userId}
            OR (j.id IS NOT NULL AND j.submitted_by_user_id <> ${userId}
                AND EXISTS (SELECT 1 FROM tasks t WHERE t.job_id = j.id AND t.team_id = ANY(${teams}))
                AND (e.team_id = ANY(${teams})
                     OR (e.team_id IS NULL AND e.action = ANY(${pgArray(JOB_WIDE, 'text')}))))
             )
         AND (${query.jobId ?? null}::uuid IS NULL OR e.job_id = ${query.jobId ?? null}::uuid)
         AND (${actions.length}::int = 0 OR e.action = ANY(${pgArray(actions, 'text')}))
       ORDER BY e.occurred_at DESC, e.id DESC
       LIMIT ${limit + 1} OFFSET ${offset}`);

    const hasMore = rows.rows.length > limit;
    return {
      page,
      limit,
      hasMore,
      events: rows.rows.slice(0, limit).map((r) => {
        // Someone else's job-wide event shows only who did it and when.
        const reduced = r.sender !== null && r.sender !== userId && r.team_id === null;
        const name = r.detail.actorName;
        return {
          id: r.id,
          occurredAt: new Date(r.occurred_at).toISOString(),
          action: r.action,
          actorId: r.actor_id,
          jobId: r.job_id,
          taskId: r.task_id,
          teamId: r.team_id,
          detail: reduced ? (typeof name === 'string' ? { actorName: name } : {}) : r.detail,
        };
      }),
    };
  });
}
