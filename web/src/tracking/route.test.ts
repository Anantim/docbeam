import { describe, expect, it } from 'vitest';
import { extractJobId, hashFor, parseHash, type Route } from './route.js';

const ID = '3f1c2a9e-84d5-4b6a-9c11-0a5f6d7e8b90';
const TEAM = 'efa09ad5-68e8-5761-bc3c-3acbcf971c75';

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
  const route = (view: Route['view'], jobId: string | null, filters: Route['filters'] = {}): Route => ({ view, jobId, filters });
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

  it('keeps the filters of the list in the hash (D-F1-21)', () => {
    expect(parseHash('#/status?status=completed&sender=me&sent=7d')).toEqual(route('status', null, { status: 'completed', sender: 'me', sent: '7d' }));
    expect(parseHash(`#/status/${ID}?team=${TEAM}&sender=${ID}`)).toEqual(route('status', ID, { team: TEAM, sender: ID }));
  });

  it('opens the unfiltered list for an old scope address or a filter that is not one of the choices', () => {
    expect(parseHash('#/status?scope=team')).toEqual(route('status', null));
    expect(parseHash('#/status?scope=mine&status=sleeping&sent=yesterday&sender=bob&team=x')).toEqual(route('status', null));
  });

  it('does not take a team or sender id in the query for the open distribution', () => {
    expect(parseHash(`#/status?team=${TEAM}`).jobId).toBeNull();
    expect(parseHash(`#/status?sender=${ID}`).jobId).toBeNull();
  });

  it('round-trips, with the filters in one fixed order', () => {
    for (const r of [
      route('status', ID),
      route('status', null),
      route('distribute', null),
      route('status', ID, { status: 'pending', sender: 'me', sent: 'today', team: TEAM }),
      route('status', null, { sent: '30d' }),
    ]) {
      expect(parseHash(hashFor(r))).toEqual(r);
    }
    expect(hashFor(route('status', null, { team: TEAM, status: 'cancelled' }))).toBe(`#/status?status=cancelled&team=${TEAM}`);
    expect(hashFor(route('status', null))).toBe('#/status'); // no "?" without filters
  });
});
