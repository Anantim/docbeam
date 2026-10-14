import { describe, expect, it } from 'vitest';
import { decodeClaims, initials, isUsable, msUntilRefresh } from './token.js';

function token(payload: object): string {
  const enc = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${enc({ alg: 'RS256' })}.${enc(payload)}.sig`;
}

describe('token helpers', () => {
  it('reads the claims the page shows', () => {
    const c = decodeClaims(token({ sub: 'u1', email: 'priya.shah@example.com', name: 'Priya Shah', exp: 2000 }));
    expect(c).toEqual({ sub: 'u1', email: 'priya.shah@example.com', name: 'Priya Shah', exp: 2000 });
  });

  it('returns null for something that is not a token', () => {
    expect(decodeClaims('nope')).toBeNull();
    expect(decodeClaims(token({ sub: 'u1' }))).toBeNull();
  });

  it('refreshes a minute before expiry, and at once when that time has passed', () => {
    expect(msUntilRefresh(1000, 900_000)).toBe(40_000);
    expect(msUntilRefresh(1000, 990_000)).toBe(0);
  });

  it('treats a token about to expire as unusable', () => {
    expect(isUsable(token({ sub: 'u', exp: 1000 }), 990_000)).toBe(true);
    expect(isUsable(token({ sub: 'u', exp: 1000 }), 996_000)).toBe(false);
  });

  it('makes initials', () => {
    expect(initials('Priya Shah')).toBe('PS');
    expect(initials('Sam')).toBe('S');
    expect(initials('')).toBe('?');
  });
});
