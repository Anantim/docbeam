// POST /jobs/:jobId/cancel and /retry (TDD Step 3.1). Both are for the sender only: someone who cannot see the
// job gets 404, someone who can see it but did not send it gets 403 NOT_SENDER. Both lock the job row first.
import { ApiError, failPendingTasks, pushJobUpdate, type Logger, type Poster, type Queryable } from '@docbeam/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';
import { loadAccess } from '../job-access.js';
import type { PlatformClient } from '../platform.js';
import type { JobQueue } from '../queue.js';
import { auditEvents } from '../schema.js';
import { pgArray } from '../sql.js';
import { retryState } from '../tracking.js';

export interface ActionDeps {
  platform: PlatformClient;
  queue: JobQueue;
  /** Posts to a WebSocket connection. Undefined: no pushes (locally without ws-local, or in a test). */
  post: Poster | undefined;
}

const RETRYABLE_CODES = ['RETRIES_EXHAUSTED', 'FANOUT_FAILED'];

export function registerJobActionRoutes(app: FastifyInstance, db: Db, { platform, queue, post }: ActionDeps): void {
  const user = { preHandler: app.requireAuth({ use: 'user' }) };

  // pg.Pool, seen as the small interfaces the shared code needs.
  const pool = db.$client;
  const queryable: Queryable = {
    query: async (text, values) => {
      const r = await pool.query(text, values);
      return { rows: r.rows, rowCount: r.rowCount };
    },
  };
  const log: Logger = {
    debug: (msg, fields) => app.log.debug(fields ?? {}, msg),
    info: (msg, fields) => app.log.info(fields ?? {}, msg),
    warn: (msg, fields) => app.log.warn(fields ?? {}, msg),
    error: (msg, fields) => app.log.error(fields ?? {}, msg),
  };

  /** The caller as the sender, or the right error. */
  async function senderOnly(request: { principal?: { tokenUse: string } }, jobId: string) {
    const p = request.principal;
    if (p?.tokenUse !== 'user') throw new ApiError(401, 'UNAUTHORIZED', 'Sign in again.');
    const principal = p as { tokenUse: 'user'; userId: string; name: string; email: string };
    const access = await loadAccess(db, platform, jobId, principal.userId);
    if (!access.isSender) throw new ApiError(403, 'NOT_SENDER', 'Only the person who sent this distribution can do that.');
    return { principal, job: access.job };
  }

  app.post('/jobs/:jobId/cancel', user, async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const { principal } = await senderOnly(request, jobId);

    // One transaction under the job row lock: pending tasks fail with CANCELLED, the job is marked cancelled
    // and closed if nothing still runs, and the audit events are written. Running deliveries finish.
    const result = await failPendingTasks(pool, {
      jobId,
      failureCode: 'CANCELLED',
      detail: 'cancelled by the sender before it started.',
      cancelledBy: { userId: principal.userId, name: principal.name, email: principal.email },
    });
    if (result.tasks.length === 0) throw new ApiError(409, 'NOTHING_TO_CANCEL', 'No delivery is waiting, so there is nothing to cancel.');

    // After the commit. A push problem is logged and never fails the cancel.
    await pushJobUpdate({ db: queryable, post, log }, jobId, new Date());
    return reply.code(202).send({ cancelled: result.tasks.length });
  });

  app.post('/jobs/:jobId/retry', user, async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const { principal } = await senderOnly(request, jobId);

    const retried = await db.transaction(async (tx) => {
      const locked = await tx.execute<{ cancelled_at: Date | null; first_completed_at: Date | null }>(
        sql`SELECT cancelled_at, first_completed_at FROM jobs WHERE id = ${jobId} FOR UPDATE`,
      );
      const job = locked.rows[0];
      if (!job) throw new ApiError(404, 'NOT_FOUND', 'That distribution was not found.');

      const facts = await tx.execute<{ retryable: number; oldest: Date | null }>(sql`
        SELECT (SELECT count(*)::int FROM tasks WHERE job_id = ${jobId} AND status = 'failed'
                   AND failure_code = ANY(${pgArray(RETRYABLE_CODES, 'text')})) AS retryable,
               (SELECT min(created_at) FROM files WHERE job_id = ${jobId}) AS oldest`);
      const f = facts.rows[0];
      const state = retryState({
        now: new Date(),
        cancelled: job.cancelled_at !== null,
        retryable: f?.retryable ?? 0,
        firstCompletedAt: job.first_completed_at ? new Date(job.first_completed_at) : null,
        oldestFileCreatedAt: f?.oldest ? new Date(f.oldest) : null,
      });
      if (!state.open) {
        const message = {
          JOB_CANCELLED: 'This distribution was cancelled. Send the files as a new distribution.',
          RETRY_WINDOW_CLOSED: 'The retry window has passed. Send the files as a new distribution.',
          NOTHING_TO_RETRY: 'No failed delivery can be retried.',
        }[state.reason];
        throw new ApiError(409, state.reason, message);
      }

      // Only failures a retry can fix go back to pending. Running and completed tasks are untouched.
      const reset = await tx.execute(sql`
        UPDATE tasks SET status = 'pending', failure_code = NULL, failure_reason = NULL, last_error = NULL,
                         attempt_count = 0, updated_at = now()
         WHERE job_id = ${jobId} AND status = 'failed' AND failure_code = ANY(${pgArray(RETRYABLE_CODES, 'text')})
        RETURNING id`);
      await tx.execute(sql`UPDATE jobs SET completed_at = NULL, fanned_out_at = NULL, queued_at = now() WHERE id = ${jobId}`);
      await tx.insert(auditEvents).values({
        actorId: principal.userId,
        action: 'job.retried',
        jobId,
        detail: { actorName: principal.name, actorEmail: principal.email, retried: reset.rows.length },
      });
      return reset.rows.length;
    });

    // After the commit. If the message is lost, the sweeper sends it again (ADR-014).
    try {
      await queue.sendJob(jobId);
    } catch (error) {
      request.log.error({ err: error, jobId }, 'retry job message not sent; the sweeper will send it');
    }
    // Counts moved from failed to pending, so open dashboards reload (D-M3-3).
    await pushJobUpdate({ db: queryable, post, log }, jobId, new Date());
    return reply.code(202).send({ retried });
  });
}
