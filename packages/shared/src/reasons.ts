import type { FailureCode } from './constants.js';
import { LIMITS } from './limits.js';

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
  /** The same name, size and last-modified time as a file already in the list (D-F1-81). */
  ALREADY_IN_LIST: 'This file is already in the list.',
  NAME_TOO_LONG: `The name is longer than ${LIMITS.maxFileNameChars} characters.`,
  /** A file the page holds for more than 24 hours since its upload. */
  TOO_OLD: 'Uploaded more than 24 hours ago. Add it again.',
} as const;

/** A file whose contents match another file in the list, whatever its name: it is taken out before it is uploaded. */
export const sameContentsAs = (otherName: string): string => `Same contents as ${otherName}, already in the list.`;

/** The API's refusal of a batch with two files of the same SHA-256 (POST /jobs, 422 INVALID_BATCH). */
export const BATCH_REASON = {
  SAME_CONTENTS: 'Two files in this distribution have the same contents.',
  TOO_MANY_FOLDERS: `A distribution can have at most ${LIMITS.maxDestinationsPerJob} folders.`,
} as const;

/** The per-file refusals of POST /jobs, each naming the file (D-F1-81). */
export const fileProblem = {
  tooOld: (name: string): string => `${name} was uploaded more than 24 hours ago. Add it again.`,
  notReady: (name: string): string => `${name} has not finished uploading and being checked.`,
  alreadySubmitted: (name: string): string => `${name} is already part of another distribution.`,
  checksum: (name: string): string => `${name} does not match the fingerprint it was uploaded with.`,
};
