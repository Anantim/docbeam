import { describe, expect, it } from 'vitest';
import { classifyPlatformAnswer, retryGapSeconds } from './classify.js';

describe('classifyPlatformAnswer', () => {
  it('completes on 201 and on 200 (a repeat)', () => {
    expect(classifyPlatformAnswer(201, undefined, 'd1')).toEqual({ kind: 'completed', documentId: 'd1' });
    expect(classifyPlatformAnswer(200, undefined, 'd1')).toEqual({ kind: 'completed', documentId: 'd1' });
  });

  it.each([
    [403, 'NOT_A_MEMBER', 'NOT_AUTHORIZED_AT_DELIVERY'],
    [404, 'DESTINATION_NOT_FOUND', 'DESTINATION_NOT_FOUND'],
    [422, 'CHECKSUM_MISMATCH', 'CHECKSUM_MISMATCH'],
    [422, 'UNSUPPORTED_TYPE', 'UNSUPPORTED_TYPE'],
  ])('%i %s is permanent: %s', (status, code, failure) => {
    expect(classifyPlatformAnswer(status, code)).toMatchObject({ kind: 'permanent', code: failure });
  });

  it.each([
    [500, undefined],
    [502, undefined],
    [503, undefined],
    [429, undefined],
    [400, 'VALIDATION_ERROR'],
    [401, undefined],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [422, 'SOMETHING_ELSE'],
  ])('%i %s is temporary', (status, code) => {
    expect(classifyPlatformAnswer(status, code).kind).toBe('temporary');
  });

  it('treats a success without a document id as temporary', () => {
    expect(classifyPlatformAnswer(201, undefined).kind).toBe('temporary');
  });
});

describe('retryGapSeconds', () => {
  it('waits 30 s, 2, 5 and 10 minutes, then sends it on at once', () => {
    expect([1, 2, 3, 4, 5, 6].map(retryGapSeconds)).toEqual([30, 120, 300, 600, 0, 0]);
  });
});
