// Values shared by every service and worker. The meaning of each is in
// docs/design/05-technical-design.md (Database design and API contracts).

export const JWT_AUDIENCE = 'docbeam';

export const TASK_STATUSES = ['pending', 'in_progress', 'completed', 'failed'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const JOB_STATUSES = ['pending', 'in_progress', 'completed', 'completed_with_errors', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const SCAN_STATUSES = ['pending', 'clean', 'infected', 'failed'] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export const FAILURE_CODES = [
  'FILE_NOT_UPLOADED',
  'CHECKSUM_MISMATCH',
  'UNSUPPORTED_TYPE',
  'NOT_AUTHORIZED_AT_DELIVERY',
  'DESTINATION_NOT_FOUND',
  'RETRIES_EXHAUSTED',
  'FANOUT_FAILED',
  'CANCELLED',
] as const;
export type FailureCode = (typeof FAILURE_CODES)[number];

export const AUDIT_ACTIONS = [
  'job.submitted',
  'task.completed',
  'task.failed',
  'job.retried',
  'job.cancelled',
  'download.issued',
  'file.refused',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const SCOPES = ['documents:ingest', 'memberships:read', 'users:read'] as const;
export type Scope = (typeof SCOPES)[number];

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'INTERNAL_ERROR',
  'REGISTRATION_FAILED',
  'IDEMPOTENCY_KEY_REQUIRED',
  'INVALID_BATCH',
  'FILE_TOO_OLD',
  'FILE_NOT_READY',
  'FILE_ALREADY_SUBMITTED',
  'FILE_EXPIRED',
  'DESTINATION_NOT_FOUND',
  'CHECKSUM_MISMATCH',
  'UNSUPPORTED_TYPE',
  'MULTIPART_INCOMPLETE',
  'NOT_A_MEMBER',
  'NOT_SENDER',
  'RETRY_WINDOW_CLOSED',
  'NOTHING_TO_RETRY',
  'NOTHING_TO_CANCEL',
  'JOB_CANCELLED',
  'PLATFORM_UNAVAILABLE',
  'PLATFORM_BUSY',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
