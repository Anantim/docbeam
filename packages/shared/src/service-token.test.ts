import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServiceTokenClient } from './service-token.js';

function fakeAuth(expiresIn = 900) {
  let n = 0;
  const calls: unknown[] = [];
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    n += 1;
    calls.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ accessToken: `token-${n}`, expiresIn }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const base = { authUrl: 'http://auth', clientId: 'delivery-worker', clientSecret: 's3cret', scope: 'documents:ingest' };

describe('service token client', () => {
  afterEach(() => vi.useRealTimers());

  it('asks the Auth Service once and serves the cached token', async () => {
    const { fetchImpl, calls } = fakeAuth();
    const client = createServiceTokenClient({ ...base, fetchImpl });
    expect(await client.get()).toBe('token-1');
    expect(await client.get()).toBe('token-1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(calls[0]).toEqual({ clientId: 'delivery-worker', clientSecret: 's3cret', scope: 'documents:ingest' });
  });

  it('shares one request between parallel callers', async () => {
    const { fetchImpl } = fakeAuth();
    const client = createServiceTokenClient({ ...base, fetchImpl });
    const tokens = await Promise.all([client.get(), client.get(), client.get()]);
    expect(new Set(tokens)).toEqual(new Set(['token-1']));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('renews a token that is within a minute of expiring', async () => {
    const { fetchImpl } = fakeAuth(900);
    let clock = 0;
    const client = createServiceTokenClient({ ...base, fetchImpl, now: () => clock });
    expect(await client.get()).toBe('token-1');
    clock = 839_000; // 61 s left: still good
    expect(await client.get()).toBe('token-1');
    clock = 841_000; // 59 s left: renew
    expect(await client.get()).toBe('token-2');
  });

  it('gets a new token after invalidate (the caller saw a 401)', async () => {
    const { fetchImpl } = fakeAuth();
    const client = createServiceTokenClient({ ...base, fetchImpl });
    await client.get();
    client.invalidate();
    expect(await client.get()).toBe('token-2');
  });

  it('reads the secret through a function when one is given', async () => {
    const { fetchImpl, calls } = fakeAuth();
    const client = createServiceTokenClient({ ...base, clientSecret: async () => 'from-secrets-manager', fetchImpl });
    await client.get();
    expect(calls[0]).toMatchObject({ clientSecret: 'from-secrets-manager' });
  });

  it('fails with the status when the Auth Service refuses', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    const client = createServiceTokenClient({ ...base, fetchImpl });
    await expect(client.get()).rejects.toThrow('401');
    // A failure is not cached: the next call asks again.
    await expect(client.get()).rejects.toThrow('401');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('renews in the background before the token runs out', async () => {
    vi.useFakeTimers();
    const { fetchImpl } = fakeAuth(900);
    const client = createServiceTokenClient({ ...base, fetchImpl });
    await client.start();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(839_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // not yet: renews at 900 s minus the 60 s lead
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    client.stop();
    await vi.advanceTimersByTimeAsync(2_000_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
