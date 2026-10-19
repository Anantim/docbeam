import { randomUUID } from 'node:crypto';
import { ApiError, errorBody, LIMITS, validateBatch } from '@docbeam/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db.js';
import type { DestinationInput, PlatformClient } from '../platform.js';
import type { JobQueue } from '../queue.js';
import { auditEvents, jobs } from '../schema.js';
import { pgArray } from '../sql.js';
import { parse, UUID_PATTERN } from '../validate.js';

const uuid = z.string().regex(UUID_PATTERN);

export const jobBody = z.object({
  // Counts and the folder rule are checked by validateBatch (422 INVALID_BATCH, D-F1-3), so folderId may be absent
  // here and fail with the same code as every other batch rule. These caps only keep an absurd body from being parsed.
  files: z.array(z.object({ fileId: uuid, sha256: z.string() })).max(1_000),
  mappings: z
    .array(z.object({ fileId: uuid, destinations: z.array(z.object({ binderId: uuid, folderId: uuid.nullish() })).max(1_000) }))
    .max(1_000),
});

export interface FileState {
  id: string;
  ownerUserId: string;
  jobId: string | null;
  checksumSha256: string;
  uploadedAt: Date | null;
  scanStatus: string;
  createdAt: Date;
}

/**
 * The first problem with the files of a batch, or null. The order follows the contract: a file that is not the
 * caller's looks like a file that does not exist; then age, readiness, an earlier job, and the SHA-256.
 */
export function firstFileProblem(
  requested: { fileId: string; sha256: string }[],
  rows: FileState[],
  userId: string,
  now: Date,
): ApiError | null {
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const wanted of requested) {
    const row = byId.get(wanted.fileId);
    if (!row || row.ownerUserId !== userId) return new ApiError(422, 'INVALID_BATCH', 'A file in the distribution was not found.');
    if (now.getTime() - row.createdAt.getTime() > LIMITS.maxFileAgeMs) {
      return new ApiError(422, 'FILE_TOO_OLD', 'A file was uploaded more than 24 hours ago. Add it again.');
    }
    if (row.uploadedAt === null || row.scanStatus !== 'clean') {
      return new ApiError(422, 'FILE_NOT_READY', 'A file has not finished uploading and being checked.');
    }
    if (row.jobId !== null) return new ApiError(409, 'FILE_ALREADY_SUBMITTED', 'A file is already part of another distribution.');
    if (row.checksumSha256 !== wanted.sha256.toLowerCase()) {
      return new ApiError(422, 'CHECKSUM_MISMATCH', 'A file does not match the fingerprint it was uploaded with.');
    }
  }
  return null;
}

/** Thrown inside the transaction so that it rolls back when another request took a file first. */
class FileClaimLost extends Error {}

export interface JobRouteDeps {
  platform: PlatformClient;
  queue: JobQueue;
}

