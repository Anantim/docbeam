import { hexToBase64, isMultipart, LIMITS, partCount } from '@docbeam/shared/browser';
import { ApiFailure } from '../auth/session.js';
import type { Accepted } from '../distribute/files.js';
import { uploadApi, withSignIn, type UploadApi, type UploadGrant } from './api.js';
import type { HashResult } from './hashing.js';
import type { Transport, TransportResult } from './transport.js';
import { TransportError } from './transport.js';

export type FileStatus =
  | 'hashing'
  | 'waiting'
  | 'uploading'
  | 'checking'
  | 'verified'
  /** Storage refused the bytes (a 400, or a 403 that is not an expired link). Retry starts again. */
  | 'refused'
  /** The connection broke. Retry carries on from the parts that are already stored. */
  | 'interrupted'
  /** The Upload Events Lambda could not check the file (size or fingerprint, or its retries ran out). */
  | 'unchecked'
  | 'infected';

export interface PageFile {
  /** The page's own id. It stays the same when a new upload link (and so a new server id) is needed. */
  id: string;
  file: File;
  name: string;
  sizeBytes: number;
  contentType: string;
  status: FileStatus;
  /** 0 to 1 for the current step (hashing, then uploading). */
  progress: number;
  /** Parts stored so far, and parts in all. Both 0 for a file that uploads in one piece. */
  partsDone: number;
  partCount: number;
  message?: string;
  sha256?: string;
  /** The file id the API knows it by, once a link has been issued. */
  serverId?: string;
}

export type Hasher = (file: Blob, multipart: boolean, onProgress: (fraction: number) => void) => Promise<HashResult>;

export interface ManagerDeps {
  api?: UploadApi;
  transport: Transport;
  hash: Hasher;
  /** Waits for the session after a 401 that a refresh could not fix. */
  waitForSession?: () => Promise<void>;
  now?: () => number;
  id?: () => string;
  sleep?: (ms: number) => Promise<void>;
}

/** Links last 15 minutes. After 13 the page asks for fresh ones before it starts a file or a part. */
export const LINK_FRESH_MS = 13 * 60 * 1000;
export const POLL_MS = 2000;
const RETRY_GAPS_MS = [2000, 4000, 8000];

const REFUSED_MESSAGE = 'Storage refused the file: it did not match what was checked. Retry, or remove it and add it again.';

class Refused extends Error {}
class Interrupted extends Error {}

interface Multipart {
  uploadId: string;
  urls: Map<number, string>;
  issuedAt: number;
  abortUrl: string;
  etags: Map<number, string>;
}

interface Internal {
  grant?: UploadGrant;
  grantedAt: number;
  multipart?: Multipart;
  controller?: AbortController;
  removed: boolean;
  /** Set while the file's link request is in flight, so it is not asked for twice. */
  requesting: boolean;
}

const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';

/**
 * The upload queue of Step 2.6: hashing in a worker, links in waves of 20, at most 4 uploads at once, multipart
 * with re-signing and resume, and a 2-second poll for files being checked. Nothing here touches React: the page
 * reads it through `subscribe` and `getSnapshot`.
 */
export class UploadManager {
  private files: PageFile[] = [];
  private readonly internal = new Map<string, Internal>();
  private readonly listeners = new Set<() => void>();
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  private readonly api: UploadApi;
  private readonly transport: Transport;
  private readonly hash: Hasher;
  private readonly waitForSession?: () => Promise<void>;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(deps: ManagerDeps) {
    this.api = deps.api ?? uploadApi;
    this.transport = deps.transport;
    this.hash = deps.hash;
    this.waitForSession = deps.waitForSession;
    this.now = deps.now ?? (() => Date.now());
    this.newId = deps.id ?? (() => crypto.randomUUID());
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): readonly PageFile[] => this.files;

  /** True while a file is being read, waiting for a slot or uploading: the page asks before it is closed. */
  isRunning(): boolean {
    return this.files.some((f) => f.status === 'hashing' || f.status === 'waiting' || f.status === 'uploading');
  }

  add(accepted: Accepted[]): void {
    const added = accepted.map(({ file, contentType }): PageFile => ({
      id: this.newId(),
      file,
      name: file.name,
      sizeBytes: file.size,
      contentType,
      status: 'hashing',
      progress: 0,
      partsDone: 0,
      partCount: isMultipart(file.size) ? partCount(file.size) : 0,
    }));
    for (const f of added) this.internal.set(f.id, { grantedAt: 0, removed: false, requesting: false });
    this.files = [...this.files, ...added];
    this.emit();
    for (const f of added) void this.prepare(f.id);
  }

