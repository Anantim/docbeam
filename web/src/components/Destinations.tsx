import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { apiFetch } from '../auth/session.js';
import type { Destination } from '../destinations/selection.js';
import { destinationFor, pageUrl, visibleIds, type Loaded, type TreeNode } from '../destinations/tree.js';
import type { TickState } from '../distribute/mapping.js';
import { MoreRow } from './MoreRow.js';
import { CheckIcon, ChevronIcon, FolderIcon, MinusIcon, SearchIcon } from './Icons.js';

interface Props {
  onToggle: (destination: Destination) => void;
  onTeams: (names: string[]) => void;
  /** Tick state of a folder for the files in scope. */
  stateOf: (destination: Destination) => TickState;
  /** What a tick sends, for example "all 3 files" or "the 1 selected file". */
  scopeTitle?: string;
  /** Shows "Use all files" in the banner while some files are selected. */
  onUseAll?: () => void;
}

const folderNodes = (parent: TreeNode, folders: { id: string; name: string }[]): TreeNode[] =>
  folders.map((f) => ({ id: f.id, kind: 'folder', name: f.name, binderId: parent.binderId, pathNames: [...parent.pathNames, f.name] }));

interface Page {
  children: TreeNode[];
  nextCursor: string | null;
}

/** One page of one level. A level is read 20 rows at a time (the server's default), and only when it is asked for. */
async function loadPage(node: TreeNode, cursor: string | null): Promise<Page> {
  if (node.kind === 'team') {
    const page = await apiFetch<{ items: { id: string; name: string }[]; nextCursor: string | null }>(pageUrl(`/teams/${node.id}/binders`, cursor));
    const children = page.items.map((b): TreeNode => ({ id: b.id, kind: 'binder', name: b.name, binderId: b.id, pathNames: [...node.pathNames, b.name] }));
    return { children, nextCursor: page.nextCursor };
  }
  const path = node.kind === 'binder' ? `/binders/${node.id}/contents` : `/folders/${node.id}/contents`;
  const page = await apiFetch<{ folders: { id: string; name: string }[]; documents: unknown[]; nextCursor: string | null }>(pageUrl(path, cursor));
  // Documents are not destinations, so the tree keeps only the folders. Folders come before documents, so a page that
  // holds a document means every folder is already loaded: the rest of the pages are documents and are never read.
  return { children: folderNodes(node, page.folders), nextCursor: page.documents.length > 0 ? null : page.nextCursor };
}

interface LineProps {
  node: TreeNode;
  level: number;
  tick: TickState;
  isOpen: boolean;
  canExpand: boolean;
  scopeTitle: string;
  onExpand: (node: TreeNode) => void;
  onToggle: (destination: Destination) => void;
}

/**
 * One row of the tree. It is memoised on plain values, so ticking one folder draws that row again and not every
 * row of the tree (F1 follow-up: 40 folders were 40 redraws per tick, now 1).
 */
