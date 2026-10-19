/** One row of the destination tree. Teams and binders are only headings; folders can be ticked. */
export interface TreeNode {
  id: string;
  kind: 'team' | 'binder' | 'folder';
  name: string;
  /** The binder the node belongs to (itself for a binder). */
  binderId: string | null;
  /** Names from the team down to this node. */
  pathNames: string[];
}

export interface Loaded {
  children: TreeNode[];
}

/** Which nodes the filter keeps: every match, and the parents that lead to one. Case-insensitive substring. */
export function visibleIds(
  roots: TreeNode[],
  loaded: Map<string, Loaded>,
  filter: string,
): Set<string> | null {
  const q = filter.trim().toLowerCase();
  if (!q) return null;
  const keep = new Set<string>();
  const walk = (node: TreeNode): boolean => {
    const own = node.name.toLowerCase().includes(q);
    let below = false;
    for (const child of loaded.get(node.id)?.children ?? []) if (walk(child)) below = true;
    if (own || below) keep.add(node.id);
    return own || below;
  };
  for (const root of roots) walk(root);
  return keep;
}

/** Only a folder is a destination. Teams and binders are headings (D-F1-3). */
export function destinationFor(node: TreeNode): { binderId: string; folderId: string; path: string } | null {
  if (node.kind !== 'folder' || !node.binderId) return null;
  return { binderId: node.binderId, folderId: node.id, path: node.pathNames.join(' / ') };
}
