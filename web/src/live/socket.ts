// The live connection (ADR-007, TDD Step 3.3). Rules the page relies on:
//  - The token goes in the query string (browsers cannot set headers on the handshake).
//  - To watch a job: subscribe, wait for the server's `subscribed`, and only then fetch its tasks. `watch()`
//    resolves at that moment, so nothing falls between the fetch and the first push.
//  - A new token means a new connection (the server checks the token and the viewer's teams only at connect and
//    subscribe, so someone removed from a team stops within 15 minutes).
//  - After every reconnect the job is subscribed again and `onResync` fires once, so the page refetches once.
//    There is no replay buffer on the server.

export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
}

export interface Counts {
  pending: number;
  in_progress: number;
  completed: number;
  /** Real failures only. */
  failed: number;
  /** Deliveries the sender cancelled (D-M3-17). */
  cancelled: number;
}

export type LiveMessage =
  | {
      type: 'task_update';
      jobId: string;
      taskId: string;
      status: 'completed' | 'failed' | 'in_progress';
      failureCode?: string;
      failureReason?: string;
      /** Attempts the task took, when the server knows. */
      attemptCount?: number;
      updatedAt: string;
      counts: Counts;
    }
  | { type: 'job_update'; jobId: string; updatedAt: string; counts: Counts };

export type WatchResult = 'subscribed' | 'not_found' | 'unavailable';
export type LiveStatus = 'closed' | 'connecting' | 'open';

export interface LiveOptions {
  url: string;
  createSocket?: (url: string) => SocketLike;
  /** Waits before each reconnect after a drop; the last value repeats. */
  backoffMs?: number[];
  /** How long `watch()` waits for the server before the page fetches anyway. */
  ackTimeoutMs?: number;
}

interface Pending {
  jobId: string;
  resolve: (result: WatchResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class LiveClient {
  private readonly url: string;
  private readonly create: (url: string) => SocketLike;
  private readonly backoff: number[];
  private readonly ackTimeout: number;

  private token: string | null = null;
  private socket: SocketLike | null = null;
  private status: LiveStatus = 'closed';
  private watching: string | null = null;
  private pending: Pending | null = null;
  private attempt = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;

  private messageListeners = new Set<(m: LiveMessage) => void>();
  private resyncListeners = new Set<(jobId: string) => void>();
  private statusListeners = new Set<(s: LiveStatus) => void>();

  constructor(options: LiveOptions) {
    this.url = options.url;
    this.create = options.createSocket ?? ((url) => new WebSocket(url) as unknown as SocketLike);
    this.backoff = options.backoffMs ?? [1_000, 2_000, 4_000, 8_000, 15_000];
    this.ackTimeout = options.ackTimeoutMs ?? 5_000;
  }

  /** Call with the current access token. A different token reconnects at once; null disconnects for good. */
  setToken(token: string | null): void {
    if (token === this.token) return;
    this.token = token;
    this.stopSocket();
    if (token) {
      this.attempt = 0;
      this.connect();
    } else {
      this.setStatus('closed');
    }
  }

  /** Subscribes to a job. Resolves once the server has recorded it; the caller then fetches the tasks. */
  watch(jobId: string): Promise<WatchResult> {
    this.settle('unavailable');
    this.watching = jobId;
    return new Promise<WatchResult>((resolve) => {
      const timer = setTimeout(() => {
        // The page fetches anyway. If the server answers later, the late ack makes it fetch once more.
        if (this.pending?.jobId === jobId) this.pending = null;
        resolve('unavailable');
      }, this.ackTimeout);
      this.pending = { jobId, resolve, timer };
      if (this.status === 'open') this.sendSubscribe(jobId);
    });
  }

  unwatch(): void {
    this.settle('unavailable');
    this.watching = null;
  }

  onMessage(listener: (m: LiveMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  /** Fires after a reconnect has subscribed to the watched job again. The page refetches once. */
  onResync(listener: (jobId: string) => void): () => void {
    this.resyncListeners.add(listener);
    return () => this.resyncListeners.delete(listener);
  }

  onStatus(listener: (s: LiveStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  getStatus(): LiveStatus {
    return this.status;
  }

  close(): void {
    this.setToken(null);
    this.settle('unavailable');
    this.watching = null;
  }

  private connect(): void {
    if (!this.token) return;
    this.setStatus('connecting');
    const socket = this.create(`${this.url}?token=${encodeURIComponent(this.token)}`);
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.attempt = 0;
      this.setStatus('open');
      if (this.watching) this.sendSubscribe(this.watching);
    };
    socket.onmessage = (event) => {
      if (this.socket === socket) this.receive(String(event.data));
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.setStatus('closed');
      const wait = this.backoff[Math.min(this.attempt, this.backoff.length - 1)] ?? 1_000;
      this.attempt += 1;
      this.retry = setTimeout(() => this.connect(), wait);
    };
  }

  /** Closes the current socket on purpose: its close event must not start a reconnect. */
  private stopSocket(): void {
    clearTimeout(this.retry);
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = null;
      socket.close();
    }
  }

  private sendSubscribe(jobId: string): void {
    this.socket?.send(JSON.stringify({ action: 'subscribe', jobId }));
  }

  private receive(raw: string): void {
    let message: { type?: string; jobId?: string | null; code?: string };
    try {
      message = JSON.parse(raw) as typeof message;
    } catch {
      return;
    }
    if (message.type === 'subscribed' || message.type === 'subscribe_error') {
      const jobId = message.jobId;
      if (!jobId || jobId !== this.watching) return; // an answer for a job the page has moved on from
      const result: WatchResult =
        message.type === 'subscribed' ? 'subscribed' : message.code === 'NOT_FOUND' ? 'not_found' : 'unavailable';
      if (this.pending && this.pending.jobId === jobId) {
        this.settle(result);
      } else {
        // Nobody is waiting: this is the answer to a subscribe sent after a reconnect (or a late one).
        for (const l of this.resyncListeners) l(jobId);
      }
      return;
    }
    if (message.type === 'task_update' || message.type === 'job_update') {
      for (const l of this.messageListeners) l(message as LiveMessage);
    }
  }

  private settle(result: WatchResult): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.resolve(result);
  }

  private setStatus(next: LiveStatus): void {
    if (this.status === next) return;
    this.status = next;
    for (const l of this.statusListeners) l(next);
  }
}
