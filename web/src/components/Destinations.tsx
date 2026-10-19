import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../auth/session.js';
import { teamColour } from '../destinations/colour.js';
import { destinationKey, MAX_DESTINATIONS, type Destination } from '../destinations/selection.js';
import { destinationFor, visibleIds, type Loaded, type TreeNode } from '../destinations/tree.js';
import type { TickState } from '../distribute/mapping.js';

interface Props {
  /** The destinations in use (the count in the header, and the ticks when `stateOf` is not given). */
  selected: Destination[];
  onToggle: (destination: Destination) => void;
  onTeams: (names: string[]) => void;
  /** Tick state for the files in scope. Without it a destination is on when it is in `selected`. */
  stateOf?: (destination: Destination) => TickState;
  /** How many files go to a destination, shown as a badge. */
  countOf?: (destination: Destination) => number;
  /** What a tick sends, for example "all 3 files" or "the 1 selected file". */
  scopeTitle?: string;
  /** Shows "Use all files" in the banner while some files are selected. */
  onUseAll?: () => void;
}

const folderNodes = (parent: TreeNode, folders: { id: string; name: string }[]): TreeNode[] =>
  folders.map((f) => ({ id: f.id, kind: 'folder', name: f.name, binderId: parent.binderId, pathNames: [...parent.pathNames, f.name] }));

async function loadChildren(node: TreeNode): Promise<TreeNode[]> {
  if (node.kind === 'team') {
    const binders = await apiFetch<{ id: string; name: string }[]>(`/teams/${node.id}/binders`);
    return binders.map((b) => ({ id: b.id, kind: 'binder', name: b.name, binderId: b.id, pathNames: [...node.pathNames, b.name] }));
  }
  const path = node.kind === 'binder' ? `/binders/${node.id}/contents` : `/folders/${node.id}/contents`;
  const contents = await apiFetch<{ folders: { id: string; name: string }[] }>(path);
  // Documents are not destinations, so the tree keeps only the folders.
  return folderNodes(node, contents.folders);
}