export function registerJobRoutes(app: FastifyInstance, db: Db, { platform, queue }: JobRouteDeps): void {
  const user = { preHandler: app.requireAuth({ use: 'user' }) };

  async function findJob(userId: string, key: string): Promise<{ jobId: string; taskCount: number } | null> {
    const [row] = await db
      .select({ jobId: jobs.id, taskCount: jobs.taskCount })
      .from(jobs)
      .where(and(eq(jobs.submittedByUserId, userId), eq(jobs.idempotencyKey, key)));
    return row ?? null;
  }

  async function loadFiles(ids: string[]): Promise<FileState[]> {
    const result = await db.execute<{
      id: string; owner_user_id: string; job_id: string | null; checksum_sha256: string;
      uploaded_at: Date | null; scan_status: string; created_at: Date;
    }>(sql`SELECT id, owner_user_id, job_id, checksum_sha256, uploaded_at, scan_status, created_at
             FROM files WHERE id = ANY(${pgArray(ids, 'uuid')})`);
    return result.rows.map((r) => ({
      id: r.id,
      ownerUserId: r.owner_user_id,
      jobId: r.job_id,
      checksumSha256: r.checksum_sha256,
      uploadedAt: r.uploaded_at,
      scanStatus: r.scan_status,
      createdAt: new Date(r.created_at),
    }));
  }

  app.post('/jobs', user, async (request, reply) => {
    const principal = request.principal;
    if (principal?.tokenUse !== 'user') throw new ApiError(401, 'UNAUTHORIZED', 'Sign in again.');

    const header = request.headers['idempotency-key'];
    const key = typeof header === 'string' ? header.trim() : '';
    if (!key) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header.');
    if (key.length > 200) throw new ApiError(400, 'VALIDATION_ERROR', 'The Idempotency-Key is too long.');
    // Laps since the request reached the service; the plugin logs them (timing.ts). Everything before this line
    // (body read, JSON parse, token check) was lapped by the plugin and the auth hook.
    const timer = request.submitTimer;
    timer?.lap('authMs');
    const body = parse(jobBody, request.body, 'Send files and mappings.');
    timer?.lap('schemaMs');

    // A repeated key returns the job it made, with no new checks (and so no call to the platform).
    const earlier = await findJob(principal.userId, key);
    if (earlier) return reply.code(200).send(earlier);
    timer?.lap('keyLookupMs');

    const batch = validateBatch({
      files: body.files,
      mappings: body.mappings.map((m) => ({ fileId: m.fileId, destinations: m.destinations })),
    });
    if (!batch.ok) throw new ApiError(422, 'INVALID_BATCH', batch.reason);
    if (timer) timer.size = { files: body.files.length, destinations: batch.destinationCount, tasks: batch.taskCount };
    timer?.lap('batchMs');

    try {
      // One call for every distinct destination. The team comes from the platform, never from the browser.
      const wanted = new Map<string, DestinationInput>();
      for (const m of body.mappings) {
        for (const d of m.destinations) wanted.set(`${d.binderId}:${d.folderId ?? ''}`, { binderId: d.binderId, folderId: d.folderId ?? null });
      }
      const keys = [...wanted.keys()];
      // The file check and the destination check do not depend on each other, so they run together (D-M5-10).
      // A file problem is still reported first: the destination answer is only looked at after it.
      const call = platform.checkDestinations(principal.userId, [...wanted.values()]);
      const checking = timer ? timer.span('destinationCallMs', call) : call;
      checking.catch(() => undefined); // read below; this only stops an unhandled rejection when a file problem comes first
      const problem = firstFileProblem(body.files, await loadFiles(body.files.map((f) => f.fileId)), principal.userId, new Date());
      if (problem) throw problem;
      timer?.lap('filesMs');

      const checked = await checking;
      if (!checked.ok) {
        return reply.code(422).send({
          ...errorBody('DESTINATION_NOT_FOUND', 'Some destinations were not found or are not in your teams.'),
          notFound: checked.notFound,
        });
      }
      timer?.lap('destinationWaitMs');
      const resolved = new Map(keys.map((k, i) => [k, checked.destinations[i]]));

      const jobId = randomUUID();
      const rows = body.mappings.flatMap((m) =>
        m.destinations.map((d) => {
          const r = resolved.get(`${d.binderId}:${d.folderId ?? ''}`);
          if (!r) throw new ApiError(503, 'PLATFORM_UNAVAILABLE', 'The platform returned an incomplete answer.');
          return { fileId: m.fileId, teamId: r.teamId, binderId: d.binderId, folderId: d.folderId ?? null, path: r.path };
        }),
      );
      const fileIds = body.files.map((f) => f.fileId);
      timer?.lap('rowsMs');

      // One transaction: the job, the claim on its files, every task, and the audit event.
      const created = await db
        .transaction(async (tx) => {
          const inserted = await tx
            .insert(jobs)
            .values({
              id: jobId,
              submittedByUserId: principal.userId,
              submittedByName: principal.name,
              taskCount: rows.length,
              idempotencyKey: key,
            })
            .onConflictDoNothing({ target: [jobs.submittedByUserId, jobs.idempotencyKey] })
            .returning({ id: jobs.id });
          // The same key won in parallel: nothing here is written, and the caller gets that job.
          if (inserted.length === 0) return false;

          const claimed = await tx.execute(sql`
            UPDATE files SET job_id = ${jobId}
             WHERE id = ANY(${pgArray(fileIds, 'uuid')}) AND owner_user_id = ${principal.userId}
               AND job_id IS NULL AND uploaded_at IS NOT NULL AND scan_status = 'clean'
               AND created_at > now() - interval '24 hours'
            RETURNING id`);
          if (claimed.rows.length !== fileIds.length) throw new FileClaimLost();
          timer?.lap('claimMs'); // begin, the job row and the claim on the files

          await tx.execute(sql`
            INSERT INTO tasks (id, job_id, file_id, team_id, binder_id, folder_id, destination_path)
            SELECT gen_random_uuid(), ${jobId}::uuid, t.file_id, t.team_id, t.binder_id, t.folder_id, t.path
              FROM unnest(
                ${pgArray(rows.map((r) => r.fileId), 'uuid')},
                ${pgArray(rows.map((r) => r.teamId), 'uuid')},
                ${pgArray(rows.map((r) => r.binderId), 'uuid')},
                ${pgArray(rows.map((r) => r.folderId), 'uuid')},
                ${pgArray(rows.map((r) => r.path), 'text')}
              ) AS t(file_id, team_id, binder_id, folder_id, path)`);
          timer?.lap('tasksMs');

          await tx.insert(auditEvents).values({
            actorId: principal.userId,
            action: 'job.submitted',
            jobId,
            detail: {
              actorName: principal.name,
              actorEmail: principal.email,
              fileCount: fileIds.length,
              destinationCount: batch.destinationCount,
              taskCount: rows.length,
            },
          });
          return true;
        })
        .catch(async (error: unknown) => {
          if (!(error instanceof FileClaimLost)) throw error;
          // Another request took or removed a file between the check and the claim: say which problem it is now.
          throw (
            firstFileProblem(body.files, await loadFiles(fileIds), principal.userId, new Date()) ??
            new ApiError(409, 'FILE_ALREADY_SUBMITTED', 'A file is already part of another distribution.')
          );
        });

      timer?.lap('commitMs'); // the audit row and the commit
      if (!created) {
        const winner = await findJob(principal.userId, key);
        if (winner) return reply.code(200).send(winner);
        throw new ApiError(500, 'INTERNAL_ERROR', 'The distribution could not be saved.');
      }

      // After the commit. If this fails the job still exists, and the sweeper sends the message again (ADR-014).
      try {
        await queue.sendJob(jobId);
      } catch (error) {
        request.log.error({ err: error, jobId }, 'job message not sent; the sweeper will send it');
      }
      timer?.lap('queueMs');
      return reply.code(201).send({ jobId, taskCount: rows.length });
    } catch (error) {
      // A parallel request with the same key may have claimed the files first. Its job is the answer.
      if (error instanceof ApiError) {
        const winner = await findJob(principal.userId, key);
        if (winner) return reply.code(200).send(winner);
      }
      throw error;
    }
  });
}
