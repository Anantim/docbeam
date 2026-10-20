// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A sign-in lasts 12 hours and the 15-minute access token is swapped quietly a minute before it ends (ADR-015). These
// tests run the web client against a small fake of the Auth Service (rotating refresh token, reuse ends the sign-in)
// and move the clock, so "no dialog after 15 minutes" is a test and not a hope (F1 follow-up, D-F1-14).

const enc = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The Auth Service as far as the page can tell: access tokens of 900 s, a refresh token that works once, 12 hours. */
function fakeAuth() {
  let cookie = '';
  let family = 0;
  let serial = 0;
  const used = new Set<string>();
  const revoked = new Set<number>();
  let endsAt = 0;
  const log: string[] = [];
  const access = (): string => `${enc({ alg: 'RS256' })}.${enc({ sub: 'u1', email: 'priya.shah@example.com', name: 'Priya Shah', exp: Math.floor(Date.now() / 1000) + 900 })}.s${(serial += 1)}`;
  const claims = (token: string): { exp: number } => JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/auth/login')) {
      family += 1;
      cookie = `r${family}-0`;
      endsAt = Date.now() + 12 * 3_600_000;
      log.push('login');
      return json({ accessToken: access() });
    }
    if (url.endsWith('/auth/refresh')) {
      log.push('refresh');
      // The browser sends the cookie it has when the request leaves; the server answers a moment later.
      const sent = cookie;
      await Promise.resolve();
      await Promise.resolve();
      const [fam] = sent.slice(1).split('-').map(Number);
      if (!sent || revoked.has(fam as number)) return json({ error: { message: 'Sign in again.' } }, 401);
      if (used.has(sent)) {
        revoked.add(fam as number);
        return json({ error: { message: 'Sign in again.' } }, 401);
      }
      if (Date.now() >= endsAt) return json({ error: { message: 'Sign in again.' } }, 401);
      used.add(sent);
      cookie = `r${fam}-${used.size}`;
      return json({ accessToken: access() });
    }
    // Any other route: the gateway checks the access token.
    const bearer = ((init?.headers ?? {}) as Record<string, string>)['authorization'] ?? '';
    const token = bearer.replace('Bearer ', '');
    if (!token || claims(token).exp * 1000 <= Date.now()) return json({ error: { message: 'Sign in again.' } }, 401);
    return json({ ok: true });
  });
  return { fetchMock, log };
}

async function fresh() {
  vi.resetModules();
  return import('./session.js');
}

/** Web Locks as a browser has them: one holder at a time, the others wait their turn. */
function stubLocks(): void {
  let tail: Promise<unknown> = Promise.resolve();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (_name: string, run: () => Promise<unknown>) => {
        const next = tail.then(run, run);
        tail = next.catch(() => undefined);
        return next;
      },
    },
  });
}

beforeEach(() => {
  sessionStorage.clear();
  stubLocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-20T08:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a sign-in survives the 15-minute access token', () => {
  it('swaps the token quietly and stays signed in for 12 hours, with no dialog', async () => {
    const auth = fakeAuth();
    vi.stubGlobal('fetch', auth.fetchMock);
    const s = await fresh();
    await s.login('priya.shah@example.com', 'a long enough password');
    for (let minute = 1; minute <= 12 * 60 - 2; minute += 1) {
      await vi.advanceTimersByTimeAsync(60_000);
      expect(s.sessionStore.getSnapshot().status, `minute ${minute}`).toBe('signedIn');
    }
    // About 52 swaps in 12 hours, one every 14 minutes, and a call still works at the end.
    expect(auth.log.filter((l) => l === 'refresh').length).toBeGreaterThan(48);
    await expect(s.apiFetch('/jobs')).resolves.toEqual({ ok: true });
  });

  it('a call made after the token ran out refreshes once and works, with no dialog', async () => {
    const auth = fakeAuth();
    vi.stubGlobal('fetch', auth.fetchMock);
    const s = await fresh();
    await s.login('priya.shah@example.com', 'a long enough password');
    // The laptop slept: no timer ran for an hour.
    vi.setSystemTime(Date.now() + 3_600_000);
    await expect(s.apiFetch('/jobs')).resolves.toEqual({ ok: true });
    expect(s.sessionStore.getSnapshot().status).toBe('signedIn');
  });

  it('many calls at the moment of expiry cause one swap, not a reuse that ends the sign-in', async () => {
    const auth = fakeAuth();
    vi.stubGlobal('fetch', auth.fetchMock);
    const s = await fresh();
    await s.login('priya.shah@example.com', 'a long enough password');
    vi.setSystemTime(Date.now() + 16 * 60_000);
    const results = await Promise.all(Array.from({ length: 8 }, () => s.apiFetch('/jobs')));
    expect(results).toHaveLength(8);
    expect(s.sessionStore.getSnapshot().status).toBe('signedIn');
    expect(auth.log.filter((l) => l === 'refresh')).toHaveLength(1);
  });

  it('a swap whose answer never arrived is tried again and does not end the sign-in', async () => {
    const auth = fakeAuth();
    let dropped = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const out = await auth.fetchMock(url, init);
        if (url.endsWith('/auth/refresh') && !dropped) {
          dropped = true; // the server did swap, the page never heard (a dropped connection)
          throw new TypeError('network error');
        }
        return out;
      }),
    );
    const s = await fresh();
    await s.login('priya.shah@example.com', 'a long enough password');
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(s.sessionStore.getSnapshot().status).toBe('signedIn');
  });
});
