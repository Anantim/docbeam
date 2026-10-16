import type { FailureCode } from '@docbeam/shared';

export type PlatformOutcome =
  | { kind: 'completed'; documentId: string }
  | { kind: 'permanent'; code: FailureCode; detail: string }
  | { kind: 'temporary'; detail: string };

/**
 * Sorts the platform's answer to `POST /documents` (TDD Step 2.4). Permanent errors end the task. Anything
 * not listed, including a 403 or 422 with another code, is temporary and will be tried again.
 */
export function classifyPlatformAnswer(status: number, errorCode: string | undefined, documentId?: string): PlatformOutcome {
  if (status === 201 || status === 200) {
    if (documentId) return { kind: 'completed', documentId };
    return { kind: 'temporary', detail: `The platform answered ${status} without a document id.` };
  }
  if (status === 403 && errorCode === 'NOT_A_MEMBER') {
    return { kind: 'permanent', code: 'NOT_AUTHORIZED_AT_DELIVERY', detail: 'The sender is no longer a member of the destination team.' };
  }
  if (status === 404 && errorCode === 'DESTINATION_NOT_FOUND') {
    return { kind: 'permanent', code: 'DESTINATION_NOT_FOUND', detail: 'The destination no longer exists.' };
  }
  if (status === 422 && errorCode === 'CHECKSUM_MISMATCH') {
    return { kind: 'permanent', code: 'CHECKSUM_MISMATCH', detail: 'The platform received bytes that do not match the declared SHA-256.' };
  }
  if (status === 422 && errorCode === 'UNSUPPORTED_TYPE') {
    return { kind: 'permanent', code: 'UNSUPPORTED_TYPE', detail: 'The file does not match its declared type.' };
  }
  return { kind: 'temporary', detail: `The platform answered ${status}${errorCode ? ` ${errorCode}` : ''}.` };
}

/** Seconds to wait before the next attempt, from the message's receive count (TDD Step 2.4). 0 sends it on to the DLQ. */
export function retryGapSeconds(receiveCount: number): number {
  const gaps = [30, 120, 300, 600];
  if (receiveCount >= 5) return 0;
  return gaps[Math.max(receiveCount, 1) - 1] as number;
}
