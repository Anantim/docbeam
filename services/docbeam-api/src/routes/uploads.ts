import { randomUUID } from 'node:crypto';
import { ApiError, hexToBase64, isAllowedType, isMultipart, isSha256Hex, LIMITS, partCount } from '@docbeam/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db.js';
import { files } from '../schema.js';
import type { ObjectStore } from '../s3.js';
import { parse, UUID_PATTERN } from '../validate.js';

const sha256 = z.string().refine(isSha256Hex);
const partNumber = z.number().int().min(1).max(10_000);

const uploadsBody = z.object({
  files: z
    .array(
      z.object({
        name: z
          .string()
          .min(1)
          .max(255)
          .refine((n) => !/[\r\n]/.test(n)),
        sizeBytes: z.number().int().min(1).max(LIMITS.maxFileBytes),
        contentType: z.string().refine(isAllowedType),
        sha256,
      }),
    )
    .min(1)
    .max(LIMITS.uploadWave),
});

const startBody = z.object({ parts: z.array(z.object({ partNumber, sha256 })).min(1).max(10_000) });
const completeBody = z.object({ parts: z.array(z.object({ partNumber, etag: z.string().min(1).max(200) })).min(1).max(10_000) });

type FileRow = typeof files.$inferSelect;

/** The file, only if the caller owns it. Anyone else gets the same 404 as a missing file. */
async function ownFile(db: Db, fileId: string, userId: string): Promise<FileRow> {
  if (!UUID_PATTERN.test(fileId)) throw new ApiError(404, 'NOT_FOUND', 'File not found.');
  const [row] = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.ownerUserId, userId)));
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'File not found.');
  return row;
}

function distinctPartNumbers(parts: { partNumber: number }[], expected: number, what: string): void {
  const seen = new Set(parts.map((p) => p.partNumber));
  const outOfRange = parts.some((p) => p.partNumber > expected);
  if (seen.size !== parts.length || outOfRange) throw new ApiError(400, 'VALIDATION_ERROR', `${what} lists a part twice or a part that does not exist.`);
}

