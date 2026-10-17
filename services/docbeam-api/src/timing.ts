import { readFileSync } from 'node:fs';
import { PerformanceObserver } from 'node:perf_hooks';
import type { FastifyInstance } from 'fastify';

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

  constructor(private readonly now: () => number = () => performance.now()) {
    this.last = now();
  }

  /** What stalled the process during this request: held back by the CPU limit, and garbage collection (ms). */
  stalls(): Record<string, number> {
    const throttled = readThrottledMs();
    const out: Record<string, number> = { gcMs: round(gcMsSoFar() - this.gcAtStart) };
    if (throttled !== null && this.throttledAtStart !== null) out.throttledMs = round(throttled - this.throttledAtStart);
    return out;
  }

  /** Records the time since the last lap under this name. */
  lap(name: string): void {
    const at = this.now();
    this.phases[name] = round(at - this.last);
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

  app.addHook('onRequest', async (request) => {
    if (request.method === 'POST' && request.routeOptions.url === '/jobs') request.submitTimer = new SubmitTimer();
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
