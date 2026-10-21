import type { PageFile } from '../upload/manager.js';
import type { Mapping } from './mapping.js';

// The batch on the Distribute screen survives a reload (D-F1-66): what is needed to find the files again on the server and to
// put the folder ticks back. It lives in sessionStorage, so it belongs to this tab and goes when the tab closes. Only a
// file that is on the server (its upload finished) can come back: the browser cannot read a file from disk again by itself.

const KEY = 'docbeam.batch.v1';

export interface StoredFile {
  /** The page's id for the file: the folder ticks are keyed by it. */
  id: string;
  serverId?: string;
  name: string;
  sizeBytes: number;
  /** The type found in the file's contents. */
  contentType: string;
  sha256?: string;
  /** The upload had finished (stored, being scanned or clean). Anything else was mid-upload and cannot be restored. */
  stored: boolean;
}

export interface StoredBatch {
  files: StoredFile[];
  mapping: Mapping;
}

const isStored = (f: PageFile): boolean => f.serverId !== undefined && (f.status === 'checking' || f.status === 'verified');

/** Writes the batch, or removes it when there is nothing on the page (after Send, Clear or Remove of the last file). */
export function saveBatch(files: readonly PageFile[], mapping: Mapping): void {
  try {
    const usable = files.filter((f) => f.status !== 'infected');
    if (usable.length === 0 && mapping.held.length === 0) {
      sessionStorage.removeItem(KEY);
      return;
    }
    const ids = new Set(usable.map((f) => f.id));
    const kept: Mapping = {
      destinations: mapping.destinations,
      files: Object.fromEntries(Object.entries(mapping.files).filter(([id]) => ids.has(id))),
      held: mapping.held,
    };
    const stored: StoredFile[] = usable.map((f) => ({
      id: f.id,
      ...(f.serverId ? { serverId: f.serverId } : {}),
      name: f.name,
      sizeBytes: f.sizeBytes,
      contentType: f.contentType,
      ...(f.sha256 ? { sha256: f.sha256 } : {}),
      stored: isStored(f),
    }));
    sessionStorage.setItem(KEY, JSON.stringify({ files: stored, mapping: kept } satisfies StoredBatch));
  } catch {
    // Storage can be full or blocked (a private window): the page works the same, it just cannot come back after a reload.
  }
}

export function loadBatch(): StoredBatch | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const batch = JSON.parse(raw) as StoredBatch;
    if (!Array.isArray(batch.files) || typeof batch.mapping !== 'object' || batch.mapping === null || !Array.isArray(batch.mapping.held)) return null;
    return batch;
  } catch {
    return null;
  }
}

export function clearBatch(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
