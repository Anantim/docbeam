import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiFailure } from '../auth/errors.js';
import type { FileState, UploadApi, UploadGrant, UploadRequest } from './api-types.js';
import { LINK_FRESH_MS, POLL_MS, UploadManager } from './manager.js';
import { TransportError, type Transport, type TransportResult } from './transport.js';

const MIB = 1024 ** 2;
const PART = 16 * MIB;

const fakeFile = (name: string, size = 10): File => {
  const f = new File([new Uint8Array(1)], name);
  Object.defineProperty(f, 'size', { value: size });
  return f;
};
const pdf = (name: string, size = 10) => ({ file: fakeFile(name, size), contentType: 'application/pdf' });

function need<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected a value.');
  return value;
}
const snap = (manager: UploadManager, index: number) => need(manager.getSnapshot()[index]);
const callArg = (fn: ReturnType<typeof vi.fn>, call: number, arg: number): unknown => need(fn.mock.calls[call])[arg];

type Answer = TransportResult | Error;

class FakeTransport implements Transport {
  hold = false;
  waiting: Array<() => void> = [];
  active = 0;
  max = 0;
  posts: Array<{ url: string }> = [];
  puts: Array<{ url: string; sha256Base64: string }> = [];
  aborted: string[] = [];
  answer: (kind: 'post' | 'put', n: number) => Answer = (kind, n) => ({ status: 204, body: '', etag: kind === 'put' ? `"etag-${n}"` : undefined });

  private run(kind: 'post' | 'put', signal: AbortSignal): Promise<TransportResult> {
    const n = this.posts.length + this.puts.length;
    return new Promise((resolve, reject) => {
      let done = false;
      this.active += 1;
      this.max = Math.max(this.max, this.active);
      const end = (): boolean => {
        if (done) return false;
        done = true;
        this.active -= 1;
        return true;
      };
      const finish = () => {
        if (!end()) return;
        const a = this.answer(kind, n);
        if (a instanceof Error) reject(a);
        else resolve(a);
      };
      signal.addEventListener('abort', () => {
        this.waiting = this.waiting.filter((w) => w !== finish);
        if (end()) reject(new DOMException('cancelled', 'AbortError'));
      });
      if (this.hold) this.waiting.push(finish);
      else queueMicrotask(finish);
    });
  }

  post(args: { url: string; signal: AbortSignal }): Promise<TransportResult> {
    this.posts.push({ url: args.url });
    return this.run('post', args.signal);
  }

  put(args: { url: string; sha256Base64: string; signal: AbortSignal }): Promise<TransportResult> {
    this.puts.push({ url: args.url, sha256Base64: args.sha256Base64 });
    return this.run('put', args.signal);
  }

  async abort(url: string): Promise<void> {
    this.aborted.push(url);
  }

  releaseAll(): void {
    const batch = this.waiting;
    this.waiting = [];
    for (const f of batch) f();
  }
}

let transport: FakeTransport;
let clock: number;
let serverIds: number;
let scan: Record<string, FileState['scanStatus']>;
let waveSizes: number[];
let wavesAtOnce: number;
let maxWavesAtOnce: number;
let api: UploadApi & { [K in keyof UploadApi]: ReturnType<typeof vi.fn> };
let sleeps: number[];

const settle = async () => {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
};

