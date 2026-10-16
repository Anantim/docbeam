import { ApiFailure } from './errors.js';
import { decodeClaims, isUsable, msUntilRefresh, type Claims } from './token.js';

// The access token lives in sessionStorage, so reloading keeps the session; the refresh token lives only in
// its HttpOnly cookie (ADR-015). One tab at a time swaps the refresh token (Web Locks) and tells the others.

export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '/api';
const STORAGE_KEY = 'docbeam.accessToken';
const CHANNEL_NAME = 'docbeam-auth';
const LOCK_NAME = 'docbeam-refresh';
const RETRY_MS = 15_000;

export type SessionState =
  | { status: 'booting' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; token: string; claims: Claims }
  /** The 12 hours are up or the sign-in was cancelled. The page stays as it is (flow 1, step 4). */
  | { status: 'ended'; email: string };

export class AuthError extends Error {}

let state: SessionState = { status: 'booting' };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let channel: BroadcastChannel | undefined;

function set(next: SessionState): void {
  state = next;
  for (const l of listeners) l();
}

export const sessionStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: (): SessionState => state,
};

function store(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(STORAGE_KEY, token);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be blocked. The session then lives in memory only.
  }
}

function stored(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function apply(token: string, share: boolean): void {
  const claims = decodeClaims(token);
  if (!claims) throw new AuthError('The server sent a token that cannot be read.');
  store(token);
  set({ status: 'signedIn', token, claims });
  schedule(claims.exp);
  if (share) channel?.postMessage({ type: 'token', token });
}

function schedule(expSeconds: number): void {
  clearTimeout(timer);
  timer = setTimeout(() => void refreshNow(), msUntilRefresh(expSeconds, Date.now()));
}

function clear(share: boolean): void {
  clearTimeout(timer);
  store(null);
  set({ status: 'signedOut' });
  if (share) channel?.postMessage({ type: 'logout' });
}

function end(): void {
  clearTimeout(timer);
  store(null);
  const email = state.status === 'signedIn' ? state.claims.email : state.status === 'ended' ? state.email : '';
  set({ status: 'ended', email });
}

type RefreshResult = 'ok' | 'rejected' | 'unreachable';

async function swap(): Promise<RefreshResult> {
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (res.status === 401) return 'rejected';
    if (!res.ok) return 'unreachable';
    const body = (await res.json()) as { accessToken: string };
    apply(body.accessToken, true);
    return 'ok';
  } catch {
    return 'unreachable';
  }
}

/** Swaps the refresh token for a new access token. Only one tab does it; the others reuse its result. */
export async function refreshNow(): Promise<RefreshResult> {
  const before = state.status === 'signedIn' ? state.claims.exp : 0;
  const run = async (): Promise<RefreshResult> => {
    // Another tab may have refreshed while this one waited for the lock.
    if (state.status === 'signedIn' && state.claims.exp > before) return 'ok';
    return swap();
  };
  const result = navigator.locks ? await navigator.locks.request(LOCK_NAME, run) : await run();
  if (result === 'rejected') {
    if (state.status === 'signedIn' || state.status === 'ended') end();
    else clear(false);
  } else if (result === 'unreachable' && state.status === 'signedIn') {
    // Network trouble: keep the session and try again before the token runs out.
    clearTimeout(timer);
    timer = setTimeout(() => void refreshNow(), RETRY_MS);
  }
  return result;
}

/** Call once at page load. A tab with no token tries one quiet refresh before showing sign-in (D-M1-8). */
export async function startSession(): Promise<void> {
  if (typeof BroadcastChannel !== 'undefined' && !channel) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event: MessageEvent<{ type: string; token?: string }>) => {
      if (event.data.type === 'token' && event.data.token && isUsable(event.data.token, Date.now())) {
        // A tab that is still starting up asks for its own token.
        if (state.status !== 'booting') apply(event.data.token, false);
      } else if (event.data.type === 'logout') clear(false);
    };
  }
  const existing = stored();
  if (existing && isUsable(existing, Date.now())) {
    apply(existing, false);
    return;
  }
  const result = await refreshNow();
  if (result !== 'ok') clear(false);
}

interface ErrorBody {
  error?: { code?: string; message?: string };
  [key: string]: unknown;
}

async function readBody(res: Response): Promise<ErrorBody> {
  try {
    return (await res.json()) as ErrorBody;
  } catch {
    return {};
  }
}

async function readError(res: Response, fallback: string): Promise<string> {
  return (await readBody(res)).error?.message ?? fallback;
}

/** Resolves when the session is signed in (at once if it already is). Uploads wait here behind the sign-in dialog. */
export function whenSignedIn(): Promise<void> {
  if (state.status === 'signedIn') return Promise.resolve();
  return new Promise((resolve) => {
    const stop = sessionStore.subscribe(() => {
      if (state.status === 'signedIn') {
        stop();
        resolve();
      }
    });
  });
}

export async function login(email: string, password: string): Promise<void> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (res.status === 429) throw new AuthError('Too many attempts. Wait a moment and try again.');
  if (!res.ok) throw new AuthError(await readError(res, 'Email or password is incorrect.'));
  const body = (await res.json()) as { accessToken: string };
  apply(body.accessToken, true);
}

export async function register(name: string, email: string, password: string): Promise<void> {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  });
  if (res.status === 429) throw new AuthError('Too many attempts. Wait a moment and try again.');
  if (!res.ok) throw new AuthError(await readError(res, 'The account could not be created.'));
  await login(email, password);
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
  } finally {
    clear(true);
  }
}

export { ApiFailure };

/**
 * Calls the API with the access token. A 401 triggers one refresh and one retry; if that fails the
 * sign-in dialog opens and the page stays as it is (Step 1.6).
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const send = (): Promise<Response> => {
    const token = state.status === 'signedIn' ? state.token : '';
    return fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include',
      headers: { ...init.headers, authorization: `Bearer ${token}` },
    });
  };
  let res = await send();
  if (res.status === 401) {
    const refreshed = await refreshNow();
    if (refreshed === 'ok') res = await send();
    if (res.status === 401) {
      if (state.status === 'signedIn') end();
      throw new ApiFailure(401, 'Your sign-in has ended.');
    }
  }
  if (!res.ok) {
    const body = await readBody(res);
    throw new ApiFailure(res.status, body.error?.message ?? 'Something went wrong.', body.error?.code, body);
  }
  return (await res.json()) as T;
}
