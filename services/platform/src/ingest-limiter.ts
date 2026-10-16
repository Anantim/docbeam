import { ApiError } from '@docbeam/shared';

/** At most this many files are read, hashed and stored at once. The rest wait their turn (D-M2-22). */
export const MAX_CONCURRENT_INGESTS = 6;
/** A request that has waited this long for a turn is answered 503, so no Delivery call times out while it waits. */
export const MAX_INGEST_WAIT_MS = 30_000;
/** Seconds the 503 asks the caller to wait. Delivery uses its own retry gaps instead. */
export const RETRY_AFTER_SECONDS = 30;

interface Waiter {
  grant: (release: () => void) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Caps how many file ingests run at once. Each one streams a whole file through this process, so without a cap a
 * burst of large deliveries uses all the CPU and memory of the task (the dev stress run, D-M2-22).
 */
export class IngestLimiter {
  private active = 0;
  private readonly waiting: Waiter[] = [];

  constructor(
    private readonly max: number = MAX_CONCURRENT_INGESTS,
    private readonly maxWaitMs: number = MAX_INGEST_WAIT_MS,
  ) {}

  /** Resolves with a release function when a turn is free, or fails with a 503 after `maxWaitMs`. */
  acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve(this.releaser());
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        grant: resolve,
        timer: setTimeout(() => {
          this.waiting.splice(this.waiting.indexOf(waiter), 1);
          reject(new ApiError(503, 'PLATFORM_BUSY', 'The platform is busy with other files. Try again shortly.'));
        }, this.maxWaitMs),
      };
      this.waiting.push(waiter);
    });
  }

  get running(): number {
    return this.active;
  }

  get queued(): number {
    return this.waiting.length;
  }

  /** Gives the turn back once, however many times it is called. */
  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiting.shift();
      if (next) {
        clearTimeout(next.timer);
        next.grant(this.releaser());
      } else {
        this.active--;
      }
    };
  }
}
