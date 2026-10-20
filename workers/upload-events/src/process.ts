import { createHash } from 'node:crypto';
import { Transform, type TransformCallback, type Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectTaggingCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { detectFileType, type ByteSource, type Logger, type UploadedObject } from '@docbeam/shared';
import type pg from 'pg';
import type { Scanner } from './scanner.js';

export interface Deps {
  db: Pick<pg.Pool, 'query' | 'connect'>;
  s3: S3Client;
  scanner: Scanner;
  log: Logger;
}

export interface FileRow {
  id: string;
  ownerUserId: string;
  originalName: string;
  sizeBytes: number;
  checksumSha256: string;
  s3Key: string;
  s3Checksum: string | null;
  scanStatus: string;
  /** What the browser said the file is (from its name): the file's contents must agree (D-F1-44). */
  contentType: string;
}

export type RowCheck = { kind: 'ok' } | { kind: 'wait' } | { kind: 'mismatch'; detail: string };

/**
 * What the object says about itself against what DocBeam recorded (ADR-016). `s3_checksum` is empty for a
 * multipart file until the API has completed the upload (D-G9), so the event is retried a little later.
 */
export function checkAgainstRow(
  row: Pick<FileRow, 'sizeBytes' | 's3Checksum'>,
  head: { size: number; checksum?: string | undefined },
): RowCheck {
  if (row.s3Checksum === null) return { kind: 'wait' };
  if (head.size !== row.sizeBytes) return { kind: 'mismatch', detail: `Stored ${head.size} bytes, declared ${row.sizeBytes}.` };
  if (head.checksum !== undefined && head.checksum !== row.s3Checksum) {
    return { kind: 'mismatch', detail: 'The stored checksum differs from the declared one.' };
  }
  return { kind: 'ok' };
}

/** Seconds to hide a failed event before SQS offers it again. The queue's own 1-hour timeout is only for a crash. */
export function retryDelaySeconds(receiveCount: number): number {
  const gaps = [30, 60, 120, 300];
  return gaps[Math.min(Math.max(receiveCount, 1), gaps.length) - 1] as number;
}

/** Passes bytes through while counting them and computing their SHA-256. */
class Measure extends Transform {
  readonly hash = createHash('sha256');
  bytes = 0;
  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.hash.update(chunk);
    this.bytes += chunk.length;
    callback(null, chunk);
  }
}

export type Outcome = 'done' | 'wait';

