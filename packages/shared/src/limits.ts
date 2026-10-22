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
  /** The longest file name the API takes (characters). */
  maxFileNameChars: 255,
  /** Hard size limit of one file (1 GiB). */
  maxFileBytes: GIB,
  /** Files above this size use a multipart upload (100 MiB). */
  multipartThresholdBytes: 100 * MIB,
  /** Size of each part of a multipart upload (16 MiB). */
  partBytes: 16 * MIB,
  /** Upload links last 15 minutes (ADR-004). */
  uploadLinkSeconds: 15 * 60,
  /** Download and preview links last 2 minutes (ADR-004). */
  downloadLinkSeconds: 2 * 60,
  /** Files per `POST /uploads` request, and links per wave (ADR-004). */
  uploadWave: 20,
  /** Ids per `GET /files?ids=`. */
  maxFileIdsPerQuery: 100,
  /** A file older than this cannot join a job, and the daily cleanup deletes it (24 hours). */
  maxFileAgeMs: 24 * 60 * 60 * 1000,
  /** Uploads that run at the same time in the browser. */
  parallelUploads: 4,
  /** Jobs per page of `GET /jobs`: the default and the most a caller may ask for. */
  jobsPageDefault: 20,
  jobsPageMax: 100,
  /** Tasks per page of `GET /jobs/:jobId/tasks`. */
  tasksPage: 100,
  /** Audit events per page of `GET /audit`: the default and the most a caller may ask for. */
  auditPageDefault: 50,
  auditPageMax: 200,
  /** The Object Store keeps a staged file for 33 days from upload (TDD "Retention"). */
  stagedFileDays: 33,
  /** Retry is allowed within 24 hours of the first finish, while all files are under 2 days old. */
  retryWindowMs: 24 * 60 * 60 * 1000,
  retryMaxFileAgeMs: 2 * 24 * 60 * 60 * 1000,
} as const;

/** Number of parts a multipart upload of this size has. */
export function partCount(sizeBytes: number): number {
  return Math.max(1, Math.ceil(sizeBytes / LIMITS.partBytes));
}

export function isMultipart(sizeBytes: number): boolean {
  return sizeBytes > LIMITS.multipartThresholdBytes;
}