  remove(id: string): void {
    const state = this.internal.get(id);
    const file = this.get(id);
    if (!state || !file) return;
    state.removed = true;
    state.controller?.abort();
    if (state.multipart && file.status !== 'checking' && file.status !== 'verified') void this.transport.abort(state.multipart.abortUrl);
    this.internal.delete(id);
    this.files = this.files.filter((f) => f.id !== id);
    this.emit();
    this.pump();
  }

  clear(): void {
    for (const f of [...this.files]) this.remove(f.id);
  }

  /** Starts a refused, interrupted or unchecked file again. An interrupted multipart file keeps its stored parts. */
  retry(id: string): void {
    const file = this.get(id);
    const state = this.internal.get(id);
    if (!file || !state) return;
    if (file.status === 'refused' || file.status === 'unchecked') {
      if (state.multipart) void this.transport.abort(state.multipart.abortUrl);
      state.multipart = undefined;
      state.grant = undefined;
      this.patch(id, { serverId: undefined, partsDone: 0, progress: 0, message: undefined });
    } else if (file.status !== 'interrupted') return;
    this.patch(id, { status: file.sha256 ? 'waiting' : 'hashing', message: undefined });
    if (!file.sha256) void this.prepare(id);
    else this.pump();
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.pollTimer);
    for (const state of this.internal.values()) state.controller?.abort();
  }

  // --- internals ---

  private get(id: string): PageFile | undefined {
    return this.files.find((f) => f.id === id);
  }

  private patch(id: string, change: Partial<PageFile>): void {
    this.files = this.files.map((f) => (f.id === id ? { ...f, ...change } : f));
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  private call<T>(fn: () => Promise<T>): Promise<T> {
    return withSignIn(fn, this.waitForSession);
  }

  private async prepare(id: string): Promise<void> {
    const file = this.get(id);
    if (!file) return;
    try {
      const result = await this.hash(file.file, file.partCount > 0, (fraction) => {
        if (this.internal.get(id)?.removed === false && Math.abs(fraction - (this.get(id)?.progress ?? 0)) >= 0.01) this.patch(id, { progress: fraction });
      });
      if (this.internal.get(id)?.removed !== false) return;
      this.patch(id, { sha256: result.sha256, status: 'waiting', progress: 0 });
      // The parts are kept beside the file, not in the snapshot.
      this.partHashes.set(id, result.parts);
      this.pump();
    } catch {
      if (this.internal.get(id)?.removed === false) this.patch(id, { status: 'refused', message: 'The file could not be read. Remove it and add it again.' });
    }
  }

  private readonly partHashes = new Map<string, string[]>();

  /** Starts uploads for files that hold a link, and asks for a wave of links when no slot has one waiting. */
  private pump(): void {
    if (this.disposed) return;
    let active = this.files.filter((f) => f.status === 'uploading').length;
    for (const f of this.files) {
      if (active >= LIMITS.parallelUploads) break;
      if (f.status === 'waiting' && this.internal.get(f.id)?.grant) {
        active += 1;
        this.patch(f.id, { status: 'uploading', message: undefined });
        void this.upload(f.id);
      }
    }
    const unlinked = this.files.filter((f) => f.status === 'waiting' && !this.internal.get(f.id)?.grant && !this.internal.get(f.id)?.requesting);
    const linked = this.files.filter((f) => f.status === 'waiting' && this.internal.get(f.id)?.grant).length;
    // One wave at a time: files hashed while it is in flight go into the next one, up to 20 together.
    if (!this.waveInFlight && active + linked < LIMITS.parallelUploads && unlinked.length > 0) {
      void this.requestWave(unlinked.slice(0, LIMITS.uploadWave));
    }
  }

  private waveInFlight = false;

  private async requestWave(wave: PageFile[]): Promise<void> {
    this.waveInFlight = true;
    for (const f of wave) {
      const state = this.internal.get(f.id);
      if (state) state.requesting = true;
    }
    try {
      const grants = await this.call(() =>
        this.api.requestUploads(wave.map((f) => ({ name: f.name, sizeBytes: f.sizeBytes, contentType: f.contentType, sha256: f.sha256 as string }))),
      );
      wave.forEach((f, i) => {
        const state = this.internal.get(f.id);
        const grant = grants[i];
        if (!state || state.removed) return;
        state.requesting = false;
        if (!grant) {
          this.patch(f.id, { status: 'interrupted', message: 'The server sent no upload link. Retry.' });
          return;
        }
        state.grant = grant;
        state.grantedAt = this.now();
        this.patch(f.id, { serverId: grant.fileId });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not get upload links.';
      for (const f of wave) {
        const state = this.internal.get(f.id);
        if (!state || state.removed) continue;
        state.requesting = false;
        this.patch(f.id, { status: 'interrupted', message: `${message} Retry.` });
      }
    }
    this.waveInFlight = false;
    this.pump();
  }

  private async relink(id: string): Promise<void> {
    const file = this.get(id);
    const state = this.internal.get(id);
    if (!file || !state) throw new DOMException('Upload cancelled', 'AbortError');
    const [grant] = await this.call(() =>
      this.api.requestUploads([{ name: file.name, sizeBytes: file.sizeBytes, contentType: file.contentType, sha256: file.sha256 as string }]),
    );
    if (!grant) throw new Interrupted('The server sent no upload link.');
    state.grant = grant;
    state.grantedAt = this.now();
    this.patch(id, { serverId: grant.fileId });
  }

  private async upload(id: string): Promise<void> {
    const state = this.internal.get(id);
    if (!state) return;
    state.controller = new AbortController();
    try {
      if (state.grant && 'multipart' in state.grant) await this.uploadMultipart(id, state);
      else await this.uploadSingle(id, state);
      if (state.removed) return;
      this.patch(id, { status: 'checking', progress: 1 });
      this.startPolling();
    } catch (error) {
      if (state.removed || isAbort(error)) return;
      if (error instanceof Refused) {
        if (state.multipart) void this.transport.abort(state.multipart.abortUrl);
        state.multipart = undefined;
        this.patch(id, { status: 'refused', message: REFUSED_MESSAGE });
      } else {
        const message = error instanceof Interrupted || error instanceof ApiFailure ? error.message : 'The upload was interrupted.';
        this.patch(id, { status: 'interrupted', message: `${message} Retry.` });
      }
    } finally {
      this.pump();
    }
  }

  private async uploadSingle(id: string, state: Internal): Promise<void> {
    const file = this.get(id) as PageFile;
    let relinked = false;
    if (this.now() - state.grantedAt >= LINK_FRESH_MS) {
      await this.relink(id);
      relinked = true;
    }
    for (let attempt = 0; ; attempt += 1) {
      const grant = state.grant;
      if (!grant || 'multipart' in grant) throw new Interrupted('The upload link is missing.');
      let result: TransportResult;
      try {
        result = await this.transport.post({
          url: grant.post.url,
          fields: grant.post.fields,
          file: file.file,
          onProgress: (fraction) => this.progress(id, fraction, 0),
          signal: (state.controller as AbortController).signal,
        });
      } catch (error) {
        if (isAbort(error)) throw error;
        if (attempt < RETRY_GAPS_MS.length) {
          await this.sleep(RETRY_GAPS_MS[attempt] ?? 0);
          continue;
        }
        throw new Interrupted(error instanceof TransportError ? error.message : 'The upload was interrupted.');
      }
      if (result.status >= 200 && result.status < 300) return;
      if (result.status === 403 && /expired/i.test(result.body) && !relinked) {
        await this.relink(id);
        relinked = true;
        continue;
      }
      if (result.status === 400 || result.status === 403) throw new Refused();
      if (result.status >= 500 && attempt < RETRY_GAPS_MS.length) {
        await this.sleep(RETRY_GAPS_MS[attempt] ?? 0);
        continue;
      }
      throw new Interrupted(`Storage answered ${result.status}.`);
    }
  }

  private async uploadMultipart(id: string, state: Internal): Promise<void> {
    const file = this.get(id) as PageFile;
    const grant = state.grant as Extract<UploadGrant, { multipart: true }>;
    const hashes = this.partHashes.get(id) ?? [];
    const count = grant.partCount;
    const bodyOf = (n: number): Blob => file.file.slice((n - 1) * grant.partSize, n * grant.partSize);
    const hashOf = (n: number): string => {
      const hash = hashes[n - 1];
      if (!hash) throw new Interrupted('The file fingerprint is missing.');
      return hash;
    };
    const partList = (numbers: number[]) => numbers.map((n) => ({ partNumber: n, sha256: hashOf(n) }));
    const serverId = file.serverId as string;

    if (!state.multipart) {
      const started = await this.call(() => this.api.startMultipart(serverId, partList(Array.from({ length: count }, (_, i) => i + 1))));
      state.multipart = {
        uploadId: started.uploadId,
        urls: new Map(started.parts.map((p) => [p.partNumber, p.url])),
        issuedAt: this.now(),
        abortUrl: started.abortUrl,
        etags: new Map(),
      };
    }
    const mp = state.multipart;
    this.patch(id, { partsDone: mp.etags.size });

    const resign = async (from: number): Promise<void> => {
      const todo = Array.from({ length: count - from + 1 }, (_, i) => from + i).filter((n) => !mp.etags.has(n));
      const links = await this.call(() => this.api.resignParts(serverId, mp.uploadId, partList(todo)));
      for (const p of links) mp.urls.set(p.partNumber, p.url);
      mp.issuedAt = this.now();
    };

    for (let n = 1; n <= count; n += 1) {
      if (mp.etags.has(n)) continue;
      if (this.now() - mp.issuedAt >= LINK_FRESH_MS) await resign(n);
      let resigned = false;
      for (let attempt = 0; ; attempt += 1) {
        let result: TransportResult;
        try {
          result = await this.transport.put({
            url: mp.urls.get(n) as string,
            body: bodyOf(n),
            sha256Base64: hexToBase64(hashOf(n)),
            onProgress: (fraction) => this.progress(id, (mp.etags.size + fraction) / count, mp.etags.size),
            signal: (state.controller as AbortController).signal,
          });
        } catch (error) {
          if (isAbort(error)) throw error;
          if (attempt < RETRY_GAPS_MS.length) {
            await this.sleep(RETRY_GAPS_MS[attempt] ?? 0);
            continue;
          }
          throw new Interrupted('The upload was interrupted.');
        }
        if (result.status >= 200 && result.status < 300 && result.etag) {
          mp.etags.set(n, result.etag);
          this.progress(id, mp.etags.size / count, mp.etags.size);
          break;
        }
        if (result.status === 403 && /expired/i.test(result.body) && !resigned) {
          await resign(n);
          resigned = true;
          continue;
        }
        if (result.status === 400 || result.status === 403) throw new Refused();
        if (attempt < RETRY_GAPS_MS.length) {
          await this.sleep(RETRY_GAPS_MS[attempt] ?? 0);
          continue;
        }
        throw new Interrupted(`Storage answered ${result.status}.`);
      }
    }

    const parts = [...mp.etags].map(([partNumber, etag]) => ({ partNumber, etag })).sort((a, b) => a.partNumber - b.partNumber);
    try {
      await this.call(() => this.api.completeMultipart(serverId, mp.uploadId, parts));
    } catch (error) {
      // S3 does not hold what the page thinks it does: store every part again.
      if (error instanceof ApiFailure && error.code === 'MULTIPART_INCOMPLETE') mp.etags.clear();
      throw error;
    }
  }

  private progress(id: string, fraction: number, partsDone: number): void {
    const file = this.get(id);
    if (!file) return;
    if (Math.abs(fraction - file.progress) < 0.01 && partsDone === file.partsDone && fraction < 1) return;
    this.patch(id, { progress: fraction, partsDone });
  }

  // --- checking ---

  private startPolling(): void {
    if (this.pollTimer !== undefined || this.disposed) return;
    this.pollTimer = setTimeout(() => void this.poll(), POLL_MS);
  }

  private async poll(): Promise<void> {
    this.pollTimer = undefined;
    const waiting = this.files.filter((f) => f.status === 'checking' && f.serverId);
    if (waiting.length === 0) return;
    try {
      for (let i = 0; i < waiting.length; i += LIMITS.maxFileIdsPerQuery) {
        const chunk = waiting.slice(i, i + LIMITS.maxFileIdsPerQuery);
        const states = await this.call(() => this.api.fileStates(chunk.map((f) => f.serverId as string)));
        for (const s of states) {
          const file = chunk.find((f) => f.serverId === s.fileId);
          if (!file || this.get(file.id)?.status !== 'checking') continue;
          if (s.scanStatus === 'clean' && s.uploaded) this.patch(file.id, { status: 'verified' });
          else if (s.scanStatus === 'infected') {
            this.patch(file.id, { status: 'infected', message: 'Malware was found. The file was deleted and cannot be sent.' });
          } else if (s.scanStatus === 'failed') {
            this.patch(file.id, { status: 'unchecked', message: 'The file could not be checked. Retry to upload it again.' });
          }
        }
      }
    } catch {
      // A failed poll is tried again on the next tick.
    }
    if (this.files.some((f) => f.status === 'checking')) this.startPolling();
  }
}
