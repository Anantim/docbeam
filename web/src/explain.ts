// One plain-English line for each status chip and failure code, shown as the chip's title (D-M3-10).
// The words live here, in one place, so a screen never invents its own wording. Short, one line each.
import type { FAILURE_CODES, JOB_STATUSES, TASK_STATUSES } from '@docbeam/shared/browser';
import type { FileStatus } from './upload/manager.js';

// The one reason map (D-F1-60): a plain sentence for every failure code and for every problem a file can have on Distribute. Both
// screens read it, nothing shows a raw code, and none of the sentences repeats the file name or the folder (the row has them).
export const FAILURE_MEANING: Record<(typeof FAILURE_CODES)[number], string> = {
  FILE_NOT_UPLOADED: 'The file never finished uploading, so it could not be delivered.',
  CHECKSUM_MISMATCH: 'The file in storage does not match what was uploaded.',
  UNSUPPORTED_TYPE: "The file's contents are not the type its name says.",
  NOT_AUTHORIZED_AT_DELIVERY: 'The sender is no longer in this team.',
  DESTINATION_NOT_FOUND: 'The folder no longer exists.',
  RETRIES_EXHAUSTED: 'The platform did not respond after 5 attempts.',
  FANOUT_FAILED: 'The distribution could not be split into deliveries.',
  CANCELLED: 'Cancelled by the sender before it was delivered.',
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
  refused: 'Storage did not accept the upload.',
  interrupted: 'The connection broke. Retry carries on where it stopped.',
  unchecked: 'The scan could not run.',
  infected: 'Malware was found. The file was deleted and cannot be sent.',
};

/**
 * The reason for a delivery that did not arrive, from the one reason map (D-F1-60): the sentence for its code, and a plain
 * sentence for a code a newer server may send. Never the raw code, the platform's own text, the file name or the folder.
 */
export function failureMeaning(code: string | null): string {
  return (code ? (FAILURE_MEANING as Record<string, string | undefined>)[code] : undefined) ?? 'The delivery did not go through.';
}
