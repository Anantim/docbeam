// Who may see a job (TDD Step 3.1, "View or subscribe to a job"): the sender, or someone with a team that has
// a delivery in the job. Anyone else gets the same 404 as for a job that does not exist.
import { ApiError } from '@docbeam/shared';
import { sql } from 'drizzle-orm';
import type { Db } from './db.js';
import type { PlatformClient } from './platform.js';
import { pgArray } from './sql.js';
import { UUID_PATTERN } from './validate.js';

export interface JobRow {
  id: string;
  submittedByUserId: string;
  submittedByName: string;
  taskCount: number;
  createdAt: Date;
  queuedAt: Date;
  completedAt: Date | null;
  firstCompletedAt: Date | null;
  cancelledAt: Date | null;
}

export interface JobAccess {
  job: JobRow;
  isSender: boolean;
  /** The caller's teams when they are not the sender. Null for the sender, who sees every delivery. */
  teams: string[] | null;
}

const notFound = (): ApiError => new ApiError(404, 'NOT_FOUND', 'That distribution was not found.');

export async function findJob(db: Db, jobId: string): Promise<JobRow | null> {
  if (!UUID_PATTERN.test(jobId)) return null;
  const result = await db.execute<{
    id: string; submitted_by_user_id: string; submitted_by_name: string; task_count: number; created_at: Date;
    queued_at: Date; completed_at: Date | null; first_completed_at: Date | null; cancelled_at: Date | null;
  }>(sql`SELECT id, submitted_by_user_id, submitted_by_name, task_count, created_at, queued_at, completed_at,
                first_completed_at, cancelled_at FROM jobs WHERE id = ${jobId}`);
  const r = result.rows[0];
  if (!r) return null;
  return {
    id: r.id,
    submittedByUserId: r.submitted_by_user_id,
    submittedByName: r.submitted_by_name,
    taskCount: r.task_count,
    createdAt: new Date(r.created_at),
    queuedAt: new Date(r.queued_at),
    completedAt: r.completed_at ? new Date(r.completed_at) : null,
    firstCompletedAt: r.first_completed_at ? new Date(r.first_completed_at) : null,
    cancelledAt: r.cancelled_at ? new Date(r.cancelled_at) : null,
  };
}

/** Loads the job and decides whether the caller may see it. 404 for a missing job and for a hidden one. */
export async function loadAccess(db: Db, platform: PlatformClient, jobId: string, userId: string): Promise<JobAccess> {
  const job = await findJob(db, jobId);
  if (!job) throw notFound();
  if (job.submittedByUserId === userId) return { job, isSender: true, teams: null };

  const teams = await platform.userTeams(userId);
  if (teams.length === 0) throw notFound();
  const hit = await db.execute(
    sql`SELECT 1 FROM tasks WHERE job_id = ${jobId} AND team_id = ANY(${pgArray(teams, 'uuid')}) LIMIT 1`,
  );
  if (hit.rows.length === 0) throw notFound();
  return { job, isSender: false, teams };
}