const TreeLine = memo(function TreeLine({ node, level, tick, isOpen, canExpand, scopeTitle, onExpand, onToggle }: LineProps) {
  const destination = destinationFor(node);
  const on = tick !== 'off';
  return (
    <div className={`row ${on ? 'on' : ''}`} style={{ ['--level' as string]: level }}>
      {canExpand ? (
        <button
          type="button"
          className="exp"
          data-nav={node.kind === 'folder' ? undefined : ''}
          aria-expanded={isOpen}
          aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${node.name}`}
          title={`${isOpen ? 'Collapse' : 'Expand'} ${node.name}`}
          onClick={() => onExpand(node)}
        >
          <ChevronIcon open={isOpen} size={14} />
        </button>
      ) : (
        <span className="spc" />
      )}
      {node.kind === 'team' ? (
        <span className="name team">{node.name}</span>
      ) : node.kind === 'binder' ? (
        <span className="name binder">{node.name}</span>
      ) : (
        <>
          <button
            type="button"
            role="checkbox"
            data-nav=""
            aria-checked={tick === 'mixed' ? 'mixed' : on}
            className="ck"
            aria-label={`Send ${scopeTitle} to ${destination?.path ?? node.name}`}
            onClick={() => destination && onToggle(destination)}
          >
            <span className={`box ${tick === 'mixed' ? 'mixed' : ''}`}>
              {tick === 'on' ? <CheckIcon size={12} /> : null}
              {tick === 'mixed' ? <MinusIcon size={12} /> : null}
            </span>
          </button>
          <span className="tree-icon" aria-hidden="true">
            <FolderIcon />
          </span>
          <span className="name">{node.name}</span>
        </>
      )}
    </div>
  );
});

/** Rows that look like the list while it loads. */
function Skeleton({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div className="tree-skeleton" role="status" aria-label={label} aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <span className="skeleton" key={i} />
      ))}
    </div>
  );
}

export function Destinations({ onToggle, onTeams, stateOf, scopeTitle = 'your files', onUseAll }: Props) {
  const [roots, setRoots] = useState<TreeNode[] | null>(null);
  const [rootsNext, setRootsNext] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Map<string, Loaded>>(new Map());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [rootError, setRootError] = useState(false);
  // A level that is loading its next page, so the same page is never asked for twice.
  const inFlight = useRef(new Set<string>());
  const ROOT = 'root';

  const setFlag = (set: (f: (s: Set<string>) => Set<string>) => void, id: string, on: boolean) =>
    set((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  /** Loads the first page of a level, or the next one when it has a cursor. */
  const load = useCallback(async (node: TreeNode, cursor: string | null) => {
    if (inFlight.current.has(node.id)) return;
    inFlight.current.add(node.id);
    setFlag(setBusy, node.id, true);
    setFlag(setFailed, node.id, false);
    try {
      const page = await loadPage(node, cursor);
      setLoaded((m) => new Map(m).set(node.id, { children: [...(m.get(node.id)?.children ?? []), ...page.children], nextCursor: page.nextCursor }));
    } catch {
      setFlag(setFailed, node.id, true);
    } finally {
      inFlight.current.delete(node.id);
      setFlag(setBusy, node.id, false);
    }
  }, []);

  const loadTeams = useCallback(
    async (cursor: string | null) => {
      if (inFlight.current.has(ROOT)) return;
      inFlight.current.add(ROOT);
      setFlag(setBusy, ROOT, true);
      setFlag(setFailed, ROOT, false);
      try {
        const page = await apiFetch<{ items: { id: string; name: string }[]; nextCursor: string | null }>(pageUrl('/teams', cursor));
        const nodes = page.items.map((t): TreeNode => ({ id: t.id, kind: 'team', name: t.name, binderId: null, pathNames: [t.name] }));
        setRoots((r) => (cursor === null ? nodes : [...(r ?? []), ...nodes]));
        setRootsNext(page.nextCursor);
      } catch {
        if (cursor === null) setRootError(true);
        else setFlag(setFailed, ROOT, true);
      } finally {
        inFlight.current.delete(ROOT);
        setFlag(setBusy, ROOT, false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadTeams(null);
  }, [loadTeams]);

  // The shell shows the team names that are loaded so far.
  useEffect(() => {
    if (roots) onTeams(roots.map((n) => n.name));
  }, [roots, onTeams]);

  const keep = useMemo(() => (roots ? visibleIds(roots, loaded, filter) : null), [roots, loaded, filter]);

  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  const toggleRef = useRef(onToggle);
  toggleRef.current = onToggle;
  const toggle = useCallback((d: Destination) => toggleRef.current(d), []);

  const expand = useCallback((node: TreeNode) => {
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(node.id)) n.delete(node.id);
      else n.add(node.id);
      return n;
    });
    if (!loadedRef.current.has(node.id) && !inFlight.current.has(node.id)) void load(node, null);
  }, [load]);

  function row(node: TreeNode, level: number) {
    if (keep && !keep.has(node.id)) return null;
    const children = loaded.get(node.id)?.children;
    const isOpen = keep ? keep.has(node.id) && (children?.length ?? 0) > 0 : open.has(node.id);
    const canExpand = children === undefined || children.length > 0;
    const destination = destinationFor(node);
    const tick: TickState = destination ? stateOf(destination) : 'off';

    return (
      <div key={node.id}>
        <TreeLine node={node} level={level} tick={tick} isOpen={isOpen} canExpand={canExpand} scopeTitle={scopeTitle} onExpand={expand} onToggle={toggle} />
        {isOpen && busy.has(node.id) && children === undefined && (
          <div className="nested" style={{ ['--level' as string]: level }}>
            <Skeleton rows={2} label="Loading this level" />
          </div>
        )}
        {isOpen && failed.has(node.id) && children === undefined && (
          <div className="status-line err nested" style={{ ['--level' as string]: level }} role="alert">
            Could not load this level.{' '}
            <button className="link" type="button" onClick={() => void load(node, null)}>
              Try again
            </button>
          </div>
        )}
        {isOpen && children?.map((c) => row(c, level + 1))}
        {isOpen && children !== undefined && loaded.get(node.id)?.nextCursor != null && !keep && (
          <MoreRow className="status-line nested" style={{ ['--level' as string]: level + 1 }} busy={busy.has(node.id)} failed={failed.has(node.id)} onMore={() => void load(node, loaded.get(node.id)?.nextCursor ?? null)} />
        )}
      </div>
    );
  }

  const nothingMatches = keep !== null && keep.size === 0;

  // Arrow keys move through the tree: Up and Down between rows, Right opens a row, Left closes it (D-F1-10).
  const onTreeKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    if (!target.closest('.row')) return;
    const anchors = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-nav]')];
    const rowOf = (el: Element): Element | null => el.closest('.row');
    const at = anchors.findIndex((a) => rowOf(a) === rowOf(target));
    if (event.key === 'ArrowDown') anchors[at + 1]?.focus();
    else if (event.key === 'ArrowUp') anchors[at - 1]?.focus();
    else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const exp = rowOf(target)?.querySelector<HTMLButtonElement>('.exp');
      const isOpen = exp?.getAttribute('aria-expanded') === 'true';
      if (exp && isOpen === (event.key === 'ArrowLeft')) exp.click();
      else return;
    } else return;
    event.preventDefault();
  };

  return (
    <section aria-label="Destinations" className="card dest">
      <div className="card-head">
        <h2>Destinations</h2>
      </div>
      <div className={`scope ${onUseAll ? 'scoped' : ''}`}>
        <span>
          Sends <strong>{scopeTitle}</strong>
        </span>
        {onUseAll && (
          <button className="link" type="button" onClick={onUseAll}>
            Use all files
          </button>
        )}
      </div>
      <div className="filter search">
        <SearchIcon size={14} />
        <label className="sr" htmlFor="dq">
          Filter destinations
        </label>
        <input
          id="dq"
          className="field"
          type="search"
          placeholder="Search folders"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="tree" onKeyDown={onTreeKey}>
        {rootError && (
          <div className="state small" role="alert">
            <strong>Could not load your teams</strong>
            <button
              className="btn2 btnsm"
              type="button"
              onClick={() => {
                setRootError(false);
                void loadTeams(null);
              }}
            >
              Try again
            </button>
          </div>
        )}
        {!rootError && roots === null && <Skeleton rows={4} label="Loading your teams" />}
        {roots?.length === 0 && (
          <div className="state small">
            <strong>You are not in a team yet</strong>
          </div>
        )}
        {nothingMatches ? <div className="status-line">No binders or folders match.</div> : roots?.map((r) => row(r, 0))}
        {roots !== null && rootsNext !== null && !keep && <MoreRow className="status-line nested" style={{ ['--level' as string]: 0 }} busy={busy.has(ROOT)} failed={failed.has(ROOT)} onMore={() => void loadTeams(rootsNext)} />}
      </div>
    </section>
  );
}
