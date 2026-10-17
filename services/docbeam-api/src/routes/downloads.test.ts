import { describe, expect, it } from 'vitest';
import { decideDownload, parseMode, type DownloadFile } from './downloads.js';

const now = new Date('2026-10-17T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const file = (over: Partial<DownloadFile> = {}): DownloadFile => ({
  scanStatus: 'clean',
  uploadedAt: new Date(now.getTime() - DAY),
  ...over,
});
const base = { file: file(), isSender: false, deliveredTeams: ['t-cardio'], callerTeams: ['t-cardio'], now };

describe('decideDownload', () => {
  it('lets the sender in with no team', () => {
    expect(decideDownload({ ...base, isSender: true, deliveredTeams: [], callerTeams: [] })).toEqual([]);
  });

  it('lets a member of a team the file was delivered to in, and names the matching teams in order', () => {
    expect(decideDownload({ ...base, deliveredTeams: ['t-b', 't-a', 't-x'], callerTeams: ['t-a', 't-b'] })).toEqual(['t-a', 't-b']);
  });

  it('gives an outsider 404, also when they have teams', () => {
    expect(() => decideDownload({ ...base, callerTeams: ['t-neuro'] })).toThrowError(expect.objectContaining({ statusCode: 404 }));
    expect(() => decideDownload({ ...base, callerTeams: [] })).toThrowError(expect.objectContaining({ statusCode: 404 }));
  });

  it('gives a team member 404 when the file was not delivered to their team yet (pending or failed)', () => {
    expect(() => decideDownload({ ...base, deliveredTeams: [] })).toThrowError(expect.objectContaining({ statusCode: 404 }));
  });

  it.each([
    ['still pending', { scanStatus: 'pending' }],
    ['infected', { scanStatus: 'infected' }],
    ['not confirmed', { uploadedAt: null }],
  ])('gives 404 for a file that is %s, even to the sender', (_label, over) => {
    expect(() => decideDownload({ ...base, isSender: true, file: file(over) })).toThrowError(expect.objectContaining({ statusCode: 404 }));
  });

  it('gives 410 FILE_EXPIRED after 33 days to an allowed caller, and not before', () => {
    const old = file({ uploadedAt: new Date(now.getTime() - 33 * DAY - 1000) });
    expect(() => decideDownload({ ...base, isSender: true, file: old })).toThrowError(
      expect.objectContaining({ statusCode: 410, code: 'FILE_EXPIRED' }),
    );
    expect(() => decideDownload({ ...base, file: old })).toThrowError(expect.objectContaining({ statusCode: 410 }));
    const edge = file({ uploadedAt: new Date(now.getTime() - 33 * DAY + 1000) });
    expect(decideDownload({ ...base, isSender: true, file: edge })).toEqual([]);
  });

  it('gives an outsider 404, never 410, for an expired file', () => {
    const old = file({ uploadedAt: new Date(now.getTime() - 40 * DAY) });
    expect(() => decideDownload({ ...base, file: old, callerTeams: ['t-neuro'] })).toThrowError(expect.objectContaining({ statusCode: 404 }));
  });
});

describe('parseMode', () => {
  it('defaults to download', () => {
    expect(parseMode(undefined)).toBe('download');
    expect(parseMode({})).toBe('download');
    expect(parseMode(null)).toBe('download');
  });

  it('takes download and preview and refuses anything else', () => {
    expect(parseMode({ mode: 'preview' })).toBe('preview');
    expect(parseMode({ mode: 'download' })).toBe('download');
    expect(() => parseMode({ mode: 'stream' })).toThrowError(expect.objectContaining({ statusCode: 400, code: 'VALIDATION_ERROR' }));
  });
});
