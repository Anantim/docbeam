/** One row of the destination tree. Teams are only headings; binders and folders can be ticked. */
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

export function destinationFor(node: TreeNode): { binderId: string; folderId: string | null; path: string } | null {
  if (node.kind === 'team' || !node.binderId) return null;
  return {
    binderId: node.binderId,
    folderId: node.kind === 'folder' ? node.id : null,
    path: node.pathNames.join(' / ') + (node.kind === 'binder' ? ' (top level)' : ''),
  };
}
