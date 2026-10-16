import { ApiError } from '@docbeam/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IngestLimiter } from './ingest-limiter.js';

describe('IngestLimiter (D-M2-22)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('lets the first `max` ingests start at once and holds the next one', async () => {
    const limiter = new IngestLimiter(2, 30_000);
    const a = await limiter.acquire();
    await limiter.acquire();
    expect(limiter.running).toBe(2);

    let third = false;
    void limiter.acquire().then(() => (third = true));
    await vi.advanceTimersByTimeAsync(1000);
    expect(third).toBe(false);
    expect(limiter.queued).toBe(1);

    a();
    await vi.advanceTimersByTimeAsync(0);
    expect(third).toBe(true);
    expect(limiter.running).toBe(2);
    expect(limiter.queued).toBe(0);
  });

  it('never runs more than `max` at once, and serves waiters in order', async () => {
    const limiter = new IngestLimiter(3, 30_000);
    let running = 0;
    let peak = 0;
    const order: number[] = [];
    const job = async (n: number) => {
      const release = await limiter.acquire();
      order.push(n);
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 100));
      running--;
      release();
    };
    const all = Promise.all(Array.from({ length: 12 }, (_, i) => job(i)));
    await vi.advanceTimersByTimeAsync(1000);
    await all;
    expect(peak).toBe(3);
    expect(order).toEqual([...order].sort((x, y) => x - y));
    expect(limiter.running).toBe(0);
  });

  it('answers a request that waits longer than the limit with a 503 PLATFORM_BUSY, and frees nothing', async () => {
    const limiter = new IngestLimiter(1, 30_000);
    await limiter.acquire();

    const waiting = limiter.acquire();
    const outcome = waiting.then(
      () => 'granted',
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(29_999);
    expect(limiter.queued).toBe(1);
    await vi.advanceTimersByTimeAsync(1);

    const error = await outcome;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ statusCode: 503, code: 'PLATFORM_BUSY' });
    expect(limiter.queued).toBe(0);
    expect(limiter.running).toBe(1);
  });

  it('gives a turn back only once, however often release is called', async () => {
    const limiter = new IngestLimiter(1, 30_000);
    const release = await limiter.acquire();
    release();
    release();
    expect(limiter.running).toBe(0);
    const again = await limiter.acquire();
    expect(limiter.running).toBe(1);
    again();
  });

  it('does not hand a turn to a request that already timed out', async () => {
    const limiter = new IngestLimiter(1, 1000);
    const first = await limiter.acquire();
    const late = limiter.acquire().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await late).toBeInstanceOf(ApiError);
    first();
    expect(limiter.running).toBe(0);
  });
});