function newManager(): UploadManager {
  let ids = 0;
  return new UploadManager({
    api,
    transport,
    hash: async (file, multipart) => ({
      sha256: 'a'.repeat(64),
      parts: multipart ? Array.from({ length: Math.ceil(file.size / PART) }, () => 'b'.repeat(64)) : [],
    }),
    now: () => clock,
    id: () => `p${++ids}`,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    waitForSession: async () => undefined,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  transport = new FakeTransport();
  clock = 1_000_000;
  serverIds = 0;
  scan = {};
  waveSizes = [];
  wavesAtOnce = 0;
  maxWavesAtOnce = 0;
  sleeps = [];
  api = {
    requestUploads: vi.fn(async (files: UploadRequest[]): Promise<UploadGrant[]> => {
      waveSizes.push(files.length);
      wavesAtOnce += 1;
      maxWavesAtOnce = Math.max(maxWavesAtOnce, wavesAtOnce);
      await Promise.resolve();
      wavesAtOnce -= 1;
      return files.map((f) => {
        const fileId = `s${++serverIds}`;
        return f.sizeBytes > 100 * MIB
          ? { fileId, multipart: true as const, partSize: PART, partCount: Math.ceil(f.sizeBytes / PART) }
          : { fileId, post: { url: `http://s3/post/${fileId}`, fields: { key: fileId } } };
      });
    }),
    startMultipart: vi.fn(async (_id: string, parts: { partNumber: number }[]) => ({
      uploadId: 'upload-1',
      parts: parts.map((p) => ({ partNumber: p.partNumber, url: `http://s3/part/${p.partNumber}/v1` })),
      abortUrl: 'http://s3/abort',
    })),
    resignParts: vi.fn(async (_id: string, _upload: string, parts: { partNumber: number }[]) =>
      parts.map((p) => ({ partNumber: p.partNumber, url: `http://s3/part/${p.partNumber}/v2` })),
    ),
    completeMultipart: vi.fn(async () => undefined),
    fileStates: vi.fn(async (ids: string[]) => ids.map((fileId) => ({ fileId, uploaded: true, scanStatus: scan[fileId] ?? 'clean' }))),
  };
});

afterEach(() => vi.useRealTimers());

describe('links and concurrency', () => {
  it('asks for links in waves of at most 20, one wave at a time, and runs at most 4 uploads at once', async () => {
    transport.hold = true;
    const manager = newManager();
    manager.add(Array.from({ length: 45 }, (_, i) => pdf(`f${i}.pdf`)));
    await settle();
    for (let guard = 0; guard < 100 && manager.isRunning(); guard += 1) {
      transport.releaseAll();
      await settle();
    }
    expect(manager.getSnapshot().every((f) => f.status === 'checking')).toBe(true);
    expect(waveSizes.reduce((a, b) => a + b, 0)).toBe(45);
    expect(Math.max(...waveSizes)).toBeLessThanOrEqual(20);
    expect(waveSizes.length).toBeGreaterThanOrEqual(3);
    expect(maxWavesAtOnce).toBe(1);
    expect(transport.max).toBe(4);
    manager.dispose();
  });

  it('is running while a file uploads and stops being running once it is only being checked', async () => {
    transport.hold = true;
    const manager = newManager();
    manager.add([pdf('a.pdf')]);
    await settle();
    expect(manager.isRunning()).toBe(true);
    transport.releaseAll();
    await settle();
    expect(snap(manager, 0).status).toBe('checking');
    expect(manager.isRunning()).toBe(false);
    manager.dispose();
  });
});

describe('checking', () => {
  it('polls every 2 seconds only while a file is being checked, then shows Verified', async () => {
    const manager = newManager();
    manager.add([pdf('a.pdf')]);
    await settle();
    expect(api.fileStates).not.toHaveBeenCalled();
    expect(snap(manager, 0).status).toBe('checking');

    scan.s1 = 'pending';
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(api.fileStates).toHaveBeenCalledTimes(1);
    expect(snap(manager, 0).status).toBe('checking');

    scan.s1 = 'clean';
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(api.fileStates).toHaveBeenCalledTimes(2);
    expect(snap(manager, 0).status).toBe('verified');

    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.fileStates).toHaveBeenCalledTimes(2);
    manager.dispose();
  });

  it('marks a file infected, and one that could not be checked', async () => {
    const manager = newManager();
    manager.add([pdf('virus.pdf'), pdf('odd.pdf')]);
    await settle();
    scan.s1 = 'infected';
    scan.s2 = 'failed';
    await vi.advanceTimersByTimeAsync(POLL_MS);
    const a = snap(manager, 0);
    const b = snap(manager, 1);
    expect(a.status).toBe('infected');
    expect(a.message).toContain('Malware');
    expect(b.status).toBe('unchecked');
    manager.dispose();
  });
});

