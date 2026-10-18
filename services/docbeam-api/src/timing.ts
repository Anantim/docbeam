import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { PerformanceObserver } from 'node:perf_hooks';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

/** The timer of the request that is running, so the database pool can report its waits to it. */
export const activeTimer = new AsyncLocalStorage<SubmitTimer>();

let connectionsOpened = 0;

/** What the pool looked like when a query asked for a connection. */
export interface PoolSnapshot {
  total: number;
  idle: number;
  waiting: number;
}

/**
 * Makes the pool report, to the timer of the running request, how long each query waited for a connection (apart from
 * the query itself) and how full the pool was at that moment, and counts the connections the pool opens (D-M5-16).
 */
export function instrumentPool(pool: pg.Pool): void {
  pool.on('connect', () => {
    connectionsOpened += 1;
  });
  const connect = pool.connect.bind(pool) as (callback?: (...args: unknown[]) => void) => unknown;
  (pool as unknown as { connect: typeof connect }).connect = (callback) => {
    const timer = activeTimer.getStore();
    if (!timer) return connect(callback);
    const from = performance.now();
    const snapshot = { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount };
    if (callback) {
      return connect((...args: unknown[]) => {
        timer.poolWait(performance.now() - from, snapshot);
        callback(...args);
      });
    }
    return (connect() as Promise<unknown>).then((client) => {
      timer.poolWait(performance.now() - from, snapshot);
      return client;
    });
  };
}

/**
 * Time this process has spent waiting because its CPU quota ran out, from the text of a cgroup `cpu.stat` file
 * (v2 gives `throttled_usec`, v1 gives `throttled_time` in nanoseconds). Null when the text has neither.
 */
export function parseThrottledMs(text: string): number | null {
  const v2 = /^throttled_usec (\d+)$/m.exec(text);
  if (v2) return Number(v2[1]) / 1000;
  const v1 = /^throttled_time (\d+)$/m.exec(text);
  if (v1) return Number(v1[1]) / 1e6;
  return null;
}

const CPU_STAT_FILES = ['/sys/fs/cgroup/cpu.stat', '/sys/fs/cgroup/cpu/cpu.stat'];

/** Total ms this container has been held back by its CPU limit, or null where the file does not exist (a laptop). */
export function readThrottledMs(): number | null {
  for (const file of CPU_STAT_FILES) {
    try {
      return parseThrottledMs(readFileSync(file, 'utf8'));
    } catch {
      /* try the next file */
    }
  }
  return null;
}

let gcTotalMs = 0;
let gcWatching = false;
/** Total ms of garbage collection so far. Starts counting at the first call. */
export function gcMsSoFar(): number {
  if (!gcWatching) {
    gcWatching = true;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) gcTotalMs += entry.duration;
    }).observe({ entryTypes: ['gc'] });
  }
  return gcTotalMs;
}

/**
 * Times the phases of one POST /jobs from the moment the request reaches the service (check 5.1, D-M5-14).
 * A lap is the time since the previous lap; a span is a stretch of its own that may overlap the laps.
 */
export class SubmitTimer {
  private last: number;
  private readonly phases: Record<string, number> = {};
  /** Set by the route once the body is understood; used to group the log lines by job size. */
  size: { files: number; destinations: number; tasks: number } | null = null;

  private readonly throttledAtStart = readThrottledMs();
  private readonly gcAtStart = gcMsSoFar();
  private readonly openedAtStart = connectionsOpened;
  private waitSinceLap = 0;
  private pool = { waitMs: 0, maxWaitMs: 0, acquires: 0, maxWaiting: 0, maxTotal: 0, minIdle: Number.POSITIVE_INFINITY };

  constructor(private readonly now: () => number = () => performance.now()) {
    this.last = now();
  }

  /** A query waited `ms` for a connection; `snapshot` is the pool as it asked. */
  poolWait(ms: number, snapshot: PoolSnapshot): void {
    this.waitSinceLap += ms;
    this.pool.waitMs += ms;
    this.pool.maxWaitMs = Math.max(this.pool.maxWaitMs, ms);
    this.pool.acquires += 1;
    this.pool.maxWaiting = Math.max(this.pool.maxWaiting, snapshot.waiting);
    this.pool.maxTotal = Math.max(this.pool.maxTotal, snapshot.total);
    this.pool.minIdle = Math.min(this.pool.minIdle, snapshot.idle);
  }

  /** What stalled the process during this request: the CPU limit, garbage collection, and the database pool (ms and counts). */
  stalls(): Record<string, number> {
    const throttled = readThrottledMs();
    const out: Record<string, number> = { gcMs: round(gcMsSoFar() - this.gcAtStart) };
    if (throttled !== null && this.throttledAtStart !== null) out.throttledMs = round(throttled - this.throttledAtStart);
    if (this.pool.acquires > 0) {
      out.poolWaitMs = round(this.pool.waitMs);
      out.poolMaxWaitMs = round(this.pool.maxWaitMs);
      out.poolAcquires = this.pool.acquires;
      out.poolMaxWaiting = this.pool.maxWaiting;
      out.poolTotal = this.pool.maxTotal;
      out.poolMinIdle = this.pool.minIdle;
      out.newConnections = connectionsOpened - this.openedAtStart;
    }
    return out;
  }

  /** Records the time since the last lap under this name, and the pool wait inside it when there was one. */
  lap(name: string): void {
    const at = this.now();
    this.phases[name] = round(at - this.last);
    if (this.waitSinceLap > 0) this.phases[`${name}Pool`] = round(this.waitSinceLap);
    this.waitSinceLap = 0;
    this.last = at;
  }

  /** Records how long the promise takes, without moving the laps. Its result passes through. */
  async span<T>(name: string, work: Promise<T>): Promise<T> {
    const from = this.now();
    try {
      return await work;
    } finally {
      this.phases[name] = round(this.now() - from);
    }
  }

  report(): Record<string, number> {
    return { ...this.phases };
  }
}

const round = (ms: number): number => Math.round(ms * 10) / 10;

declare module 'fastify' {
  interface FastifyRequest {
    submitTimer: SubmitTimer | null;
  }
}

/**
 * Starts a timer when a POST /jobs request is received (before the body is read), splits the body read from the
 * JSON parse, and logs one line per request with the job size and every phase in ms (so Logs Insights can give
 * p50 and p99 per phase and per size). The route adds the rest of the laps.
 */
export function registerSubmitTiming(app: FastifyInstance): void {
  app.decorateRequest('submitTimer', null);

  app.addHook('onRequest', (request, _reply, done) => {
    if (request.method === 'POST' && request.routeOptions.url === '/jobs') {
      const timer = new SubmitTimer();
      request.submitTimer = timer;
      activeTimer.run(timer, done); // the rest of the request, and its queries, run inside this store
    } else done();
  });

  // The same parser as Fastify's own, with the body read as a string first, so the read and the parse are timed apart.
  const parseJson = app.getDefaultJsonParser('error', 'error');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    request.submitTimer?.lap('bodyReadMs');
    parseJson(request, body as string, (error, parsed) => {
      request.submitTimer?.lap('jsonParseMs');
      done(error, parsed);
    });
  });

  app.addHook('onResponse', async (request, reply) => {
    const timer = request.submitTimer;
    if (!timer) return;
    request.log.info(
      { status: reply.statusCode, size: timer.size, ms: { ...timer.report(), totalMs: round(reply.elapsedTime), ...timer.stalls() } },
      'submit timing',
    );
  });
}
