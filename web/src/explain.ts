// One plain-English line for each status chip and failure code, shown as the chip's title (D-M3-10).
// The words live here, in one place, so a screen never invents its own wording. Short, one line each.
import type { FAILURE_CODES, JOB_STATUSES, TASK_STATUSES } from '@docbeam/shared/browser';
import type { FileStatus } from './upload/manager.js';

export const FAILURE_MEANING: Record<(typeof FAILURE_CODES)[number], string> = {
  FILE_NOT_UPLOADED: 'The file was not in storage when the delivery started.',
  CHECKSUM_MISMATCH: "The file's fingerprint did not match the one it was uploaded with.",
  UNSUPPORTED_TYPE: "The file's contents do not match its declared type.",
  NOT_AUTHORIZED_AT_DELIVERY: 'The sender left the destination team after sending, so the platform refused it.',
  DESTINATION_NOT_FOUND: 'The folder was deleted after the distribution was sent.',
  RETRIES_EXHAUSTED: 'Tried 5 times over about 17 minutes; the platform did not accept it.',
  FANOUT_FAILED: 'The distribution could not be split into deliveries. The sender can retry.',
  CANCELLED: 'The sender cancelled the distribution before this delivery started.',
};

export const TASK_STATUS_MEANING: Record<(typeof TASK_STATUSES)[number] | 'cancelled', string> = {
  pending: 'Queued. It has not started yet.',
  in_progress: 'A worker is delivering this file now.',
  completed: 'Delivered to the folder in the platform.',
  failed: 'This delivery ended with a failure. The reason is shown.',
  cancelled: 'The sender cancelled the distribution before this delivery started. Nothing was delivered.',
};

export const JOB_STATUS_MEANING: Record<(typeof JOB_STATUSES)[number], string> = {
  pending: 'No delivery has started yet.',
  in_progress: 'Some deliveries are still waiting or running.',
  completed: 'Every delivery arrived.',
  completed_with_errors: 'All deliveries have finished and at least one failed.',
  cancelled: 'The sender cancelled it and nothing is still running.',
};

export const UPLOAD_STATUS_MEANING: Record<FileStatus, string> = {
  hashing: "Working out the file's fingerprint in your browser.",
  waiting: 'Waiting for a free upload slot.',
  uploading: 'Sending the file to storage.',
  checking: 'Stored. The malware scan is running.',
  verified: 'Stored, intact and scanned clean.',
  refused: 'Storage did not accept the upload because it did not match what was checked. Retry it.',
  interrupted: 'The connection broke. Retry carries on from the parts already stored.',
  unchecked: 'The file could not be scanned, so it cannot be sent.',
  infected: 'Malware was found. The file was deleted and can never be sent.',
};

/**
 * The one short line under a Failed, Interrupted or Refused chip on Distribute (D-F1-58): what is wrong and what to do, short
 * enough for one line. The full sentence is `UPLOAD_STATUS_MEANING`, shown in the tooltip.
 */
export const UPLOAD_STATUS_SHORT: Partial<Record<FileStatus, string>> = {
  refused: 'Upload failed. Retry or remove.',
  interrupted: 'Connection broke. Retry to resume.',
  unchecked: 'Scan failed. Retry or remove.',
  infected: 'Malware found. Remove this file.',
};

/** The meaning of a failure code the page may not know (a newer server), or nothing. */
export function failureMeaning(code: string | null): string | undefined {
  return code ? (FAILURE_MEANING as Record<string, string>)[code] : undefined;
}
