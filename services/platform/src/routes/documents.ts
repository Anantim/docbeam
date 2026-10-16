import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { DeleteObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { Multipart, MultipartFile } from '@fastify/multipart';
import { ApiError, isAllowedType, LIMITS, matchesSignature, SIGNATURE_BYTES } from '@docbeam/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';
import { IngestLimiter, RETRY_AFTER_SECONDS } from '../ingest-limiter.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
/** The hard size limit of the design (1 GiB). */
export const MAX_FILE_BYTES = LIMITS.maxFileBytes;
/**
 * How the Platform File Store upload buffers: one part of 5 MB (the smallest S3 allows) at a time, so one upload holds
 * about 5 MB however big the file is. The SDK default (4 parts at once) held about 20 MB, and 14 large deliveries at
 * once ran a 512 MB task out of memory on dev (D-M2-22).
 */
export const UPLOAD_BUFFER = { queueSize: 1, partSize: 5 * 1024 * 1024 } as const;

interface Fields {
  taskId: string;
  binderId: string;
  folderId: string | null;
  name: string;
  contentType: string;
  checksumSha256: string;
  onBehalfOf: string;
}

function parseFields(raw: Record<string, string>): Fields {
  const bad = () => new ApiError(400, 'VALIDATION_ERROR', 'Send taskId, binderId, name, contentType, checksumSha256 and onBehalfOf before the file.');
  const { taskId, binderId, folderId, name, contentType, checksumSha256, onBehalfOf } = raw;
  if (!taskId || !binderId || !name || !contentType || !checksumSha256 || !onBehalfOf) throw bad();
  if (!UUID.test(taskId) || !UUID.test(binderId) || !UUID.test(onBehalfOf)) throw bad();
  if (folderId && !UUID.test(folderId)) throw bad();
  if (!SHA256.test(checksumSha256)) throw bad();
  return { taskId, binderId, folderId: folderId || null, name, contentType, checksumSha256: checksumSha256.toLowerCase(), onBehalfOf };
}

export function registerDocumentRoutes(
  app: FastifyInstance,
  db: Db,
  s3: S3Client,
  bucket: string,
  limiter: IngestLimiter = new IngestLimiter(),
): void {
  const remove = (key: string) => s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));

  async function existingDocument(taskId: string): Promise<string | undefined> {
    const r = await db.execute<{ id: string }>(sql`SELECT id FROM documents WHERE source_task_id = ${taskId}`);
    return r.rows[0]?.id;
  }

  /** 404 for a binder or folder that is gone, 403 when the user left the team (ADR-013). */
  async function checkDestination(f: Fields): Promise<void> {
    const r = await db.execute<{ folder_ok: boolean; member: boolean }>(sql`
      SELECT (${f.folderId}::uuid IS NULL OR EXISTS (
                SELECT 1 FROM folders fo WHERE fo.id = ${f.folderId}::uuid AND fo.binder_id = b.id)) AS folder_ok,
             EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = b.team_id AND m.user_id = ${f.onBehalfOf}) AS member
        FROM binders b WHERE b.id = ${f.binderId}`);
    const row = r.rows[0];
    if (!row || !row.folder_ok) throw new ApiError(404, 'DESTINATION_NOT_FOUND', 'The destination was not found.');
    if (!row.member) throw new ApiError(403, 'NOT_A_MEMBER', 'The user is no longer a member of this team.');
  }

  app.post(
    '/documents',
    { preHandler: app.requireAuth({ use: 'service', scope: 'documents:ingest' }) },
    async (request, reply) => {
      if (!request.isMultipart()) throw new ApiError(400, 'VALIDATION_ERROR', 'Send multipart/form-data.');

      // The text fields come first, so every check that needs no bytes runs before one is read (D-M1-6).
      const raw: Record<string, string> = {};
      let file: MultipartFile | undefined;
      for await (const part of request.parts({ limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 10 } }) as AsyncIterable<Multipart>) {
        if (part.type === 'field') raw[part.fieldname] = String(part.value);
        else {
          file = part;
          break;
        }
      }
      if (!file) throw new ApiError(400, 'VALIDATION_ERROR', 'The file is missing.');
      const stream = file.file;
      const fields = parseFields(raw);

      await checkDestination(fields);

      const repeat = await existingDocument(fields.taskId);
      if (repeat) {
        stream.resume();
        return reply.status(200).send({ documentId: repeat });
      }

      if (!isAllowedType(fields.contentType)) {
        stream.resume();
        throw new ApiError(422, 'UNSUPPORTED_TYPE', 'This file type is not allowed.');
      }

      // Only a few files are read at once. A request that waits too long is turned away before its bytes are read,
      // with the connection closed so the unread body is dropped (D-M2-22).
      try {
        const release = await limiter.acquire();
        // A caller that gave up while waiting has already closed; its turn must not be held for ever.
        if (reply.raw.destroyed || reply.raw.closed) release();
        else reply.raw.once('close', release);
      } catch (error) {
        reply.header('retry-after', String(RETRY_AFTER_SECONDS)).header('connection', 'close');
        throw error;
      }

      // Read until the signature can be checked, then stream everything, head included, to the store.
      const iterator = stream[Symbol.asyncIterator]();
      const head: Buffer[] = [];
      let headBytes = 0;
      let ended = false;
      while (headBytes < SIGNATURE_BYTES && !ended) {
        const next = await iterator.next();
        if (next.done) ended = true;
        else {
          head.push(next.value as Buffer);
          headBytes += (next.value as Buffer).length;
        }
      }
      if (!matchesSignature(fields.contentType, Buffer.concat(head))) {
        stream.resume();
        throw new ApiError(422, 'UNSUPPORTED_TYPE', 'The file does not match its declared type.');
      }

      const hash = createHash('sha256');
      let size = 0;
      const body = Readable.from(
        (async function* () {
          for (const chunk of head) {
            hash.update(chunk);
            size += chunk.length;
            yield chunk;
          }
          while (!ended) {
            const next = await iterator.next();
            if (next.done) return;
            const chunk = next.value as Buffer;
            hash.update(chunk);
            size += chunk.length;
            yield chunk;
          }
        })(),
      );

      const documentId = randomUUID();
      const storageKey = `documents/${documentId}`;
      await new Upload({
        client: s3,
        ...UPLOAD_BUFFER,
        params: { Bucket: bucket, Key: storageKey, Body: body, ContentType: fields.contentType },
      }).done();

      // The platform recomputes the whole SHA-256 itself (integrity chain).
      if (hash.digest('hex') !== fields.checksumSha256 || file.file.truncated) {
        await remove(storageKey);
        throw new ApiError(422, 'CHECKSUM_MISMATCH', 'The file does not match its SHA-256.');
      }

      const inserted = await db.execute<{ id: string }>(sql`
        INSERT INTO documents (id, binder_id, folder_id, name, size_bytes, content_type, checksum_sha256, storage_key, source_task_id, uploaded_by_user_id)
        VALUES (${documentId}, ${fields.binderId}, ${fields.folderId}, ${fields.name}, ${size}, ${fields.contentType},
                ${fields.checksumSha256}, ${storageKey}, ${fields.taskId}, ${fields.onBehalfOf})
        ON CONFLICT (source_task_id) DO NOTHING
        RETURNING id`);
      if (inserted.rows.length === 1) return reply.status(201).send({ documentId });

      // A parallel repeat won the race: drop this copy and answer with the winner's document.
      await remove(storageKey);
      const winner = await existingDocument(fields.taskId);
      if (!winner) throw new Error('document vanished after a conflict');
      return reply.status(200).send({ documentId: winner });
    },
  );
}
