import { describe, expect, it } from 'vitest';
import { filtersFromParams, filtersToQuery, isUnfiltered, jobsQuery, sameFilters, sentSince } from './filters.js';

const USER = '3f1c2a9e-84d5-4b6a-9c11-0a5f6d7e8b90';
const TEAM = 'efa09ad5-68e8-5761-bc3c-3acbcf971c75';

describe('filters (D-F1-21)', () => {
  it('knows when nothing is set, and when two sets are the same', () => {
    expect(isUnfiltered({})).toBe(true);
    expect(isUnfiltered({ status: undefined })).toBe(true);
    expect(isUnfiltered({ sender: 'me' })).toBe(false);
    expect(sameFilters({ sender: 'me' }, { sender: 'me', status: undefined })).toBe(true);
    expect(sameFilters({ sender: 'me' }, { sender: USER })).toBe(false);
  });

  it('reads only the four filters and only their values', () => {
    expect(filtersFromParams(new URLSearchParams(`status=pending&sender=${USER.toUpperCase()}&sent=today&team=${TEAM}&x=1`))).toEqual({ status: 'pending', sender: USER, sent: 'today', team: TEAM });
    expect(filtersFromParams(new URLSearchParams('status=done&sender=bob&sent=week&team=cardio'))).toEqual({});
  });

  it('writes them in a fixed order and leaves out what is not set', () => {
    expect(filtersToQuery({})).toBe('');
    expect(filtersToQuery({ team: TEAM, sent: '7d', status: 'cancelled' })).toBe(`status=cancelled&sent=7d&team=${TEAM}`);
  });

  it('turns Today, 7 days and 30 days into a date', () => {
    const now = new Date(2026, 9, 20, 15, 30); // 20 Oct 2026, 15:30 on the person's clock
    expect(new Date(sentSince('today', now))).toEqual(new Date(2026, 9, 20, 0, 0, 0, 0));
    expect(new Date(sentSince('7d', now)).getTime()).toBe(now.getTime() - 7 * 24 * 3_600_000);
    expect(new Date(sentSince('30d', now)).getTime()).toBe(now.getTime() - 30 * 24 * 3_600_000);
  });

  it('builds the GET /jobs query: always everything I can see, and only the filters that are set', () => {
    const now = new Date(2026, 9, 20, 15, 30);
    expect(jobsQuery({}, now)).toBe('scope=all');
    const q = new URLSearchParams(jobsQuery({ status: 'completed', sender: 'me', sent: 'today', team: TEAM }, now));
    expect(Object.fromEntries(q)).toEqual({ scope: 'all', status: 'completed', sender: 'me', sentSince: new Date(2026, 9, 20).toISOString(), team: TEAM });
  });
});
