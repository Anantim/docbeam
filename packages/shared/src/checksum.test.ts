import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { base64ToHex, hexToBase64, isMultipartChecksum, isSha256Hex } from './checksum.js';

describe('checksum encodings', () => {
  const digest = createHash('sha256').update('hello').digest();

  it('converts hex to the base64 that S3 uses, and back', () => {
    expect(hexToBase64(digest.toString('hex'))).toBe(digest.toString('base64'));
    expect(base64ToHex(digest.toString('base64'))).toBe(digest.toString('hex'));
  });

  it('accepts only 64 lower-case hex characters', () => {
    expect(isSha256Hex(digest.toString('hex'))).toBe(true);
    expect(isSha256Hex(digest.toString('hex').toUpperCase())).toBe(false);
    expect(isSha256Hex('abc')).toBe(false);
    expect(() => hexToBase64('abc')).toThrow();
  });

  it('recognises the combined checksum of a multipart upload', () => {
    expect(isMultipartChecksum(`${digest.toString('base64')}-64`)).toBe(true);
    expect(isMultipartChecksum(digest.toString('base64'))).toBe(false);
  });
});
