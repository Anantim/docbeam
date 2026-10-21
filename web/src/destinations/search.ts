import type { TreeNode } from './tree.js';

/** The folder search starts at 2 characters (the server wants the same, D-F1-67). Fewer only narrow the rows already loaded. */
export const MIN_SEARCH = 2;

/** One match from `GET /folders/search`. */
export interface FolderHit {
  id: string;
  name: string;
  /** Team / binder / folders above / the folder, as it is shown. */
  path: string;
  /** The same names, team first and the folder last: the page never splits `path` again (a name may hold " / "). */
  names: string[];
  teamId: string;
  binderId: string;
  /** The folders from the top of the binder down to this one (the match last). */
  folderIds: string[];
}

export interface SearchPage {
  items: FolderHit[];
  nextCursor: string | null;
}

export function searchUrl(q: string, cursor: string | null): string {
  return `/folders/search?q=${encodeURIComponent(q.trim())}${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`;
}

/**
 * The tree nodes from the team down to a match, built from its path and ids, so the tree can be opened down to a folder that
 * is not loaded yet (for example on the second page of its level). The last node is the folder itself.
 */
export function chainOf(hit: FolderHit): TreeNode[] {
  const names = hit.names;
  const team: TreeNode = { id: hit.teamId, kind: 'team', name: names[0] ?? '', binderId: null, pathNames: names.slice(0, 1) };
  const binder: TreeNode = { id: hit.binderId, kind: 'binder', name: names[1] ?? '', binderId: hit.binderId, pathNames: names.slice(0, 2) };
  const folders = hit.folderIds.map((id, i): TreeNode => ({ id, kind: 'folder', name: names[2 + i] ?? '', binderId: hit.binderId, pathNames: names.slice(0, 3 + i) }));
  return [team, binder, ...folders];
}
