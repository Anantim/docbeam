import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// DocBeam DB (TDD "Database design"). jobs comes before files because files.job_id points at it.
// D-G6 adds jobs.submitted_by_name, D-G7 adds tasks.destination_path.

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey(),
    submittedByUserId: uuid('submitted_by_user_id').notNull(),
    submittedByName: text('submitted_by_name').notNull(),
    taskCount: integer('task_count').notNull(),
    /** Required header on POST /jobs. */
    idempotencyKey: text('idempotency_key').notNull(),
    /** Set at submit and at each retry. */
    queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set by fan-out; the sweeper watches it (ADR-014). */
    fannedOutAt: timestamp('fanned_out_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** Set the first time the job finishes, never cleared. */
    firstCompletedAt: timestamp('first_completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_jobs_user').on(t.submittedByUserId, sql`${t.createdAt} DESC`),
    uniqueIndex('uq_jobs_idem').on(t.submittedByUserId, t.idempotencyKey),
    index('idx_jobs_unstarted')
      .on(t.queuedAt)
      .where(sql`${t.fannedOutAt} IS NULL AND ${t.completedAt} IS NULL`),
  ],
);

export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey(),
    ownerUserId: uuid('owner_user_id').notNull(),
    /** NULL until a job claims the file. */
    jobId: uuid('job_id').references(() => jobs.id),
    originalName: text('original_name').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    contentType: text('content_type').notNull(),
    /** Declared when the upload link is requested. */
    checksumSha256: text('checksum_sha256').notNull(),
    /** staging/{owner_user_id}/{file_id} */
    s3Key: text('s3_key').notNull(),
    /** Files over 100 MB only. */
    multipartUploadId: text('multipart_upload_id'),
    /** What S3 confirmed: the SHA-256, or for a multipart file the checksum of its part checksums. */
    s3Checksum: text('s3_checksum'),
    /** Set by the Upload Events Lambda (ADR-016). */
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
    scanStatus: text('scan_status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('files_scan_status_check', sql`${t.scanStatus} IN ('pending','clean','infected','failed')`),
    index('idx_files_owner').on(t.ownerUserId, t.createdAt),
    index('idx_files_unsubmitted').on(t.createdAt).where(sql`${t.jobId} IS NULL`),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id),
    teamId: uuid('team_id').notNull(),
    binderId: uuid('binder_id').notNull(),
    /** Always set for a new task (D-F1-3). NULL only in tasks made before that, aimed at the top level of a binder. */
    folderId: uuid('folder_id'),
    /** For example "Cardio / CARDIO-301 Regulatory / Protocol amendments", from the destination check. */
    destinationPath: text('destination_path').notNull(),
    status: text('status').notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    failureCode: text('failure_code'),
    /** File name, destination and detail, shown on the dashboard. */
    failureReason: text('failure_reason'),
    /** The latest temporary error. */
    lastError: text('last_error'),
    platformDocumentId: uuid('platform_document_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('tasks_status_check', sql`${t.status} IN ('pending','in_progress','completed','failed')`),
    uniqueIndex('uq_tasks_dest').on(t.fileId, t.binderId, t.folderId).where(sql`${t.folderId} IS NOT NULL`),
    uniqueIndex('uq_tasks_dest_root').on(t.fileId, t.binderId).where(sql`${t.folderId} IS NULL`),
    index('idx_tasks_job_status').on(t.jobId, t.status),
    index('idx_tasks_team').on(t.teamId, t.jobId),
  ],
);

export const wsConnections = pgTable(
  'ws_connections',
  {
    /** API Gateway connection id. */
    connectionId: text('connection_id').primaryKey(),
    userId: uuid('user_id').notNull(),
    /** The job currently subscribed to. */
    jobId: uuid('job_id'),
    /** The viewer's teams, read at subscribe. */
    teamIds: uuid('team_ids').array().notNull().default(sql`'{}'`),
    /** Token expiry; nothing is pushed after it. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_ws_job').on(t.jobId)],
);

/** Append-only: the app role gets INSERT and SELECT only (D-G8, migration 0001_audit_grants). */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    /** The user; NULL for system events. */
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    jobId: uuid('job_id').references(() => jobs.id),
    taskId: uuid('task_id'),
    /** The delivery's team; NULL for job-wide events. */
    teamId: uuid('team_id'),
    /** Includes actorName and actorEmail (D-G6). */
    detail: jsonb('detail').notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    index('idx_audit_job').on(t.jobId, sql`${t.occurredAt} DESC`),
    index('idx_audit_time').on(sql`${t.occurredAt} DESC`),
  ],
);
