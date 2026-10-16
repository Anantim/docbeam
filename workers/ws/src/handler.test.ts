import { ApiError, type Poster, type TokenVerifier } from '@docbeam/shared';
import { describe, expect, it, vi } from 'vitest';
import { createHandler, type WsDeps, type WsEvent } from './handler.js';

const JOB = '11111111-1111-4111-8111-111111111111';
const TEAM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

interface Setup {
  sender?: string | null;
  connectionUser?: string | null;
  teams?: string[] | Error;
  deliveryToTeams?: boolean;
  verify?: TokenVerifier;
}

function setup(o: Setup = {}) {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const sent: unknown[] = [];
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    calls.push({ text, values });
    if (text.includes('FROM ws_connections')) {
      return o.connectionUser === null ? { rows: [], rowCount: 0 } : { rows: [{ user_id: o.connectionUser ?? 'viewer' }], rowCount: 1 };
    }
    if (text.includes('FROM jobs')) {
      return o.sender === null ? { rows: [], rowCount: 0 } : { rows: [{ submitted_by_user_id: o.sender ?? 'sender' }], rowCount: 1 };
    }
    if (text.includes('FROM tasks')) {
      return o.deliveryToTeams ? { rows: [{ '?column?': 1 }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 1 };
  });
  const post: Poster = async (_id, body) => {
    sent.push(JSON.parse(body));
    return true;
  };
  const verify: TokenVerifier =
    o.verify ?? (async () => ({ tokenUse: 'user', userId: 'viewer', email: 'v@example.com', name: 'V', expiresAt: 1_800_000_000 }));
  const deps: WsDeps = {
    db: { query } as unknown as WsDeps['db'],
    verify,
    teamsOf: async () => {
      if (o.teams instanceof Error) throw o.teams;
      return o.teams ?? [TEAM_A];
    },
    posterFor: () => post,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  return { handler: createHandler(async () => deps), calls, sent };
}

const event = (routeKey: string, extra: Partial<WsEvent> = {}): WsEvent => ({
  requestContext: { routeKey, connectionId: 'c-1' },
  ...extra,
});
const subscribeEvent = (jobId: unknown = JOB) => event('subscribe', { body: JSON.stringify({ action: 'subscribe', jobId }) });
const update = (calls: Array<{ text: string; values?: unknown[] }>) => calls.filter((c) => c.text.startsWith('UPDATE ws_connections'));

describe('$connect', () => {
  it('records the connection with the token expiry', async () => {
    const s = setup();
    const out = await s.handler(event('$connect', { queryStringParameters: { token: 'good' } }));
    expect(out).toEqual({ statusCode: 200 });
    const insert = s.calls.find((c) => c.text.includes('INSERT INTO ws_connections'));
    expect(insert?.values).toEqual(['c-1', 'viewer', 1_800_000_000]);
  });

  it('answers 401 and records nothing without a token', async () => {
    const s = setup();
    expect(await s.handler(event('$connect'))).toEqual({ statusCode: 401 });
    expect(s.calls).toEqual([]);
  });

  it('answers 401 for a token that does not verify', async () => {
    const s = setup({ verify: async () => { throw new ApiError(401, 'UNAUTHORIZED', 'Sign in again.'); } });
    expect(await s.handler(event('$connect', { queryStringParameters: { token: 'bad' } }))).toEqual({ statusCode: 401 });
    expect(s.calls).toEqual([]);
  });

  it('answers 401 for a service token', async () => {
    const s = setup({ verify: async () => ({ tokenUse: 'service', clientId: 'x', scopes: [], expiresAt: 1 }) });
    expect(await s.handler(event('$connect', { queryStringParameters: { token: 't' } }))).toEqual({ statusCode: 401 });
  });
});

describe('subscribe', () => {
  it('lets the sender watch their job with no team list, and tells the page', async () => {
    const s = setup({ sender: 'viewer' });
    expect(await s.handler(subscribeEvent())).toEqual({ statusCode: 200 });
    expect(update(s.calls)[0]?.values).toEqual(['c-1', JOB, []]);
    expect(s.sent).toEqual([{ type: 'subscribed', jobId: JOB }]);
  });

  it('lets a viewer watch when the job has a delivery to one of their teams, and stores those teams', async () => {
    const s = setup({ deliveryToTeams: true, teams: [TEAM_A] });
    expect(await s.handler(subscribeEvent())).toEqual({ statusCode: 200 });
    expect(update(s.calls)[0]?.values).toEqual(['c-1', JOB, [TEAM_A]]);
    expect(s.sent).toEqual([{ type: 'subscribed', jobId: JOB }]);
  });

  it('refuses a viewer with no delivery to their teams, and stops watching the earlier job', async () => {
    const s = setup({ deliveryToTeams: false });
    expect(await s.handler(subscribeEvent())).toEqual({ statusCode: 404 });
    expect(update(s.calls)[0]?.text).toContain('job_id = NULL');
    expect(s.sent).toEqual([{ type: 'subscribe_error', jobId: JOB, code: 'NOT_FOUND' }]);
  });

  it('gives the same answer for a job that does not exist', async () => {
    const s = setup({ sender: null });
    expect(await s.handler(subscribeEvent())).toEqual({ statusCode: 404 });
    expect(s.sent).toEqual([{ type: 'subscribe_error', jobId: JOB, code: 'NOT_FOUND' }]);
  });

  it('refuses a viewer with no teams without asking the database for deliveries', async () => {
    const s = setup({ teams: [] });
    expect(await s.handler(subscribeEvent())).toEqual({ statusCode: 404 });
    expect(s.calls.some((c) => c.text.includes('FROM tasks'))).toBe(false);
  });

  it('says so when the platform cannot be reached, and changes nothing', async () => {
    const s = setup({ teams: new Error('down') });
    expect(await s.handler(subscribeEvent())).toEqual({ statusCode: 503 });
    expect(update(s.calls)).toEqual([]);
    expect(s.sent).toEqual([{ type: 'subscribe_error', jobId: JOB, code: 'UNAVAILABLE' }]);
  });

  it('refuses a bad job id and an unknown or expired connection', async () => {
    const bad = setup();
    expect(await bad.handler(subscribeEvent('nope'))).toEqual({ statusCode: 400 });
    expect(bad.sent).toEqual([{ type: 'subscribe_error', jobId: null, code: 'VALIDATION_ERROR' }]);
    const gone = setup({ connectionUser: null });
    expect(await gone.handler(subscribeEvent())).toEqual({ statusCode: 403 });
    expect(update(gone.calls)).toEqual([]);
  });
});

describe('$disconnect and others', () => {
  it('deletes the connection row', async () => {
    const s = setup();
    expect(await s.handler(event('$disconnect'))).toEqual({ statusCode: 200 });
    expect(s.calls[0]).toMatchObject({ text: 'DELETE FROM ws_connections WHERE connection_id = $1', values: ['c-1'] });
  });

  it('answers 500 and does not throw when the database fails', async () => {
    const deps = setup();
    const failing = createHandler(async () => ({
      db: { query: async () => { throw new Error('db down'); } } as unknown as WsDeps['db'],
      verify: async () => { throw new Error('unused'); },
      teamsOf: async () => [],
      posterFor: () => undefined,
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));
    expect(await failing(event('$disconnect'))).toEqual({ statusCode: 500 });
    expect(deps.calls).toEqual([]);
  });

  it('answers 400 for a route it does not know', async () => {
    expect(await setup().handler(event('other'))).toEqual({ statusCode: 400 });
  });
});
