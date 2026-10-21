import { validateBatch, type BatchResult } from '@docbeam/shared/browser';
import type { Destination } from '../destinations/selection.js';
import { destinationKey } from '../destinations/selection.js';
import { plural } from '../text.js';
import type { PageFile } from '../upload/manager.js';

/** Which destinations each file goes to, keyed by the page's file id then by `destinationKey`. */
export interface Mapping {
  /** Every destination that was ticked, by key. */
  destinations: Record<string, Destination>;
  /** For each file, the keys of its destinations. */
  files: Record<string, string[]>;
  /** Folders ticked for all files (nothing selected). Every file added while they stay ticked goes to them (`applyHeld`, D-F1-5). */
  held: string[];
}

export const emptyMapping: Mapping = { destinations: {}, files: {}, held: [] };

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
  if (scope.length === 0) return mapping.held.includes(key) ? 'on' : 'off';
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

/** The keys of every folder the user ticked: those files go to, and those held for files not added yet. */
export function chosenKeys(mapping: Mapping, files: PageFile[]): string[] {
  return [...new Set([...destinationCounts(mapping, files).keys(), ...mapping.held])];
}

export interface Summary {
  files: number;
  folders: number;
  deliveries: number;
  /** The distinct teams of those folders. */
  teams: number;
}

/** What the batch is, in numbers, for the bar and the question before Send. Only files that have a folder count. */
export function summarise(mapping: Mapping, files: PageFile[]): Summary {
  const counts = destinationCounts(mapping, files);
  const teams = new Set([...counts.keys()].map((k) => describeDestination(mapping.destinations[k]?.path ?? '').team));
  const mapped = files.filter(isUsable).filter((f) => (mapping.files[f.id]?.length ?? 0) > 0).length;
  return { files: mapped, folders: counts.size, deliveries: deliveryCount(mapping, files), teams: teams.size };
}

export function deliveryCount(mapping: Mapping, files: PageFile[]): number {
  return files.filter(isUsable).reduce((sum, f) => sum + (mapping.files[f.id]?.length ?? 0), 0);
}

/**
 * Ticks or unticks a destination for the scope. Fully ticked for the scope → untick it for all of them; otherwise
 * add it to every file in the scope (a mixed tick completes). With no file on the page the folder is held for the
 * files added next. Nothing is refused here: the limits are checked at Send (`readiness`, D-F1-4).
 */
export function toggleDestination(mapping: Mapping, files: PageFile[], selected: ReadonlySet<string>, destination: Destination): Mapping {
  const key = destinationKey(destination);
  const scope = scopeOf(files, selected);
  if (scope.length === 0) {
    if (mapping.held.includes(key)) return { ...mapping, held: mapping.held.filter((k) => k !== key) };
    return { ...mapping, destinations: { ...mapping.destinations, [key]: destination }, held: [...mapping.held, key] };
  }
  // With nothing selected the tick is for all files, now and later: it also joins or leaves the held list.
  const forAll = !files.some((f) => isUsable(f) && selected.has(f.id));
  const next: Mapping = { ...mapping, destinations: { ...mapping.destinations }, files: { ...mapping.files } };
  if (tickState(mapping, scope, key) === 'on') {
    for (const id of scope) next.files[id] = (next.files[id] ?? []).filter((k) => k !== key);
    if (forAll) next.held = mapping.held.filter((k) => k !== key);
    return next;
  }
  if (forAll && !mapping.held.includes(key)) next.held = [...mapping.held, key];
  next.destinations[key] = destination;
  for (const id of scope) {
    const keys = next.files[id] ?? [];
    if (!keys.includes(key)) next.files[id] = [...keys, key];
  }
  return next;
}

/**
 * Sends the held folders to every file that arrived after they were ticked (the ones with no destination yet). The
 * folders stay held, so the next file gets them too, until they are unticked or the page is cleared. The same
 * mapping comes back when there is nothing to do, so it is safe to call after every change.
 */
export function applyHeld(mapping: Mapping, files: PageFile[]): Mapping {
  if (mapping.held.length === 0) return mapping;
  const fresh = files.filter(isUsable).filter((f) => mapping.files[f.id] === undefined);
  if (fresh.length === 0) return mapping;
  const next: Mapping = { destinations: mapping.destinations, files: { ...mapping.files }, held: mapping.held };
  for (const f of fresh) next.files[f.id] = [...mapping.held];
  return next;
}

export function removeFile(mapping: Mapping, fileId: string): Mapping {
  const files = { ...mapping.files };
  delete files[fileId];
  return { ...mapping, files };
}

export interface Readiness {
  /** Send is on only when every file is verified and mapped and the batch passes the limits of POST /jobs. */
  ready: boolean;
  /** Why Send is off, in a few words, or null when it is on. Shown next to the button (D-F1-4). */
  reason: string | null;
  batch: BatchResult;
}


/** The one place the batch is checked: at Send. The first problem found is the reason. */
export function readiness(mapping: Mapping, files: PageFile[]): Readiness {
  const infected = files.filter((f) => f.status === 'infected').length;
  const usable = files.filter(isUsable);
  const failed = usable.filter((f) => f.status === 'refused' || f.status === 'interrupted' || f.status === 'unchecked').length;
  const waiting = usable.filter((f) => f.status !== 'verified').length - failed;
  const unmapped = usable.filter((f) => (mapping.files[f.id]?.length ?? 0) === 0).length;
  const batch = buildBatch(mapping, files);

  let reason: string | null = null;
  // What blocks Send, by name and by number (D-F1-60): the same words as the chips on the file rows.
  if (usable.length === 0 && infected === 0) reason = 'Add a file first';
  else if (infected > 0) reason = `Remove ${plural(infected, 'refused file', 'refused files')}`;
  else if (failed > 0) reason = `Retry or remove ${plural(failed, 'failed file', 'failed files')}`;
  else if (waiting > 0) reason = `Wait for ${plural(waiting, 'file', 'files')} to finish scanning`;
  else if (unmapped > 0) reason = `Choose folders for ${plural(unmapped, 'file', 'files')}`;
  else if (!batch.result.ok) reason = batch.result.reason;
  return { ready: reason === null, reason, batch: batch.result };
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
        return [{ binderId: d.binderId, folderId: d.folderId }];
      }),
    })),
  };
  return { request, result: validateBatch(request) };
}

export interface JobBody {
  files: { fileId: string; sha256: string }[];
  mappings: { fileId: string; destinations: { binderId: string; folderId: string }[] }[];
}

/** The body of POST /jobs, or null when the batch is not sendable. */
export function buildJobRequest(mapping: Mapping, files: PageFile[]): JobBody | null {
  const { request, result } = buildBatch(mapping, files);
  return result.ok ? request : null;
}

/** The pieces of a destination path the files table shows: team, then the name of the folder. */
export function describeDestination(path: string): { team: string; name: string } {
  const parts = path.split(' / ');
  return { team: parts[0] ?? '', name: parts[parts.length - 1] ?? '' };
}