export function Destinations({ selected, onToggle, onTeams, stateOf, countOf, scopeTitle = 'your files', onUseAll }: Props) {
  const [roots, setRoots] = useState<TreeNode[] | null>(null);
  const [loaded, setLoaded] = useState<Map<string, Loaded>>(new Map());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [rootError, setRootError] = useState(false);

  const load = useCallback(async (node: TreeNode) => {
    setBusy((s) => new Set(s).add(node.id));
    setFailed((s) => {
      const n = new Set(s);
      n.delete(node.id);
      return n;
    });
    try {
      const children = await loadChildren(node);
      setLoaded((m) => new Map(m).set(node.id, { children }));
    } catch {
      setFailed((s) => new Set(s).add(node.id));
    } finally {
      setBusy((s) => {
        const n = new Set(s);
        n.delete(node.id);
        return n;
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ id: string; name: string }[]>('/teams')
      .then((teams) => {
        if (cancelled) return;
        const nodes = teams.map((t): TreeNode => ({ id: t.id, kind: 'team', name: t.name, binderId: null, pathNames: [t.name] }));
        setRoots(nodes);
        onTeams(nodes.map((n) => n.name));
      })
      .catch(() => !cancelled && setRootError(true));
    return () => {
      cancelled = true;
    };
  }, [load, onTeams]);

  const keep = useMemo(() => (roots ? visibleIds(roots, loaded, filter) : null), [roots, loaded, filter]);
  const chosen = useMemo(() => new Set(selected.map(destinationKey)), [selected]);

  function expand(node: TreeNode) {
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(node.id)) n.delete(node.id);
      else n.add(node.id);
      return n;
    });
    if (!loaded.has(node.id) && !busy.has(node.id)) void load(node);
  }

  function row(node: TreeNode, level: number) {
    if (keep && !keep.has(node.id)) return null;
    const children = loaded.get(node.id)?.children;
    const isOpen = keep ? keep.has(node.id) && (children?.length ?? 0) > 0 : open.has(node.id);
    const canExpand = children === undefined || children.length > 0;
    const destination = destinationFor(node);
    const tick: TickState = !destination ? 'off' : stateOf ? stateOf(destination) : chosen.has(destinationKey(destination)) ? 'on' : 'off';
    const on = tick !== 'off';
    const badge = destination && countOf ? countOf(destination) : 0;
    const colour = teamColour(node.name);

    return (
      <div key={node.id}>
        <div className={`row ${on ? 'on' : ''}`} style={{ paddingLeft: 4 + level * 26 }}>
          {canExpand ? (
            <button
              type="button"
              className="exp"
              aria-expanded={isOpen}
              aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${node.name}`}
              title={`${isOpen ? 'Collapse' : 'Expand'} ${node.name}`}
              onClick={() => expand(node)}
            >
              {isOpen ? '▾' : '▸'}
            </button>
          ) : (
            <span className="spc" />
          )}
          {node.kind === 'team' ? (
            <>
              <span className="teamsq" style={{ background: colour }}>
                {node.name.charAt(0).toUpperCase()}
              </span>
              <span className="name team">{node.name}</span>
              <span className="kind">team</span>
            </>
          ) : node.kind === 'binder' ? (
            <>
              <span aria-hidden="true">📘</span>
              <span className="name binder">{node.name}</span>
            </>
          ) : (
            <>
              <button
                type="button"
                role="checkbox"
                aria-checked={tick === 'mixed' ? 'mixed' : on}
                className="ck"
                aria-label={`Send ${scopeTitle} to ${destination?.path ?? node.name}`}
                onClick={() => destination && onToggle(destination)}
              >
                <span className={`box ${tick === 'mixed' ? 'mixed' : ''}`}>
                  {tick === 'on' ? <span style={{ color: '#fff', fontSize: 11, lineHeight: 1 }}>✓</span> : null}
                  {tick === 'mixed' ? <span style={{ color: '#fff', fontSize: 11, lineHeight: 1 }}>–</span> : null}
                </span>
              </button>
              <span aria-hidden="true">📁</span>
              <span className="name">{node.name}</span>
              {badge > 0 && <span className="badge">{badge === 1 ? '1 file' : `${badge} files`}</span>}
            </>
          )}
        </div>
        {isOpen && busy.has(node.id) && <div className="status-line" style={{ paddingLeft: 30 + level * 26 }}>Loading…</div>}
        {isOpen && failed.has(node.id) && (
          <div className="status-line err" style={{ paddingLeft: 30 + level * 26 }}>
            Could not load this level.{' '}
            <button className="link" type="button" onClick={() => void load(node)}>
              Try again
            </button>
          </div>
        )}
        {isOpen && children?.map((c) => row(c, level + 1))}
      </div>
    );
  }

  const nothingMatches = keep !== null && keep.size === 0;

  return (
    <section aria-label="Destinations" className="card dest">
      <div className="dest-head">
        <h2>Destinations</h2>
        <span className="n">
          {selected.length} of {MAX_DESTINATIONS} destinations
        </span>
      </div>
      <div className={`banner ${onUseAll ? 'scoped' : ''}`}>
        <span>
          Ticking a folder sends <strong>{scopeTitle}</strong> there
        </span>
        {onUseAll && (
          <button className="link" type="button" onClick={onUseAll}>
            Use all files
          </button>
        )}
      </div>
      <div className="filter">
        <label className="sr" htmlFor="dq">
          Filter destinations
        </label>
        <input
          id="dq"
          className="field"
          type="search"
          placeholder="Filter binders and folders"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="tree">
        {rootError && <div className="status-line err">Could not load your teams. Reload the page to try again.</div>}
        {!rootError && roots === null && <div className="status-line">Loading your teams…</div>}
        {roots?.length === 0 && <div className="status-line">You are not in any team yet.</div>}
        {nothingMatches ? <div className="status-line">No binders or folders match.</div> : roots?.map((r) => row(r, 0))}
      </div>
    </section>
  );
}
