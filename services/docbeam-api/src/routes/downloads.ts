// POST /files/:fileId/downloads (TDD Step 4.1, flow 4). Signs a 2-minute GET link for one object, but only
// after the checks: the sender, or a member of a team the file was delivered to. Everyone else gets the same
// 404 as for a file that does not exist, and no link or audit row is made.
import { ApiError, LIMITS } from '@docbeam/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';
import type { PlatformClient } from '../platform.js';
import type { ObjectStore } from '../s3.js';
import { auditEvents } from '../schema.js';
import { pgArray } from '../sql.js';
import { fileExpired } from '../tracking.js';
import { UUID_PATTERN } from '../validate.js';

export type DownloadMode = 'download' | 'preview';

export interface DownloadFile {
  scanStatus: string;
  uploadedAt: Date | null;
}

const notFound = (): ApiError => new ApiError(404, 'NOT_FOUND', 'That file is not available to you.');

/**
 * Decides who gets a link. Returns the caller's teams the file was delivered to (empty for the sender).
 * Order matters: a caller who is not allowed always gets 404, so 410 never reveals that a file exists.
 */
export function decideDownload(input: {
  file: DownloadFile;
  isSender: boolean;
  /** Teams with a completed delivery of this file. */
  deliveredTeams: readonly string[];
  /** The caller's teams. Not needed for the sender. */
  callerTeams: readonly string[];
  now: Date;
}): string[] {
  const { file, isSender, now } = input;
  if (file.uploadedAt === null || file.scanStatus !== 'clean') throw notFound();

  const mine = isSender ? [] : input.deliveredTeams.filter((t) => input.callerTeams.includes(t)).toSorted();
  if (!isSender && mine.length === 0) throw notFound();

  if (fileExpired(file.uploadedAt, now)) {
    throw new ApiError(410, 'FILE_EXPIRED', 'This file is no longer available. The delivered copy is still in the team folder.');
  }
  return mine;
}

export function parseMode(body: unknown): DownloadMode {
  const mode = body && typeof body === 'object' ? (body as { mode?: unknown }).mode : undefined;
  if (mode === undefined) return 'download';
  if (mode === 'download' || mode === 'preview') return mode;
  throw new ApiError(400, 'VALIDATION_ERROR', 'mode must be download or preview.');
}

export function registerDownloadRoutes(app: FastifyInstance, db: Db, { store, platform }: { store: ObjectStore; platform: PlatformClient }): void {
  app.post('/files/:fileId/downloads', { preHandler: app.requireAuth({ use: 'user' }) }, async (request, reply) => {
    const p = request.principal;
    if (p?.tokenUse !== 'user') throw new ApiError(401, 'UNAUTHORIZED', 'Sign in again.');
    const { fileId } = request.params as { fileId: string };
    const mode = parseMode(request.body);
    if (!UUID_PATTERN.test(fileId)) throw notFound();

    const found = await db.execute<{
      original_name: string; content_type: string; size_bytes: number; s3_key: string; scan_status: string;
      uploaded_at: Date | null; job_id: string; sender: string;
    }>(sql`
      SELECT f.original_name, COALESCE(f.detected_type, f.content_type) AS content_type, f.size_bytes, f.s3_key, f.scan_status, f.uploaded_at, f.job_id, j.submitted_by_user_id AS sender
        FROM files f JOIN jobs j ON j.id = f.job_id
       WHERE f.id = ${fileId}`);
    const row = found.rows[0];
    if (!row) throw notFound();

    const isSender = row.sender === p.userId;
    let delivered: string[] = [];
    let callerTeams: string[] = [];
    if (!isSender) {
      callerTeams = await platform.userTeams(p.userId);
      if (callerTeams.length > 0) {
        const teams = await db.execute<{ team_id: string }>(sql`
          SELECT DISTINCT team_id FROM tasks
           WHERE file_id = ${fileId} AND status = 'completed' AND team_id = ANY(${pgArray(callerTeams, 'uuid')})`);
        delivered = teams.rows.map((r) => r.team_id);
      }
    }

    const teamIds = decideDownload({
      file: { scanStatus: row.scan_status, uploadedAt: row.uploaded_at ? new Date(row.uploaded_at) : null },
      isSender,
      deliveredTeams: delivered,
      callerTeams,
      now: new Date(),
    });

    const url = await store.presignGet({ key: row.s3_key, fileName: row.original_name, contentType: row.content_type, mode });
    const expiresAt = new Date(Date.now() + LIMITS.downloadLinkSeconds * 1000).toISOString();

    // The link is already signed, so a failed audit write must fail the request: no link without a record.
    await db.insert(auditEvents).values({
      actorId: p.userId,
      action: 'download.issued',
      jobId: row.job_id,
      teamId: teamIds[0] ?? null,
      detail: { actorName: p.name, actorEmail: p.email, fileId, fileName: row.original_name, mode, teamIds },
    });

    return reply.code(201).send({ url, expiresAt, fileName: row.original_name, contentType: row.content_type, sizeBytes: Number(row.size_bytes) });
  });
}