export function registerUploadRoutes(app: FastifyInstance, db: Db, store: ObjectStore): void {
  const user = { preHandler: app.requireAuth({ use: 'user' }) };

  // POST /uploads: one file row and one link per file. Nothing here talks to AWS (links are signed locally).
  app.post('/uploads', user, async (request, reply) => {
    const principal = request.principal;
    if (principal?.tokenUse !== 'user') throw new ApiError(401, 'UNAUTHORIZED', 'Sign in again.');
    const body = parse(uploadsBody, request.body, `Send 1 to ${LIMITS.uploadWave} files of the allowed types, up to 1 GB each.`);

    const rows = body.files.map((f) => {
      const id = randomUUID();
      return { ...f, id, key: `staging/${principal.userId}/${id}` };
    });

    const uploads = await Promise.all(
      rows.map(async (f) => {
        if (isMultipart(f.sizeBytes)) {
          return { fileId: f.id, multipart: true as const, partSize: LIMITS.partBytes, partCount: partCount(f.sizeBytes) };
        }
        const post = await store.presignPost({ key: f.key, contentType: f.contentType, sizeBytes: f.sizeBytes, sha256Hex: f.sha256 });
        return { fileId: f.id, post };
      }),
    );

    await db.insert(files).values(
      rows.map((f) => ({
        id: f.id,
        ownerUserId: principal.userId,
        originalName: f.name,
        sizeBytes: f.sizeBytes,
        contentType: f.contentType,
        checksumSha256: f.sha256,
        s3Key: f.key,
        // The POST policy makes S3 enforce the declared SHA-256, so a single-part file is confirmed already (D-M2-7).
        s3Checksum: isMultipart(f.sizeBytes) ? null : hexToBase64(f.sha256),
      })),
    );

    return reply.code(201).send({ uploads });
  });

  // Start: the one call to S3 for a large file. Every part is signed with its own SHA-256.
  app.post('/files/:fileId/multipart-uploads', user, async (request, reply) => {
    const principal = request.principal;
    if (principal?.tokenUse !== 'user') throw new ApiError(401, 'UNAUTHORIZED', 'Sign in again.');
    const { fileId } = request.params as { fileId: string };
    const file = await ownFile(db, fileId, principal.userId);
    const body = parse(startBody, request.body);

    if (!isMultipart(file.sizeBytes) || file.multipartUploadId !== null || file.jobId !== null) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'This file cannot start a multipart upload.');
    }
    const expected = partCount(file.sizeBytes);
    if (body.parts.length !== expected) throw new ApiError(400, 'VALIDATION_ERROR', `This file has ${expected} parts.`);
    distinctPartNumbers(body.parts, expected, 'The request');

    const uploadId = await store.createMultipart({ key: file.s3Key, contentType: file.contentType });
    // Two starts at once: the first update wins and the second cleans up after itself.
    const claimed = await db
      .update(files)
      .set({ multipartUploadId: uploadId })
      .where(and(eq(files.id, file.id), isNull(files.multipartUploadId)))
      .returning({ id: files.id });
    if (claimed.length === 0) {
      await store.abortMultipart({ key: file.s3Key, uploadId });
      throw new ApiError(400, 'VALIDATION_ERROR', 'This file has already started its upload.');
    }

    const parts = await Promise.all(
      body.parts.map(async (p) => ({
        partNumber: p.partNumber,
        url: await store.presignPart({ key: file.s3Key, uploadId, partNumber: p.partNumber, sha256Hex: p.sha256 }),
      })),
    );
    const abortUrl = await store.presignAbort({ key: file.s3Key, uploadId });
    return reply.code(201).send({ uploadId, parts, abortUrl });
  });

  // Re-sign: fresh links for parts that have not started, for an upload that outlasts 15 minutes.
  app.post('/files/:fileId/multipart-uploads/:uploadId/parts', user, async (request, reply) => {
    const principal = request.principal;
    if (principal?.tokenUse !== 'user') throw new ApiError(401, 'UNAUTHORIZED', 'Sign in again.');
    const { fileId, uploadId } = request.params as { fileId: string; uploadId: string };
    const file = await ownFile(db, fileId, principal.userId);
    if (file.multipartUploadId === null || file.multipartUploadId !== uploadId) throw new ApiError(404, 'NOT_FOUND', 'Upload not found.');
    const body = parse(startBody, request.body);
    distinctPartNumbers(body.parts, partCount(file.sizeBytes), 'The request');

    const parts = await Promise.all(
      body.parts.map(async (p) => ({
        partNumber: p.partNumber,
        url: await store.presignPart({ key: file.s3Key, uploadId, partNumber: p.partNumber, sha256Hex: p.sha256 }),
      })),
    );
    return reply.code(201).send({ parts });
  });

  // Complete: S3 is asked which parts it holds, so the browser's list alone is never trusted.
  app.post('/files/:fileId/multipart-uploads/:uploadId/complete', user, async (request) => {
    const principal = request.principal;
    if (principal?.tokenUse !== 'user') throw new ApiError(401, 'UNAUTHORIZED', 'Sign in again.');
    const { fileId, uploadId } = request.params as { fileId: string; uploadId: string };
    const file = await ownFile(db, fileId, principal.userId);
    if (file.multipartUploadId === null || file.multipartUploadId !== uploadId) throw new ApiError(404, 'NOT_FOUND', 'Upload not found.');
    // Already completed: the same answer again.
    if (file.s3Checksum !== null) return { fileId: file.id };

    const body = parse(completeBody, request.body);
    const expected = partCount(file.sizeBytes);
    const incomplete = (message: string): ApiError => new ApiError(422, 'MULTIPART_INCOMPLETE', message);

    const stored = await store.listParts({ key: file.s3Key, uploadId });
    const byNumber = new Map(stored.map((p) => [p.partNumber, p]));
    if (byNumber.size !== expected) throw incomplete(`The upload has ${byNumber.size} of ${expected} parts.`);
    for (let n = 1; n <= expected; n += 1) {
      const part = byNumber.get(n);
      const claimed = body.parts.find((p) => p.partNumber === n);
      if (!part || !claimed) throw incomplete(`Part ${n} is missing.`);
      if (part.etag.replaceAll('"', '') !== claimed.etag.replaceAll('"', '')) throw incomplete(`Part ${n} does not match what was stored.`);
    }
    const total = stored.reduce((sum, p) => sum + p.size, 0);
    if (total !== file.sizeBytes) throw incomplete('The parts do not add up to the declared size.');

    const checksum = await store.completeMultipart({ key: file.s3Key, uploadId, parts: stored });
    await db.update(files).set({ s3Checksum: checksum }).where(eq(files.id, file.id));
    return { fileId: file.id };
  });
}