describe('storage answers', () => {
  it('treats a 400 as refused by storage, with a message, and Retry asks for a fresh link', async () => {
    transport.answer = () => ({ status: 400, body: '<Error><Code>BadDigest</Code></Error>' });
    const manager = newManager();
    manager.add([pdf('a.pdf')]);
    await settle();
    const refused = snap(manager, 0);
    expect(refused.status).toBe('refused');
    expect(refused.message).toContain('did not match what was checked');

    transport.answer = () => ({ status: 204, body: '' });
    manager.retry(refused.id);
    await settle();
    expect(snap(manager, 0).status).toBe('checking');
    expect(api.requestUploads).toHaveBeenCalledTimes(2);
    expect(snap(manager, 0).serverId).toBe('s2');
    manager.dispose();
  });

  it('treats a 403 that is not an expiry the same way', async () => {
    transport.answer = () => ({ status: 403, body: '<Error><Code>AccessDenied</Code><Message>Invalid according to Policy</Message></Error>' });
    const manager = newManager();
    manager.add([pdf('a.pdf')]);
    await settle();
    expect(snap(manager, 0).status).toBe('refused');
    expect(transport.posts).toHaveLength(1);
    manager.dispose();
  });

  it('gets one fresh link when the link has expired, then uploads', async () => {
    let calls = 0;
    transport.answer = () => (++calls === 1 ? { status: 403, body: '<Error><Message>Request has expired</Message></Error>' } : { status: 204, body: '' });
    const manager = newManager();
    manager.add([pdf('a.pdf')]);
    await settle();
    expect(snap(manager, 0).status).toBe('checking');
    expect(transport.posts.map((p) => p.url)).toEqual(['http://s3/post/s1', 'http://s3/post/s2']);
    manager.dispose();
  });

  it('asks for a fresh link when the one it holds is 13 minutes old at the start', async () => {
    transport.hold = true;
    const manager = newManager();
    manager.add(Array.from({ length: 6 }, (_, i) => pdf(`f${i}.pdf`)));
    await settle();
    // Four are uploading; two wait with links that are about to go stale.
    clock += LINK_FRESH_MS + 1;
    transport.releaseAll();
    await settle();
    transport.releaseAll();
    await settle();
    expect(manager.getSnapshot().every((f) => f.status === 'checking')).toBe(true);
    expect(api.requestUploads.mock.calls.length).toBeGreaterThan(1);
    // The two that waited were linked again: their upload went to ids issued after the six first links.
    expect(transport.posts.filter((p) => Number(p.url.split('/post/s')[1]) > 6)).toHaveLength(2);
    manager.dispose();
  });

  it('retries a broken connection with growing gaps, then stops as interrupted', async () => {
    transport.answer = () => new TransportError('down');
    const manager = newManager();
    manager.add([pdf('a.pdf')]);
    await settle();
    expect(transport.posts).toHaveLength(4);
    expect(sleeps).toEqual([2000, 4000, 8000]);
    expect(snap(manager, 0).status).toBe('interrupted');
    manager.dispose();
  });

  it('waits behind the sign-in dialog when the session has ended, then carries on', async () => {
    const waited = vi.fn(async () => undefined);
    let first = true;
    api.requestUploads.mockImplementation(async (files: UploadRequest[]) => {
      if (first) {
        first = false;
        throw new ApiFailure(401, 'Your sign-in has ended.');
      }
      return files.map(() => ({ fileId: 's1', post: { url: 'http://s3/post/s1', fields: {} } }));
    });
    let n = 0;
    const manager = new UploadManager({
      api,
      transport,
      hash: async () => ({ sha256: 'a'.repeat(64), parts: [] }),
      id: () => `p${++n}`,
      waitForSession: waited,
    });
    manager.add([pdf('a.pdf')]);
    await settle();
    expect(waited).toHaveBeenCalledTimes(1);
    expect(snap(manager, 0).status).toBe('checking');
    manager.dispose();
  });
});

