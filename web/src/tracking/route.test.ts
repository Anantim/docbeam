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
  it.each([
    ['', { view: 'distribute', jobId: null }],
    ['#/', { view: 'distribute', jobId: null }],
    ['#/status', { view: 'status', jobId: null }],
    [`#/status/${ID}`, { view: 'status', jobId: ID }],
    ['#/status/nonsense', { view: 'status', jobId: null }],
    ['#/audit', { view: 'audit', jobId: null }],
    ['#/other', { view: 'distribute', jobId: null }],
  ])('%s', (hash, route) => {
    expect(parseHash(hash)).toEqual(route);
  });

  it('round-trips', () => {
    for (const r of [{ view: 'status', jobId: ID }, { view: 'audit', jobId: null }, { view: 'distribute', jobId: null }] as const) {
      expect(parseHash(hashFor(r))).toEqual(r);
    }
  });
});
