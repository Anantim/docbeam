import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  ListPartsCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { hexToBase64, LIMITS } from '@docbeam/shared';
import type { Config } from './config.js';

export interface PostForm {
  url: string;
  fields: Record<string, string>;
}

export interface StoredPart {
  partNumber: number;
  etag: string;
  size: number;
  /** Base64 SHA-256 that S3 recorded for the part. */
  checksumSha256: string;
}

/** Everything the upload routes need from the Object Store (ADR-002). One seam, so tests can stand in for S3. */
export interface ObjectStore {
  presignPost(args: { key: string; contentType: string; sizeBytes: number; sha256Hex: string }): Promise<PostForm>;
  createMultipart(args: { key: string; contentType: string }): Promise<string>;
  presignPart(args: { key: string; uploadId: string; partNumber: number; sha256Hex: string }): Promise<string>;
  presignAbort(args: { key: string; uploadId: string }): Promise<string>;
  listParts(args: { key: string; uploadId: string }): Promise<StoredPart[]>;
  /** Completes the upload and returns the combined checksum S3 reports, `<base64>-<parts>`. */
  completeMultipart(args: { key: string; uploadId: string; parts: StoredPart[] }): Promise<string>;
  abortMultipart(args: { key: string; uploadId: string }): Promise<void>;
  /** A GET link for one object (ADR-004). `download` saves it under its name; `preview` opens it inline. */
  presignGet(args: { key: string; fileName: string; contentType: string; mode: 'download' | 'preview'; expiresIn?: number }): Promise<string>;
}

/**
 * The `Content-Disposition` for a link. The plain `filename` is ASCII only, with quotes, backslashes, slashes
 * and control characters taken out; `filename*` carries the real name, percent-encoded (RFC 6266 and 5987).
 */
export function contentDisposition(fileName: string, mode: 'download' | 'preview'): string {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\/;]/g, '_') || 'file';
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  // A preview opens inline and still carries the name, so a viewer with no title for the file shows it (D-F1-81).
  return `${mode === 'preview' ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** The header the browser must send with each part so that S3 checks the part's SHA-256. */
export const PART_CHECKSUM_HEADER = 'x-amz-checksum-sha256';

export function createObjectStore(config: Pick<Config, 'OBJECT_STORE_BUCKET' | 'AWS_REGION' | 'AWS_ENDPOINT_URL' | 'S3_PUBLIC_ENDPOINT'>): ObjectStore {
  const Bucket = config.OBJECT_STORE_BUCKET;
  const local = config.AWS_ENDPOINT_URL ? { forcePathStyle: true } : {};

  // Calls the service makes itself go to the internal address.
  const client = new S3Client({
    region: config.AWS_REGION,
    ...(config.AWS_ENDPOINT_URL ? { endpoint: config.AWS_ENDPOINT_URL } : {}),
    ...local,
  });
  // Links go to the browser, so locally they must name an address the browser can reach (D-M2-11).
  // Signing is done in this process; it never calls AWS.
  const publicEndpoint = config.S3_PUBLIC_ENDPOINT ?? config.AWS_ENDPOINT_URL;
  const signer = new S3Client({
    region: config.AWS_REGION,
    ...(publicEndpoint ? { endpoint: publicEndpoint } : {}),
    ...local,
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
  const expiresIn = LIMITS.uploadLinkSeconds;

  return {
    async presignPost({ key, contentType, sizeBytes, sha256Hex }) {
      return createPresignedPost(signer, {
        Bucket,
        Key: key,
        Expires: expiresIn,
        // Each field is also signed into the policy as an exact match, so S3 enforces the type and the SHA-256.
        Fields: { 'Content-Type': contentType, 'x-amz-checksum-sha256': hexToBase64(sha256Hex) },
        Conditions: [['content-length-range', 1, sizeBytes]],
      });
    },

    async createMultipart({ key, contentType }) {
      const out = await client.send(
        new CreateMultipartUploadCommand({ Bucket, Key: key, ContentType: contentType, ChecksumAlgorithm: 'SHA256' }),
      );
      if (!out.UploadId) throw new Error('S3 returned no upload id.');
      return out.UploadId;
    },

    presignPart({ key, uploadId, partNumber, sha256Hex }) {
      const command = new UploadPartCommand({
        Bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
        ChecksumSHA256: hexToBase64(sha256Hex),
      });
      // The checksum stays a signed header (not moved into the query string), so S3 compares it with the bytes.
      return getSignedUrl(signer, command, {
        expiresIn,
        unhoistableHeaders: new Set([PART_CHECKSUM_HEADER]),
        signableHeaders: new Set([PART_CHECKSUM_HEADER]),
      });
    },

    presignAbort({ key, uploadId }) {
      return getSignedUrl(signer, new AbortMultipartUploadCommand({ Bucket, Key: key, UploadId: uploadId }), { expiresIn });
    },

    async listParts({ key, uploadId }) {
      const parts: StoredPart[] = [];
      let marker: string | undefined;
      for (;;) {
        const out = await client.send(
          new ListPartsCommand({ Bucket, Key: key, UploadId: uploadId, ...(marker ? { PartNumberMarker: marker } : {}) }),
        );
        for (const p of out.Parts ?? []) {
          if (p.PartNumber === undefined || !p.ETag) continue;
          parts.push({ partNumber: p.PartNumber, etag: p.ETag, size: p.Size ?? 0, checksumSha256: p.ChecksumSHA256 ?? '' });
        }
        if (!out.IsTruncated || out.NextPartNumberMarker === undefined) return parts;
        marker = out.NextPartNumberMarker;
      }
    },

    async completeMultipart({ key, uploadId, parts }) {
      const out = await client.send(
        new CompleteMultipartUploadCommand({
          Bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts
              .toSorted((a, b) => a.partNumber - b.partNumber)
              .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag, ChecksumSHA256: p.checksumSha256 })),
          },
        }),
      );
      if (!out.ChecksumSHA256) throw new Error('S3 returned no combined checksum.');
      return out.ChecksumSHA256.includes('-') ? out.ChecksumSHA256 : `${out.ChecksumSHA256}-${parts.length}`;
    },

    async abortMultipart({ key, uploadId }) {
      await client.send(new AbortMultipartUploadCommand({ Bucket, Key: key, UploadId: uploadId }));
    },

    presignGet({ key, fileName, contentType, mode, expiresIn: seconds = LIMITS.downloadLinkSeconds }) {
      const command = new GetObjectCommand({
        Bucket,
        Key: key,
        ResponseContentDisposition: contentDisposition(fileName, mode),
        // A preview shows the stored type; a download keeps the object's own.
        ...(mode === 'preview' ? { ResponseContentType: contentType } : {}),
      });
      return getSignedUrl(signer, command, { expiresIn: seconds });
    },
  };
}
