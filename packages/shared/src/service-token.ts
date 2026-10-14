// A cached service token (ADR-013). The DocBeam API starts it once and lets it renew in the
// background; a Lambda asks for it on use and renews it before it runs out. Nothing waits for the
// Auth Service unless the cached token is close to expiry.

export interface ServiceTokenOptions {
  /** Base URL of the Auth Service, for example `http://auth:3001`. */
  authUrl: string;
  clientId: string;
  /** The secret, or a function that reads it (Secrets Manager on AWS). */
  clientSecret: string | (() => Promise<string>);
  /** Space-separated scopes. */
  scope: string;
  /** Renew this long before the token expires. Default 60 s. */
  renewBeforeMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  onError?: (error: unknown) => void;
}

export interface ServiceTokenClient {
  /** A token that is valid for at least `renewBeforeMs` more. */
  get(): Promise<string>;
  /** Forget the cached token: the caller got a 401 and wants a new one. */
  invalidate(): void;
  /** Renew in the background until `stop()`. For long-running services only. */
  start(): Promise<void>;
  stop(): void;
}

interface Cached {
  token: string;
  expiresAt: number;
}

export function createServiceTokenClient(options: ServiceTokenOptions): ServiceTokenClient {
  const doFetch = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const renewBeforeMs = options.renewBeforeMs ?? 60_000;
  let cached: Cached | null = null;
  let inflight: Promise<Cached> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  const usable = (c: Cached | null): c is Cached => c !== null && c.expiresAt - now() > renewBeforeMs;

  async function request(): Promise<Cached> {
    const secret = typeof options.clientSecret === 'function' ? await options.clientSecret() : options.clientSecret;
    const res = await doFetch(`${options.authUrl}/auth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: options.clientId, clientSecret: secret, scope: options.scope }),
    });
    if (!res.ok) throw new Error(`Service token request failed with status ${res.status}.`);
    const body = (await res.json()) as { accessToken?: string; expiresIn?: number };
    if (!body.accessToken || typeof body.expiresIn !== 'number') throw new Error('Service token response is malformed.');
    return { token: body.accessToken, expiresAt: now() + body.expiresIn * 1000 };
  }

  /** One request at a time: parallel callers share the same call. */
  function refresh(): Promise<Cached> {
    inflight ??= request()
      .then((c) => {
        cached = c;
        return c;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  function schedule(): void {
    if (!running) return;
    const wait = cached ? Math.max(1_000, cached.expiresAt - now() - renewBeforeMs) : 5_000;
    timer = setTimeout(() => {
      refresh()
        .catch((error: unknown) => options.onError?.(error))
        .finally(schedule);
    }, wait);
    timer.unref?.();
  }

  return {
    async get() {
      if (usable(cached)) return cached.token;
      return (await refresh()).token;
    },
    invalidate() {
      cached = null;
    },
    async start() {
      running = true;
      await refresh();
      schedule();
    },
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