describe('multipart', () => {
  const big = () => pdf('big.pdf', 7 * PART);

  it('starts with every part hash, sends each part with its checksum, and completes with the ETags in order', async () => {
    const manager = newManager();
    manager.add([big()]);
    await settle();
    expect(snap(manager, 0).status).toBe('checking');
    expect(api.startMultipart).toHaveBeenCalledTimes(1);
    expect(callArg(api.startMultipart, 0, 1)).toHaveLength(7);
    expect(transport.puts).toHaveLength(7);
    expect(need(transport.puts[0]).sha256Base64).toBe(Buffer.from('b'.repeat(64), 'hex').toString('base64'));
    const parts = callArg(api.completeMultipart, 0, 2);
    expect((parts as { partNumber: number }[]).map((p) => p.partNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    manager.dispose();
  });

  it('re-signs the parts it has not started once the links are 13 minutes old', async () => {
    transport.hold = true;
    const manager = newManager();
    manager.add([big()]);
    await settle();
    transport.releaseAll(); // part 1 done
    await settle();
    clock += LINK_FRESH_MS + 1;
    transport.releaseAll(); // part 2 done, part 3 about to start with stale links
    await settle();
    expect(api.resignParts).toHaveBeenCalledTimes(1);
    expect((callArg(api.resignParts, 0, 2) as { partNumber: number }[]).map((p) => p.partNumber)).toEqual([3, 4, 5, 6, 7]);
    expect(need(transport.puts[2]).url).toBe('http://s3/part/3/v2');
    for (let i = 0; i < 10; i += 1) {
      transport.releaseAll();
      await settle();
    }
    expect(snap(manager, 0).status).toBe('checking');
    manager.dispose();
  });

  it('resumes from the missing parts after the connection broke', async () => {
    let part = 0;
    let broken = true;
    transport.answer = (kind, n) => {
      if (kind !== 'put') return { status: 204, body: '' };
      part += 1;
      // Parts 1 and 2 store; then everything fails until the connection is back.
      if (part > 2 && broken) return new TransportError('down');
      return { status: 200, body: '', etag: `"etag-${n}"` };
    };
    const manager = newManager();
    manager.add([big()]);
    await settle();
    const file = snap(manager, 0);
    expect(file.status).toBe('interrupted');
    expect(file.partsDone).toBe(2);
    const putsBefore = transport.puts.length;

    broken = false;
    manager.retry(file.id);
    await settle();
    expect(snap(manager, 0).status).toBe('checking');
    expect(api.startMultipart).toHaveBeenCalledTimes(1);
    // Only parts 3 to 7 went again: no part was stored twice.
    expect(transport.puts.length - putsBefore).toBe(5);
    expect(transport.puts.slice(putsBefore).map((p) => p.url.split('/')[4])).toEqual(['3', '4', '5', '6', '7']);
    manager.dispose();
  });

  it('refuses the file and aborts the upload when storage rejects a part', async () => {
    transport.answer = (kind) => (kind === 'put' ? { status: 400, body: '<Code>BadDigest</Code>' } : { status: 204, body: '' });
    const manager = newManager();
    manager.add([big()]);
    await settle();
    expect(snap(manager, 0).status).toBe('refused');
    expect(transport.aborted).toEqual(['http://s3/abort']);
    manager.dispose();
  });
});

describe('restore after a reload (D-F1-66)', () => {
  const entry = (id: string, serverId: string, stored = true) => ({ id, serverId, name: `${id}.pdf`, sizeBytes: 10, contentType: 'application/pdf', sha256: 'a'.repeat(64), stored });

  it('brings back files that are stored and clean as Ready, and ones still being scanned as Checking, with the same page ids', async () => {
    scan = { s2: 'pending' };
    const manager = newManager();
    const out = await manager.restore([entry('p1', 's1'), entry('p2', 's2')]);
    expect(out).toEqual({ restored: ['p1', 'p2'], dropped: 0 });
    expect(manager.getSnapshot().map((f) => [f.id, f.status, f.restored, f.serverId])).toEqual([
      ['p1', 'verified', true, 's1'],
      ['p2', 'checking', true, 's2'],
    ]);
    // The scan is followed again, and the file comes back Ready when it is clean.
    scan = { s2: 'clean' };
    await vi.advanceTimersByTimeAsync(POLL_MS + 1);
    expect(snap(manager, 1).status).toBe('verified');
    manager.dispose();
  });

  it('drops a file that is refused, failed its check, is gone from the server, or was still uploading, and counts it', async () => {
    scan = { s1: 'infected', s2: 'failed' };
    api.fileStates.mockImplementation(async (ids: string[]) =>
      ids.filter((id) => id !== 's3').map((fileId) => ({ fileId, uploaded: fileId !== 's4', scanStatus: scan[fileId] ?? 'clean' })),
    );
    const manager = newManager();
    const out = await manager.restore([entry('p1', 's1'), entry('p2', 's2'), entry('p3', 's3'), entry('p4', 's4'), entry('p5', 's5'), entry('p6', 's6', false)]);
    expect(out).toEqual({ restored: ['p5'], dropped: 5 });
    expect(manager.getSnapshot().map((f) => f.id)).toEqual(['p5']);
    expect(api.fileStates).toHaveBeenCalledTimes(1);
    expect(api.fileStates.mock.calls[0]?.[0]).toEqual(['s1', 's2', 's3', 's4', 's5']); // the one that was mid-upload is not asked about
    manager.dispose();
  });

  it('brings back nothing when the server cannot be asked', async () => {
    api.fileStates.mockRejectedValue(new Error('down'));
    const manager = newManager();
    expect(await manager.restore([entry('p1', 's1'), entry('p2', 's2')])).toEqual({ restored: [], dropped: 2, unreachable: true });
    expect(manager.getSnapshot()).toEqual([]);
    manager.dispose();
  });

  it('a second restore of the same batch (an effect that runs twice) adds nothing and drops nothing', async () => {
    const manager = newManager();
    const batch = [entry('p1', 's1'), entry('p2', 's2')];
    const [a, b] = await Promise.all([manager.restore(batch), manager.restore(batch)]);
    expect(manager.getSnapshot().map((f) => f.id)).toEqual(['p1', 'p2']);
    expect(a.dropped + b.dropped).toBe(0);
    expect(b.restored).toEqual(['p1', 'p2']);
    manager.dispose();
  });

  it('a restored file can be removed like any other', async () => {
    const manager = newManager();
    await manager.restore([entry('p1', 's1')]);
    manager.remove('p1');
    expect(manager.getSnapshot()).toEqual([]);
    manager.dispose();
  });
});

describe('remove', () => {
  it('stops a running upload and aborts a multipart one', async () => {
    transport.hold = true;
    const manager = newManager();
    manager.add([pdf('a.pdf'), pdf('big.pdf', 7 * PART)]);
    await settle();
    const big = snap(manager, 1);
    expect(big.status).toBe('uploading');
    manager.remove(big.id);
    await settle();
    expect(transport.aborted).toEqual(['http://s3/abort']);
    expect(manager.getSnapshot().map((f) => f.name)).toEqual(['a.pdf']);
    expect(transport.active).toBe(1);
    manager.dispose();
  });
});
