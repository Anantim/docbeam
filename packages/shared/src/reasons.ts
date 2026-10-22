import type { FailureCode } from './constants.js';

/**
 * The one sentence for each way a delivery can fail (D-F1-78). The workers and the API store it as the reason of the task, and
 * the web app shows the same sentence, so the stored reason and the screen never word one outcome two ways. Plain words, no
 * file name and no folder (the row has them), and no raw code.
 */
export const FAILURE_REASON: Record<FailureCode, string> = {
  FILE_NOT_UPLOADED: "The file never finished uploading, so it couldn't be delivered.",
  CHECKSUM_MISMATCH: "The file in storage doesn't match what was uploaded.",
  UNSUPPORTED_TYPE: "The file's contents aren't the type its name says.",
  NOT_AUTHORIZED_AT_DELIVERY: 'The sender is no longer in this team.',
  DESTINATION_NOT_FOUND: 'The folder no longer exists.',
  RETRIES_EXHAUSTED: "The platform didn't respond after 5 attempts.",
  FANOUT_FAILED: "The distribution couldn't be split into deliveries.",
  CANCELLED: 'Cancelled by the sender before it was delivered.',
};

/**
 * The same for a file that does not get through the upload checks (D-F1-78): the upload-events worker and the DLQ store these as
 * the reason of the `file.refused` audit record, and the web app says the same sentence on Distribute.
 */
export const FILE_REASON = {
  MALWARE: 'Malware was found. The file was deleted.',
  SCAN_FAILED: "The scan couldn't run.",
  MISMATCH: FAILURE_REASON.CHECKSUM_MISMATCH,
} as const;
