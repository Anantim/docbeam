import { describe, expect, it } from 'vitest';
import { extractJobId, hashFor, parseHash } from './route.js';

const ID = '3f1c2a9e-84d5-4b6a-9c11-0a5f6d7e8b90';

describe('extractJobId', () => {
  it('finds a full id in a pasted id or link and lower-cases it', () => {
    expect(extractJobId(ID)).toBe(ID);
    expect(extractJobId(`https://d1.cloudfront.net/#/status/${ID.toUpperCase()}`)).toBe(ID);
    expect(extractJobId(`  ${ID}  `)).toBe(ID);
  });
  it('does not accept the short 8-character id', () => {
    expect(extractJobId(ID.slice(0, 8))).toBeNull();
    expect(extractJobId('')).toBeNull();
  });
});

describe('parseHash and hashFor', () => {
  const route = (view: 'distribute' | 'status', jobId: string | null) => ({ view, jobId });
  it.each([
    ['', route('distribute', null)],
    ['#/', route('distribute', null)],
    ['#/status', route('status', null)],
    [`#/status/${ID}`, route('status', ID)],
    ['#/status/nonsense', route('status', null)],
    ['#/status/uploads', route('status', null)], // the upload events panel is gone (D-F1-13)
    ['#/audit', route('distribute', null)], // so is the audit trail: an old link opens the first screen
    ['#/register', route('distribute', null)], // and the register page: nothing here, so the first screen (sign-in when signed out)
    ['#/other', route('distribute', null)],
  ])('%s', (hash, expected) => {
    expect(parseHash(hash)).toEqual(expected);
  });

  it('round-trips', () => {
    for (const r of [route('status', ID), route('status', null), route('distribute', null)]) {
      expect(parseHash(hashFor(r))).toEqual(r);
    }
  });
});
