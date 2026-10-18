import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { activeTimer, instrumentPool, parseThrottledMs, registerSubmitTiming, SubmitTimer } from './timing.js';

describe('SubmitTimer', () => {
  it('records each lap as the time since the one before', () => {
    let clock = 100;
    const timer = new SubmitTimer(() => clock);
    clock = 110;
    timer.lap('a');
    clock = 135.25;
    timer.lap('b');
    expect(timer.report()).toEqual({ a: 10, b: 25.3 });
  });

  it('times a span on its own and leaves the laps alone', async () => {
    let clock = 0;
    const timer = new SubmitTimer(() => clock);
    let finish!: (value: string) => void;
    const running = timer.span('call', new Promise<string>((resolve) => (finish = resolve)));
    clock = 40;
    finish('answer');
    await expect(running).resolves.toBe('answer');
    clock = 50;
    timer.lap('after');
    expect(timer.report()).toEqual({ call: 40, after: 50 });
  });

  it('still records a span whose promise fails, and passes the failure on', async () => {
    let clock = 0;
    const timer = new SubmitTimer(() => clock);
    let fail!: (error: Error) => void;
    const running = timer.span('call', new Promise<string>((_resolve, reject) => (fail = reject)));
    clock = 7;
    fail(new Error('platform down'));
    await expect(running).rejects.toThrow('platform down');
    expect(timer.report()).toEqual({ call: 7 });
  });
});

describe('instrumentPool', () => {
  /** A pool whose connect takes `delay` ms of a fake clock, with counts the test can set. */
  function fakePool(counts: { total: number; idle: number; waiting: number }, onConnect: () => void) {
    const listeners: Array<() => void> = [];
    return {
      totalCount: counts.total,
      idleCount: counts.idle,
      waitingCount: counts.waiting,
      on: (_event: string, listener: () => void) => listeners.push(listener),
      connect: async () => {
        onConnect();
        return { release: () => undefined };
      },
      fireConnect: () => listeners.forEach((l) => l()),
    };
  }

  it('gives the running request the wait for a connection, the pool counts and the connections opened', async () => {
    const pool = fakePool({ total: 2, idle: 0, waiting: 3 }, () => undefined);
    instrumentPool(pool as never);
    const timer = new SubmitTimer();
    await activeTimer.run(timer, async () => {
      await (pool as never as { connect: () => Promise<unknown> }).connect();
      pool.fireConnect(); // the pool opened a connection while this request ran
    });
    timer.lap('keyLookupMs');
    const stalls = timer.stalls();
    expect(stalls).toMatchObject({ poolAcquires: 1, poolMaxWaiting: 3, poolTotal: 2, poolMinIdle: 0, newConnections: 1 });
    expect(stalls.poolWaitMs).toBeGreaterThanOrEqual(0);
    expect(timer.report()).toHaveProperty('keyLookupMsPool');
  });

  it('leaves a call alone when no request is running', async () => {
    const pool = fakePool({ total: 1, idle: 1, waiting: 0 }, () => undefined);
    instrumentPool(pool as never);
    await expect((pool as never as { connect: () => Promise<unknown> }).connect()).resolves.toBeDefined();
    expect(new SubmitTimer().stalls()).not.toHaveProperty('poolAcquires');
  });
});

describe('parseThrottledMs', () => {
  it('reads cgroup v2 microseconds', () => {
    expect(parseThrottledMs('usage_usec 5\nnr_periods 9\nnr_throttled 3\nthrottled_usec 250000\n')).toBe(250);
  });

  it('reads cgroup v1 nanoseconds', () => {
    expect(parseThrottledMs('nr_periods 9\nnr_throttled 3\nthrottled_time 42000000\n')).toBe(42);
  });

  it('says null when the text has no throttle figure', () => {
    expect(parseThrottledMs('usage_usec 5\n')).toBeNull();
  });
});

describe('registerSubmitTiming', () => {
  async function build() {
    const lines: Record<string, unknown>[] = [];
    const stream = { write: (line: string) => lines.push(JSON.parse(line) as Record<string, unknown>) };
    const app = Fastify({ logger: { level: 'info', stream } });
    registerSubmitTiming(app);
    app.post('/jobs', async (request) => {
      request.submitTimer?.lap('authMs');
      request.submitTimer!.size = { files: 2, destinations: 3, tasks: 6 };
      return { ok: true };
    });
    app.post('/other', async () => ({ ok: true }));
    await app.ready();
    return { app, lines };
  }

  const timingLines = (lines: Record<string, unknown>[]) => lines.filter((l) => l.msg === 'submit timing');

  it('logs one line per POST /jobs with the size and every phase', async () => {
    const { app, lines } = await build();
    const res = await app.inject({ method: 'POST', url: '/jobs', payload: { files: [] } });
    expect(res.statusCode).toBe(200);
    const logged = timingLines(lines);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ status: 200, size: { files: 2, destinations: 3, tasks: 6 } });
    expect(Object.keys(logged[0]!.ms as object)).toEqual(expect.arrayContaining(['authMs', 'bodyReadMs', 'jsonParseMs', 'totalMs', 'gcMs']));
  });

  it('does not time other routes', async () => {
    const { app, lines } = await build();
    await app.inject({ method: 'POST', url: '/other', payload: { a: 1 } });
    expect(timingLines(lines)).toHaveLength(0);
  });

  it('keeps refusing a body that is not JSON, and still logs the request', async () => {
    const { app, lines } = await build();
    const res = await app.inject({ method: 'POST', url: '/jobs', headers: { 'content-type': 'application/json' }, payload: '{nope' });
    expect(res.statusCode).toBe(400);
    expect(timingLines(lines)[0]).toMatchObject({ status: 400 });
  });
});
