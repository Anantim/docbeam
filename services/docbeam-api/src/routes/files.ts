import { ApiError, LIMITS } from '@docbeam/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';
import { files } from '../schema.js';
import { UUID_PATTERN } from '../validate.js';

export function registerFileRoutes(app: FastifyInstance, db: Db): void {
  // GET /files?ids=a,b,c: the browser asks every 2 seconds while any file is being checked (ADR-016).
  // Files that are not the caller's are left out, not reported as errors.
  app.get('/files', { preHandler: app.requireAuth({ use: 'user' }) }, async (request) => {
    const principal = request.principal;
    if (principal?.tokenUse !== 'user') throw new ApiError(401, 'UNAUTHORIZED', 'Sign in again.');

    const { ids } = request.query as { ids?: string };
    const wanted = (ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (wanted.length === 0 || wanted.length > LIMITS.maxFileIdsPerQuery || !wanted.every((id) => UUID_PATTERN.test(id))) {
      throw new ApiError(400, 'VALIDATION_ERROR', `The ids must hold 1 to ${LIMITS.maxFileIdsPerQuery} file ids.`);
    }

    const rows = await db
      .select({ id: files.id, uploadedAt: files.uploadedAt, scanStatus: files.scanStatus, createdAt: files.createdAt })
      .from(files)
      .where(and(eq(files.ownerUserId, principal.userId), inArray(files.id, wanted)));
    return rows.map((r) => ({ fileId: r.id, uploaded: r.uploadedAt !== null, scanStatus: r.scanStatus, createdAt: r.createdAt.toISOString() }));
  });
}
