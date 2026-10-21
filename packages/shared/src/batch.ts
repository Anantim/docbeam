// The batch rules of POST /jobs (TDD "Submission checks"). The API and the web app both use this, so the
// page stops a bad batch before the server would. Pure code: no Node imports.
import { LIMITS } from './limits.js';

/** A destination is a folder. `folderId` is optional in the type only so that validateBatch can refuse a binder. */
export interface BatchDestination {
  binderId: string;
  folderId?: string | null;
}

export interface BatchInput {
  files: { fileId: string }[];
  mappings: { fileId: string; destinations: BatchDestination[] }[];
}

export type BatchResult =
  | { ok: true; taskCount: number; destinationCount: number }
  | { ok: false; reason: string };

export const destinationKey = (d: BatchDestination): string => `${d.binderId}:${d.folderId ?? ''}`;

/** Checks the limits in the order the contract lists them. The reason is safe to show to the user. */
export function validateBatch(batch: BatchInput): BatchResult {
  const fail = (reason: string): BatchResult => ({ ok: false, reason });

  if (batch.files.length === 0) return fail('Add at least one file.');
  if (batch.files.length > LIMITS.maxFilesPerJob) {
    return fail(`A distribution can have at most ${LIMITS.maxFilesPerJob} files.`);
  }

  const fileIds = new Set(batch.files.map((f) => f.fileId));
  if (fileIds.size !== batch.files.length) return fail('The same file is listed twice.');

  const mapped = new Set<string>();
  const destinations = new Set<string>();
  let taskCount = 0;

  for (const mapping of batch.mappings) {
    if (!fileIds.has(mapping.fileId)) return fail('A mapping names a file that is not in the distribution.');
    if (mapped.has(mapping.fileId)) return fail('A file is mapped twice.');
    mapped.add(mapping.fileId);
    if (mapping.destinations.length === 0) return fail('Every file needs at least one destination.');

    const own = new Set<string>();
    for (const destination of mapping.destinations) {
      // Only a folder can receive files. A binder is a heading in the tree (D-F1-3).
      if (!destination.folderId) return fail("Choose a folder. Files can't go to a binder.");
      const key = destinationKey(destination);
      if (own.has(key)) return fail('A file is sent to the same destination twice.');
      own.add(key);
      destinations.add(key);
    }
    taskCount += mapping.destinations.length;
  }

  if (mapped.size !== fileIds.size) return fail('Every file needs at least one destination.');
  if (destinations.size > LIMITS.maxDestinationsPerJob) {
    return fail(`A distribution can have at most ${LIMITS.maxDestinationsPerJob} destinations.`);
  }
  if (taskCount > LIMITS.maxTasksPerJob) {
    return fail(`A distribution can have at most ${LIMITS.maxTasksPerJob.toLocaleString('en-US')} deliveries.`);
  }
  return { ok: true, taskCount, destinationCount: destinations.size };
}
