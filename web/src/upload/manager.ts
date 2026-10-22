import { FILE_REASON, hexToBase64, isMultipart, LIMITS, partCount, sameContentsAs } from '@docbeam/shared/browser';
import { ApiFailure } from '../auth/errors.js';
import type { Accepted } from '../distribute/files.js';
import type { UploadApi, UploadGrant } from './api-types.js';
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
  | 'unchecked';

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
  /** Brought back after a reload (D-F1-66): it is on the server, and this page holds no copy of its bytes (so no local preview). */
  restored?: boolean;
  /** The file's last-modified time on the person's disk, which with the name and size says "the same file again" (D-F1-81). */
  lastModified?: number;
  /** When the file's row was made on the server (ms): the 24 hours of POST /jobs count from here. Set when the link is issued. */
  uploadedAt?: number;
}

/** A file the page took out of the list by itself, and why: the "not added" note says it (D-F1-78, D-F1-81). */
export interface DroppedFile {
  id: string;
  name: string;
  reason: string;
}

/** A file of a batch kept across a reload: what `restore` needs to look it up again. */
export interface RestoreEntry {
  id: string;
  serverId?: string | undefined;
  name: string;
  sizeBytes: number;
  contentType: string;
  sha256?: string | undefined;
  lastModified?: number | undefined;
  stored: boolean;
}

export type Hasher = (file: Blob, multipart: boolean, onProgress: (fraction: number) => void) => Promise<HashResult>;

