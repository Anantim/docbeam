// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function token(exp: number, email = 'priya.shah@example.com'): string {
  const enc = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${enc({ alg: 'RS256' })}.${enc({ sub: 'u1', email, name: 'Priya Shah', exp })}.sig`;
}
const inSeconds = (s: number) => Math.floor(Date.now() / 1000) + s;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function fresh() {
  vi.resetModules();
  return import('./session.js');
}

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('session', () => {
  it('signs in, keeps the token in sessionStorage and not the refresh token', async () => {
    const access = token(inSeconds(900));
    vi.stubGlobal('fetch', vi.fn(async () => json({ accessToken: access, expiresIn: 900 })));
    const s = await fresh();
    await s.login('priya.shah@example.com', 'a long enough password');
    expect(s.sessionStore.getSnapshot()).toMatchObject({ status: 'signedIn', token: access });
    expect(sessionStorage.getItem('docbeam.accessToken')).toBe(access);
  });

  it('on a 401 refreshes once and retries once', async () => {
    const calls: string[] = [];
    const next = token(inSeconds(901));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        if (url.endsWith('/auth/login')) return json({ accessToken: token(inSeconds(900)) });
        if (url.endsWith('/auth/refresh')) return json({ accessToken: next });
        const bearer = (init?.headers as Record<string, string>).authorization;
        return bearer === `Bearer ${next}` ? json([{ id: 't1', name: 'Cardio' }]) : json({ error: { code: 'UNAUTHORIZED', message: 'Sign in again.' } }, 401);
      }),
    );
    const s = await fresh();
    await s.login('priya.shah@example.com', 'a long enough password');
    const teams = await s.apiFetch<{ name: string }[]>('/teams');
    expect(teams[0]?.name).toBe('Cardio');
    expect(calls.filter((c) => c.includes('/auth/refresh'))).toHaveLength(1);
    expect(calls.filter((c) => c.endsWith('/teams'))).toHaveLength(2);
  });

  it('opens the sign-in dialog state when the refresh is refused, and keeps the email', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/auth/login')) return json({ accessToken: token(inSeconds(900)) });
        return json({ error: { code: 'UNAUTHORIZED', message: 'Sign in again.' } }, 401);
      }),
    );
    const s = await fresh();
    await s.login('priya.shah@example.com', 'a long enough password');
    await expect(s.apiFetch('/teams')).rejects.toMatchObject({ status: 401 });
    expect(s.sessionStore.getSnapshot()).toEqual({ status: 'ended', email: 'priya.shah@example.com' });
  });

  it('a new tab with no token tries one quiet refresh before showing sign-in', async () => {
    const fetchMock = vi.fn(async () => json({ accessToken: token(inSeconds(900)) }));
    vi.stubGlobal('fetch', fetchMock);
    const s = await fresh();
    await s.startSession();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(s.sessionStore.getSnapshot().status).toBe('signedIn');
  });

  it('shows sign-in when that quiet refresh is refused', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 401)));
    const s = await fresh();
    await s.startSession();
    expect(s.sessionStore.getSnapshot().status).toBe('signedOut');
  });
});
