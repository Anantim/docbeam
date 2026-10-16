import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveClient, type LiveMessage, type SocketLike } from './socket.js';

class FakeSocket implements SocketLike {
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
  open(): void {
    this.onopen?.();
  }
  say(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  drop(): void {
    this.onclose?.();
  }
}

const JOB = 'job-1';
let sockets: FakeSocket[];
const last = () => sockets[sockets.length - 1] as FakeSocket;

function client(options: { ackTimeoutMs?: number } = {}) {
  return new LiveClient({
    url: 'ws://x/v1',
    createSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    backoffMs: [1_000, 2_000],
    ...options,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
});
afterEach(() => vi.useRealTimers());

describe('connecting', () => {
  it('connects with the token in the query string and does nothing without one', () => {
    const c = client();
    expect(sockets).toHaveLength(0);
    c.setToken('a b');
    expect(last().url).toBe('ws://x/v1?token=a%20b');
    c.setToken(null);
    expect(last().closed).toBe(true);
    expect(c.getStatus()).toBe('closed');
  });

  it('opens a new connection when the token changes, and closes the old one without reconnecting it', () => {
    const c = client();
    c.setToken('one');
    const first = last();
    first.open();
    c.setToken('two');
    expect(first.closed).toBe(true);
    expect(sockets).toHaveLength(2);
    expect(last().url).toContain('token=two');
    first.drop(); // a late close event from the old socket
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(2);
  });

  it('ignores the same token twice', () => {
    const c = client();
    c.setToken('one');
    c.setToken('one');
    expect(sockets).toHaveLength(1);
  });
});

describe('watching a job: subscribe first, fetch after the answer', () => {
  it('sends the subscribe when the socket is open and resolves only on the server\'s answer', async () => {
    const c = client();
    c.setToken('t');
    last().open();
    let result: string | undefined;
    const done = c.watch(JOB).then((r) => (result = r));
    expect(JSON.parse(last().sent[0] as string)).toEqual({ action: 'subscribe', jobId: JOB });
    await Promise.resolve();
    expect(result).toBeUndefined(); // the page must not fetch yet
    last().say({ type: 'subscribed', jobId: JOB });
    await done;
    expect(result).toBe('subscribed');
  });

  it('waits for the connection when watch is called first, then subscribes', async () => {
    const c = client();
    c.setToken('t');
    const done = c.watch(JOB);
    expect(last().sent).toEqual([]);
    last().open();
    expect(last().sent).toHaveLength(1);
    last().say({ type: 'subscribed', jobId: JOB });
    expect(await done).toBe('subscribed');
  });

  it('reports a refused subscription as not found', async () => {
    const c = client();
    c.setToken('t');
    last().open();
    const done = c.watch(JOB);
    last().say({ type: 'subscribe_error', jobId: JOB, code: 'NOT_FOUND' });
    expect(await done).toBe('not_found');
  });

  it('lets the page fetch anyway when the server does not answer, and resyncs on a late answer', async () => {
    const c = client({ ackTimeoutMs: 5_000 });
    const resyncs: string[] = [];
    c.onResync((id) => resyncs.push(id));
    c.setToken('t');
    last().open();
    const done = c.watch(JOB);
    vi.advanceTimersByTime(5_000);
    expect(await done).toBe('unavailable');
    last().say({ type: 'subscribed', jobId: JOB });
    expect(resyncs).toEqual([JOB]);
  });

  it('ignores an answer for a job the page has moved on from', async () => {
    const c = client();
    c.setToken('t');
    last().open();
    void c.watch('old');
    const next = c.watch('new');
    last().say({ type: 'subscribed', jobId: 'old' });
    last().say({ type: 'subscribed', jobId: 'new' });
    expect(await next).toBe('subscribed');
  });
});

describe('catching up after a drop', () => {
  async function watched() {
    const c = client();
    const resyncs: string[] = [];
    c.onResync((id) => resyncs.push(id));
    c.setToken('t');
    last().open();
    const done = c.watch(JOB);
    last().say({ type: 'subscribed', jobId: JOB });
    await done;
    return { c, resyncs };
  }

  it('reconnects with a back-off, subscribes again and tells the page to refetch exactly once', async () => {
    const { resyncs } = await watched();
    last().drop();
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    last().open();
    expect(JSON.parse(last().sent[0] as string)).toEqual({ action: 'subscribe', jobId: JOB });
    expect(resyncs).toEqual([]); // not before the server has recorded the subscription
    last().say({ type: 'subscribed', jobId: JOB });
    expect(resyncs).toEqual([JOB]);
  });

  it('backs off longer when the reconnect fails again, and starts over after a good connection', async () => {
    const { c } = await watched();
    last().drop();
    vi.advanceTimersByTime(1_000);
    last().drop(); // never opened
    vi.advanceTimersByTime(1_999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
    last().open();
    last().drop();
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(4);
    expect(c.getStatus()).toBe('connecting');
  });

  it('resyncs after a token refresh moves the connection', async () => {
    const { c, resyncs } = await watched();
    c.setToken('refreshed');
    last().open();
    last().say({ type: 'subscribed', jobId: JOB });
    expect(resyncs).toEqual([JOB]);
  });

  it('does not reconnect after close()', async () => {
    const { c } = await watched();
    c.close();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
  });
});

describe('pushes', () => {
  it('passes task and job updates to listeners and ignores anything else', () => {
    const c = client();
    const seen: LiveMessage[] = [];
    c.onMessage((m) => seen.push(m));
    c.setToken('t');
    last().open();
    const counts = { pending: 0, in_progress: 0, completed: 1, failed: 0 };
    last().say({ type: 'task_update', jobId: JOB, taskId: 't1', status: 'completed', updatedAt: '2026-10-16T00:00:00Z', counts });
    last().say({ type: 'job_update', jobId: JOB, updatedAt: '2026-10-16T00:00:01Z', counts });
    last().say({ type: 'other' });
    last().onmessage?.({ data: 'not json' });
    expect(seen.map((m) => m.type)).toEqual(['task_update', 'job_update']);
  });
});
