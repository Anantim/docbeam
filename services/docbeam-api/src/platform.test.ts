import { describe, expect, it, vi } from 'vitest';
import { createPlatformClient } from './platform.js';

const config = { AUTH_URL: 'http://auth', PLATFORM_URL: 'http://platform', CLIENT_SECRET_DOCBEAM_API: 'secret' };
const dest = [{ binderId: 'b1', folderId: null }];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

/** A fetch that answers the token call and then the platform calls, in order. */
function fakeFetch(...platform: (Response | Error)[]) {
  let tokens = 0;
  const calls: { url: string; auth?: string }[] = [];
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/auth/token')) {
      tokens += 1;
      return json(200, { accessToken: `token-${tokens}`, expiresIn: 900 });
    }
    calls.push({ url, auth: (init?.headers as Record<string, string>)?.authorization });
    const next = platform.shift();
    if (!next) throw new Error('unexpected call');
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('platform client', () => {
  it('returns the resolved destinations in order, with the service token', async () => {
    const resolved = [{ binderId: 'b1', folderId: null, teamId: 't1', teamName: 'Cardio', path: 'Cardio / CARDIO-301 Regulatory (top level)' }];
    const f = fakeFetch(json(200, { destinations: resolved }));
    const out = await createPlatformClient(config, f.impl).checkDestinations('u1', dest);
    expect(out).toEqual({ ok: true, destinations: resolved });
    expect(f.calls[0]).toEqual({ url: 'http://platform/destinations/check', auth: 'Bearer token-1' });
  });

  it('returns the destinations that were not found on a 422', async () => {
    const f = fakeFetch(json(422, { error: { code: 'DESTINATION_NOT_FOUND', message: 'x' }, notFound: dest }));
    expect(await createPlatformClient(config, f.impl).checkDestinations('u1', dest)).toEqual({ ok: false, notFound: dest });
  });

  it('gets a new token and tries once more after a 401', async () => {
    const f = fakeFetch(json(401, {}), json(200, { destinations: [] }));
    const out = await createPlatformClient(config, f.impl).checkDestinations('u1', dest);
    expect(out).toEqual({ ok: true, destinations: [] });
    expect(f.calls.map((c) => c.auth)).toEqual(['Bearer token-1', 'Bearer token-2']);
  });

  it.each([
    ['a 500', json(500, {})],
    ['a 503', json(503, {})],
    ['a 401 twice', json(401, {})],
    ['a network error', new Error('connect ECONNREFUSED')],
  ])('answers 503 PLATFORM_UNAVAILABLE for %s', async (_label, answer) => {
    const f = fakeFetch(answer, json(401, {}));
    await expect(createPlatformClient(config, f.impl).checkDestinations('u1', dest)).rejects.toMatchObject({
      statusCode: 503,
      code: 'PLATFORM_UNAVAILABLE',
    });
  });

  it('answers 503 when the Auth Service is down too', async () => {
    const impl = vi.fn(async () => {
      throw new Error('auth down');
    }) as unknown as typeof fetch;
    await expect(createPlatformClient(config, impl).checkDestinations('u1', dest)).rejects.toMatchObject({ code: 'PLATFORM_UNAVAILABLE' });
  });
});

describe('platform client: user teams', () => {
  it('asks the platform once and reuses the answer for 60 seconds', async () => {
    const f = fakeFetch(json(200, { teamIds: ['t1', 't2'] }), json(200, { teamIds: ['t3'] }));
    let clock = 1_000;
    const client = createPlatformClient(config, f.impl, () => clock);
    expect(await client.userTeams('u1')).toEqual(['t1', 't2']);
    clock += 59_000;
    expect(await client.userTeams('u1')).toEqual(['t1', 't2']);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toEqual({ url: 'http://platform/users/u1/teams', auth: 'Bearer token-1' });
    clock += 2_000;
    expect(await client.userTeams('u1')).toEqual(['t3']);
    expect(f.calls).toHaveLength(2);
  });

  it('keeps each user\'s teams apart', async () => {
    const f = fakeFetch(json(200, { teamIds: ['a'] }), json(200, { teamIds: ['b'] }));
    const client = createPlatformClient(config, f.impl);
    expect(await client.userTeams('u1')).toEqual(['a']);
    expect(await client.userTeams('u2')).toEqual(['b']);
  });

  it('does not cache a failure and answers 503 PLATFORM_UNAVAILABLE', async () => {
    const f = fakeFetch(json(500, {}), json(200, { teamIds: ['a'] }));
    const client = createPlatformClient(config, f.impl);
    await expect(client.userTeams('u1')).rejects.toMatchObject({ statusCode: 503, code: 'PLATFORM_UNAVAILABLE' });
    expect(await client.userTeams('u1')).toEqual(['a']);
  });
});
