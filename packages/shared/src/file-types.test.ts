import { describe, expect, it } from 'vitest';
import { ALLOWED_FILE_TYPES, contentTypeForFileName, isAllowedType, matchesSignature } from './file-types.js';

const bytes = (...n: number[]) => Uint8Array.from(n);

describe('file types', () => {
  it('allows the five types and nothing else', () => {
    expect(isAllowedType('application/pdf')).toBe(true);
    expect(isAllowedType('image/png')).toBe(true);
    expect(isAllowedType('image/jpeg')).toBe(true);
    expect(isAllowedType('application/x-msdownload')).toBe(false);
    expect(isAllowedType('constructor')).toBe(false);
  });

  it('matches the first bytes against the declared type', () => {
    expect(matchesSignature('application/pdf', Buffer.from('%PDF-1.7\n'))).toBe(true);
    expect(matchesSignature('image/png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(true);
    expect(matchesSignature('image/jpeg', bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(matchesSignature('application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes(0x50, 0x4b, 0x03, 0x04))).toBe(true);
  });

  it('refuses a renamed program', () => {
    const exe = Buffer.from('MZ\x90\x00\x03\x00\x00\x00');
    expect(matchesSignature('application/pdf', exe)).toBe(false);
    expect(matchesSignature('image/png', exe)).toBe(false);
  });

  it('refuses too few bytes', () => {
    expect(matchesSignature('application/pdf', bytes(0x25, 0x50))).toBe(false);
  });

  it('lists exactly the allowed types for the picker', () => {
    expect(ALLOWED_FILE_TYPES.every((t) => isAllowedType(t.contentType))).toBe(true);
    expect(ALLOWED_FILE_TYPES).toHaveLength(5);
  });

  it('maps a file name to its content type by extension, case-insensitively', () => {
    expect(contentTypeForFileName('Protocol.PDF')).toBe('application/pdf');
    expect(contentTypeForFileName('scan.jpeg')).toBe('image/jpeg');
    expect(contentTypeForFileName('scan.jpg')).toBe('image/jpeg');
    expect(contentTypeForFileName('setup.exe')).toBeNull();
    expect(contentTypeForFileName('noextension')).toBeNull();
  });
});
