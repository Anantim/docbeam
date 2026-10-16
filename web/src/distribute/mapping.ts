import { LIMITS, validateBatch, type BatchResult } from '@docbeam/shared/browser';
import type { Destination } from '../destinations/selection.js';
import { destinationKey } from '../destinations/selection.js';
import type { PageFile } from '../upload/manager.js';

/** Which destinations each file goes to, keyed by the page's file id then by `destinationKey`. */
export interface Mapping {
  /** Every destination that was ticked, by key. */
  destinations: Record<string, Destination>;
  /** For each file, the keys of its destinations. */
  files: Record<string, string[]>;
}

export const emptyMapping: Mapping = { destinations: {}, files: {} };

/** A file that was refused for malware can never be sent, so it is outside every count and every mapping. */
export const isUsable = (f: Pick<PageFile, 'status'>): boolean => f.status !== 'infected';

export type TickState = 'on' | 'off' | 'mixed';

/** The files a tick applies to: the selected ones, or all usable files when none are selected. */
export function scopeOf(files: PageFile[], selected: ReadonlySet<string>): string[] {
  const usable = files.filter(isUsable).map((f) => f.id);
  const chosen = usable.filter((id) => selected.has(id));
  return chosen.length > 0 ? chosen : usable;
}

export function tickState(mapping: Mapping, scope: string[], key: string): TickState {
  if (scope.length === 0) return 'off';
  const n = scope.filter((id) => mapping.files[id]?.includes(key)).length;
  if (n === 0) return 'off';
  return n === scope.length ? 'on' : 'mixed';
}

/** The distinct destinations in use, and how many files go to each. */
export function destinationCounts(mapping: Mapping, files: PageFile[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of files.filter(isUsable)) {
    for (const key of mapping.files[f.id] ?? []) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function deliveryCount(mapping: Mapping, files: PageFile[]): number {
  return files.filter(isUsable).reduce((sum, f) => sum + (mapping.files[f.id]?.length ?? 0), 0);
}

export interface Toggled {
  mapping: Mapping;
  /** Text for a toast when a tick was refused. */
  refused?: string;
}

/**
 * Ticks or unticks a destination for the scope. Fully ticked for the scope → untick it for all of them; otherwise
 * add it to every file in the scope (a mixed tick completes). A 21st destination is refused.
 */
export function toggleDestination(mapping: Mapping, files: PageFile[], selected: ReadonlySet<string>, destination: Destination): Toggled {
  const key = destinationKey(destination);
  const scope = scopeOf(files, selected);
  if (scope.length === 0) return { mapping };
  const next: Mapping = { destinations: { ...mapping.destinations }, files: { ...mapping.files } };

  if (tickState(mapping, scope, key) === 'on') {
    for (const id of scope) next.files[id] = (next.files[id] ?? []).filter((k) => k !== key);
    return { mapping: next };
  }
  const inUse = destinationCounts(mapping, files);
  if (!inUse.has(key) && inUse.size >= LIMITS.maxDestinationsPerJob) {
    return { mapping, refused: `A distribution can have at most ${LIMITS.maxDestinationsPerJob} destinations.` };
  }
  next.destinations[key] = destination;
  for (const id of scope) {
    const keys = next.files[id] ?? [];
    if (!keys.includes(key)) next.files[id] = [...keys, key];
  }
  return { mapping: next };
}

/** The cross on a folder in Review: no file goes there any more. */
export function removeDestination(mapping: Mapping, key: string): Mapping {
  const files: Mapping['files'] = {};
  for (const [id, keys] of Object.entries(mapping.files)) files[id] = keys.filter((k) => k !== key);
  return { destinations: mapping.destinations, files };
}

export interface RemovedFromFolder {
  mapping: Mapping;
  /** True when that was the file's last folder, so it leaves the distribution. */
  dropped: boolean;
}

/** The cross on a file inside a folder in Review. */
export function removeFromDestination(mapping: Mapping, fileId: string, key: string): RemovedFromFolder {
  const left = (mapping.files[fileId] ?? []).filter((k) => k !== key);
  return { mapping: { destinations: mapping.destinations, files: { ...mapping.files, [fileId]: left } }, dropped: left.length === 0 };
}

export function removeFile(mapping: Mapping, fileId: string): Mapping {
  const files = { ...mapping.files };
  delete files[fileId];
  return { destinations: mapping.destinations, files };
}

export interface Check {
  label: string;
  ok: boolean;
}

export interface Readiness {
  checks: Check[];
  /** Send is on only when every check holds and the batch passes the limits of POST /jobs. */
  ready: boolean;
  batch: BatchResult;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function readiness(mapping: Mapping, files: PageFile[]): Readiness {
  const infected = files.filter((f) => f.status === 'infected').length;
  const usable = files.filter(isUsable);
  const allVerified = usable.length > 0 && usable.every((f) => f.status === 'verified') && infected === 0;
  const unmapped = usable.filter((f) => (mapping.files[f.id]?.length ?? 0) === 0).length;

  const batch = buildBatch(mapping, files);
  const checks: Check[] = [
    { label: files.length > 0 ? `${plural(files.length, 'file', 'files')} added` : 'Add at least one file', ok: files.length > 0 },
    {
      label: allVerified
        ? 'All uploads verified'
        : infected > 0
          ? `${plural(infected, 'file was', 'files were')} refused for malware: remove to continue`
          : 'Uploads in progress or being checked',
      ok: allVerified,
    },
    {
      label: unmapped > 0 ? `${plural(unmapped, 'file has', 'files have')} no destination` : 'Every file has a destination',
      ok: usable.length > 0 && unmapped === 0,
    },
  ];
  return { checks, ready: checks.every((c) => c.ok) && batch.request !== null && batch.result.ok, batch: batch.result };
}

function buildBatch(mapping: Mapping, files: PageFile[]): { request: JobBody | null; result: BatchResult } {
  const sendable = files.filter((f) => isUsable(f) && f.serverId && f.sha256);
  const request: JobBody = {
    files: sendable.map((f) => ({ fileId: f.serverId as string, sha256: f.sha256 as string })),
    mappings: sendable.map((f) => ({
      fileId: f.serverId as string,
      destinations: (mapping.files[f.id] ?? []).flatMap((k) => {
        const d = mapping.destinations[k];
        if (!d) return [];
        return [d.folderId ? { binderId: d.binderId, folderId: d.folderId } : { binderId: d.binderId }];
      }),
    })),
  };
  return { request, result: validateBatch(request) };
}

export interface JobBody {
  files: { fileId: string; sha256: string }[];
  mappings: { fileId: string; destinations: { binderId: string; folderId?: string }[] }[];
}

/** The body of POST /jobs, or null when the batch is not sendable. */
export function buildJobRequest(mapping: Mapping, files: PageFile[]): JobBody | null {
  const { request, result } = buildBatch(mapping, files);
  return result.ok ? request : null;
}

/** The pieces of a destination path the Review card shows: team, then the name of the binder or folder. */
export function describeDestination(path: string): { team: string; name: string } {
  const parts = path.replace(/ \(top level\)$/, '').split(' / ');
  return { team: parts[0] ?? '', name: parts[parts.length - 1] ?? '' };
}