export async function processUpload(deps: Deps, object: UploadedObject): Promise<Outcome> {
  const { db, s3, log } = deps;
  const { rows } = await db.query<FileRow>(
    `SELECT id, owner_user_id AS "ownerUserId", original_name AS "originalName", size_bytes::float8 AS "sizeBytes",
            checksum_sha256 AS "checksumSha256", s3_key AS "s3Key", s3_checksum AS "s3Checksum", scan_status AS "scanStatus",
            content_type AS "contentType"
       FROM files WHERE id = $1`,
    [object.fileId],
  );
  const row = rows[0];
  if (!row || row.s3Key !== object.key) {
    log.warn('upload event for an unknown file', { fileId: object.fileId });
    return 'done';
  }

  // A repeated event changes nothing. A refused file's object is still removed, in case an earlier delete failed.
  if (row.scanStatus !== 'pending') {
    if (row.scanStatus === 'infected' || row.scanStatus === 'failed') await removeObject(deps, object);
    log.info('upload event already handled', { fileId: row.id, scanStatus: row.scanStatus });
    return 'done';
  }

  let head;
  try {
    head = await s3.send(new HeadObjectCommand({ Bucket: object.bucket, Key: object.key, ChecksumMode: 'ENABLED' }));
  } catch (error) {
    if ((error as { name?: string }).name === 'NotFound') {
      log.warn('upload event for an object that is gone', { fileId: row.id });
      return 'done';
    }
    throw error;
  }

  const check = checkAgainstRow(row, { size: head.ContentLength ?? -1, checksum: head.ChecksumSHA256 });
  if (check.kind === 'wait') return 'wait';
  if (check.kind === 'mismatch') {
    await refuse(deps, row, object, 'failed', { reason: 'MISMATCH', detail: check.detail });
    return 'done';
  }

  // The scan reads every byte, so the SHA-256 is worked out in the same pass. It is compared with the
  // declared value whatever the storage reports, which covers a multipart file's whole-file checksum too.
  const got = await s3.send(new GetObjectCommand({ Bucket: object.bucket, Key: object.key }));
  const source = got.Body as Readable;
  const measure = new Measure();
  source.on('error', (error) => measure.destroy(error));
  source.pipe(measure);
  const result = await deps.scanner.scan(measure);

  if (result.status === 'infected') {
    await refuse(deps, row, object, 'infected', { reason: 'MALWARE', signature: result.signature });
    return 'done';
  }
  const sha256 = measure.hash.digest('hex');
  if (measure.bytes !== row.sizeBytes || sha256 !== row.checksumSha256) {
    await refuse(deps, row, object, 'failed', { reason: 'MISMATCH', detail: 'The stored bytes do not match the declared SHA-256.' });
    return 'done';
  }

  // What the file really is, from its first bytes and, for a DOCX or an XLSX, the file list at the end of the ZIP (two or three
  // small range reads, not the whole file again). It must be what the file was declared to be; it is stored with the file and the
  // deliveries table, the preview and the download use it (D-F1-44).
  // A failed read (S3 throttling, a network error) is not an answer: it throws, and the event is tried again. Only what the bytes
  // show can refuse a file.
  const detected = await detectFileType(objectSource(s3, object, measure.bytes));
  if (detected !== row.contentType) {
    await refuse(deps, row, object, 'failed', {
      reason: 'CONTENT_TYPE',
      detail: detected === null ? `The contents are not a ${row.contentType} file.` : `The contents are ${detected}, but the file was sent as ${row.contentType}.`,
    });
    return 'done';
  }

  // Tag first, then the database: a row that says clean always has a tagged object behind it.
  await s3.send(
    new PutObjectTaggingCommand({
      Bucket: object.bucket,
      Key: object.key,
      Tagging: { TagSet: [{ Key: 'scan-status', Value: 'clean' }] },
    }),
  );
  const done = await db.query(
    `UPDATE files SET uploaded_at = now(), scan_status = 'clean', detected_type = $2
      WHERE id = $1 AND scan_status = 'pending' AND uploaded_at IS NULL`,
    [row.id, detected],
  );
  log.info('file confirmed clean', { fileId: row.id, changed: done.rowCount });
  return 'done';
}

/** The stored object as a `ByteSource`: each read is a ranged GET. */
function objectSource(s3: S3Client, object: UploadedObject, size: number): ByteSource {
  return {
    size,
    async read(start, end) {
      if (end <= start) return new Uint8Array(0); // a range with an end before its start would be ignored, and S3 would send the whole object
      const out = await s3.send(new GetObjectCommand({ Bucket: object.bucket, Key: object.key, Range: `bytes=${start}-${end - 1}` }));
      return (out.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
    },
  };
}

async function removeObject(deps: Deps, object: UploadedObject): Promise<void> {
  await deps.s3.send(new DeleteObjectCommand({ Bucket: object.bucket, Key: object.key }));
}

/**
 * A refused file is marked and audited in one transaction, then its object is deleted. The conditional
 * update means a repeated event writes no second audit event.
 */
async function refuse(
  deps: Deps,
  row: FileRow,
  object: UploadedObject,
  status: 'infected' | 'failed',
  detail: { reason: 'MALWARE' | 'MISMATCH' | 'CONTENT_TYPE'; signature?: string; detail?: string },
): Promise<void> {
  const client = await deps.db.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(`UPDATE files SET scan_status = $2 WHERE id = $1 AND scan_status = 'pending'`, [row.id, status]);
    if (updated.rowCount === 1) {
      await client.query(
        `INSERT INTO audit_events (actor_id, action, detail) VALUES (NULL, 'file.refused', $1::jsonb)`,
        [JSON.stringify({ fileId: row.id, fileName: row.originalName, ownerUserId: row.ownerUserId, ...detail })],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  deps.log.warn('file refused', { fileId: row.id, status, reason: detail.reason });
  await removeObject(deps, object);
}