export interface ManagerDeps {
  api: UploadApi;
  transport: Transport;
  hash: Hasher;
  /**
   * Waits for the session after a 401 that a refresh could not fix (the sign-in dialog is open). Without it a 401
   * is an ordinary failure.
   */
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
 * The browser's online state and events, when there is a browser. The queue also runs in Node (the integration test), where there is
 * no window and `navigator.onLine` does not exist, so nothing here assumes them.
 */
const host = globalThis as unknown as {
  addEventListener?: (type: string, listener: () => void, options?: { once?: boolean }) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
  navigator?: { onLine?: boolean };
};
const isOffline = (): boolean => host.navigator?.onLine === false;

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
    this.api = deps.api;
    this.transport = deps.transport;
    this.hash = deps.hash;
    this.waitForSession = deps.waitForSession;
    this.now = deps.now ?? (() => Date.now());
    this.newId = deps.id ?? (() => crypto.randomUUID());
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    host.addEventListener?.('online', this.onOnline);
  }

  /** The browser is back online: files that were interrupted while it was away start again, from the parts already stored (D-F1-81). */
  private readonly onOnline = (): void => {
    for (const f of [...this.files]) if (f.status === 'interrupted') this.retry(f.id);
    if (this.files.some((f) => f.status === 'checking')) this.startPolling();
  };

  /** Resolves at once when the browser is online, or when it comes back: a spell offline does not use up a file's retries. */
  private whenOnline(): Promise<void> {
    if (!isOffline() || !host.addEventListener) return Promise.resolve();
    return new Promise((resolve) => host.addEventListener?.('online', () => resolve(), { once: true }));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): readonly PageFile[] => this.files;

  private readonly droppedListeners = new Set<(file: DroppedFile) => void>();

  /**
   * Told when the manager takes a file out of the list by itself: malware found by the scan (the server deleted the stored
   * object), the same contents as another file, or more than 24 hours since the upload. The file has already left the list, so
   * the page only has to forget its folder ticks and say why (D-F1-78, D-F1-81).
   */
  onDropped = (listener: (file: DroppedFile) => void): (() => void) => {
    this.droppedListeners.add(listener);
    return () => this.droppedListeners.delete(listener);
  };

  private drop(file: PageFile, reason: string): void {
    this.remove(file.id);
    for (const l of this.droppedListeners) l({ id: file.id, name: file.name, reason });
  }

  /**
   * Takes out every file that was uploaded more than 24 hours ago, with its note. The page calls it when it opens and about once
   * a minute. A file with no upload yet (still being read or waiting for a link) has no age.
   */
  expire(): void {
    const now = this.now();
    for (const f of [...this.files]) {
      if (f.uploadedAt !== undefined && now - f.uploadedAt > LIMITS.maxFileAgeMs) this.drop(f, FILE_REASON.TOO_OLD);
    }
  }

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
      lastModified: file.lastModified,
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

  /**
   * Puts back the files of a batch kept across a reload (D-F1-66). Each one is looked up with the same route the page polls
   * while a file is being checked: one that is stored and clean comes back Ready, one stored and still being scanned comes
   * back Checking, and one that is gone, refused, failed its check or was still uploading is dropped. Returns the page ids
   * that came back and how many were dropped. The page keeps the same ids, so the folder ticks still point at the files.
   */
  async restore(entries: readonly RestoreEntry[]): Promise<{ restored: string[]; dropped: number; removed: DroppedFile[]; unreachable?: true }> {
    const candidates = entries.filter((e) => e.stored && e.serverId !== undefined);
    const states = new Map<string, { uploaded: boolean; scanStatus: string; createdAt?: string | undefined }>();
    try {
      for (let i = 0; i < candidates.length; i += LIMITS.maxFileIdsPerQuery) {
        const chunk = candidates.slice(i, i + LIMITS.maxFileIdsPerQuery);
        for (const s of await this.call(() => this.api.fileStates(chunk.map((e) => e.serverId as string)))) states.set(s.fileId, s);
      }
    } catch {
      // The server could not be asked: nothing can be shown as ready that was not checked. The page keeps the stored batch for
      // the next reload instead of treating the files as lost (`unreachable`).
      return { restored: [], dropped: entries.length, removed: [], unreachable: true };
    }
    // A second call for the same batch (React runs an effect twice in development) finds the first one's files already here: they
    // are not added again, and they count as restored.
    const here = new Set(this.files.map((f) => f.id));
    const already = candidates.filter((e) => here.has(e.id)).map((e) => e.id);
    const back: PageFile[] = [];
    const removed: DroppedFile[] = [];
    const now = this.now();
    const contents = new Map<string, string>(); // sha256 -> the name of the file that holds it
    for (const f of this.files) if (f.sha256) contents.set(f.sha256, f.name);
    for (const e of candidates) {
      if (here.has(e.id)) continue;
      const s = states.get(e.serverId as string);
      if (!s || !s.uploaded || s.scanStatus === 'infected' || s.scanStatus === 'failed') continue;
      const uploadedAt = s.createdAt ? Date.parse(s.createdAt) : now;
      // The same rules as on the page (D-F1-81): a file more than 24 hours old, or with the contents of one already here, stays out.
      if (now - uploadedAt > LIMITS.maxFileAgeMs) {
        removed.push({ id: e.id, name: e.name, reason: FILE_REASON.TOO_OLD });
        continue;
      }
      const twin = e.sha256 ? contents.get(e.sha256) : undefined;
      if (twin !== undefined) {
        removed.push({ id: e.id, name: e.name, reason: sameContentsAs(twin) });
        continue;
      }
      if (e.sha256) contents.set(e.sha256, e.name);
      back.push({
        uploadedAt,
        ...(e.lastModified !== undefined ? { lastModified: e.lastModified } : {}),
        id: e.id,
        file: new File([], e.name),
        name: e.name,
        sizeBytes: e.sizeBytes,
        contentType: e.contentType,
        status: s.scanStatus === 'clean' ? 'verified' : 'checking',
        progress: 1,
        partsDone: 0,
        partCount: isMultipart(e.sizeBytes) ? partCount(e.sizeBytes) : 0,
        ...(e.sha256 ? { sha256: e.sha256 } : {}),
        serverId: e.serverId as string,
        restored: true,
      });
    }
    for (const f of back) this.internal.set(f.id, { grantedAt: 0, removed: false, requesting: false });
    this.files = [...this.files, ...back];
    this.emit();
    if (back.some((f) => f.status === 'checking')) this.startPolling();
    return { restored: [...already, ...back.map((f) => f.id)], dropped: entries.length - already.length - back.length - removed.length, removed };
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
    host.removeEventListener?.('online', this.onOnline);
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

  /** An API call. After a 401 the session has ended: wait behind the sign-in dialog and try once more. */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 401 && this.waitForSession) {
        await this.waitForSession();
        return fn();
      }
      throw error;
    }
  }

  private async prepare(id: string): Promise<void> {
    const file = this.get(id);
    if (!file) return;
    try {
      const result = await this.hash(file.file, file.partCount > 0, (fraction) => {
        if (this.internal.get(id)?.removed === false && Math.abs(fraction - (this.get(id)?.progress ?? 0)) >= 0.01) this.patch(id, { progress: fraction });
      });
      if (this.internal.get(id)?.removed !== false) return;
      // The same contents as another file in the list, whatever the name: the newer one (later in the list) is taken out before
      // it is uploaded, and the note names the other one (D-F1-81). If the newer one had already finished hashing, it goes now.
      const twin = this.files.find((f) => f.id !== id && f.sha256 === result.sha256);
      if (twin) {
        const mine = this.get(id) as PageFile;
        const mineIsNewer = this.files.indexOf(mine) > this.files.indexOf(twin);
        if (mineIsNewer) return this.drop(mine, sameContentsAs(twin.name));
        this.drop(twin, sameContentsAs(mine.name));
      }
      this.patch(id, { sha256: result.sha256, status: 'waiting', progress: 0 });
      // The parts are kept beside the file, not in the snapshot.
      this.partHashes.set(id, result.parts);
      this.pump();
    } catch {
      if (this.internal.get(id)?.removed === false) this.patch(id, { status: 'refused', message: "The file couldn't be read. Remove it and add it again." });
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
        this.patch(f.id, { serverId: grant.fileId, uploadedAt: state.grantedAt });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Couldn't get upload links.";
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
    this.patch(id, { serverId: grant.fileId, uploadedAt: state.grantedAt });
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
        if (isOffline()) {
          await this.whenOnline(); // offline: wait to be back, then the same try again
          attempt -= 1;
          continue;
        }
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
          if (isOffline()) {
            await this.whenOnline();
            attempt -= 1;
            continue;
          }
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
            this.drop(file, FILE_REASON.MALWARE); // out of the list at once; the page is told
          } else if (s.scanStatus === 'failed') {
            this.patch(file.id, { status: 'unchecked', message: FILE_REASON.SCAN_FAILED });
          }
        }
      }
    } catch {
      // A failed poll is tried again on the next tick.
    }
    if (this.files.some((f) => f.status === 'checking')) this.startPolling();
  }
}
