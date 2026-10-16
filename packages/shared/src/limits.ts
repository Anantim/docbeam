// Limits shared by the API, the workers and the web app. Pure values: this file must not import
// anything from Node, so the browser can use it through `@docbeam/shared/browser`.

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

export const LIMITS = {
  /** Files in one distribution. */
  maxFilesPerJob: 100,
  /** Distinct destinations in one distribution. */
  maxDestinationsPerJob: 20,
  /** Deliveries (file x destination) in one distribution. */
  maxTasksPerJob: 2_000,
  /** Hard size limit of one file (1 GiB). */
  maxFileBytes: GIB,
  /** Files above this size use a multipart upload (100 MiB). */
  multipartThresholdBytes: 100 * MIB,
  /** Size of each part of a multipart upload (16 MiB). */
  partBytes: 16 * MIB,
  /** Upload links last 15 minutes (ADR-004). */
  uploadLinkSeconds: 15 * 60,
  /** Files per `POST /uploads` request, and links per wave (ADR-004). */
  uploadWave: 20,
  /** Ids per `GET /files?ids=`. */
  maxFileIdsPerQuery: 100,
  /** A file older than this cannot join a job, and the daily cleanup deletes it (24 hours). */
  maxFileAgeMs: 24 * 60 * 60 * 1000,
  /** Uploads that run at the same time in the browser. */
  parallelUploads: 4,
} as const;

/** Number of parts a multipart upload of this size has. */
export function partCount(sizeBytes: number): number {
  return Math.max(1, Math.ceil(sizeBytes / LIMITS.partBytes));
}

export function isMultipart(sizeBytes: number): boolean {
  return sizeBytes > LIMITS.multipartThresholdBytes;
}
