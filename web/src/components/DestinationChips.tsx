import { describeDestination } from '../distribute/mapping.js';
import { Popover } from './Popover.js';

interface Props {
  /** Full destination paths, for example "Cardio / CARDIO-301 Regulatory / Protocol amendments". */
  paths: readonly string[];
  /** How many chips show before "+N". */
  visible?: number;
}

/** What the popover shows for a hidden destination: its path without the team, which the group header names. */
function withoutTeam(path: string): string {
  const parts = path.split(' / ');
  return parts.length > 1 ? parts.slice(1).join(' / ') : (parts[0] ?? '');
}

/** Hidden destinations grouped by team, in the order they first appear. */
export function groupByTeam(paths: readonly string[]): Array<{ team: string; paths: string[] }> {
  const groups = new Map<string, string[]>();
  for (const path of paths) {
    const { team } = describeDestination(path);
    groups.set(team, [...(groups.get(team) ?? []), path]);
  }
  return [...groups].map(([team, list]) => ({ team, paths: list }));
}

/** Folders grouped by team, in a scrolling list: the body of a popover. */
export function FolderList({ paths }: { paths: readonly string[] }) {
  return (
    <div className="popover-list" tabIndex={0}>
            {groupByTeam(paths).map((group) => (
              <div className="popover-group" key={group.team}>
                <div className="popover-team">{group.team}</div>
                <ul>
                  {group.paths.map((path) => (
                    <li key={path} title={path}>
                      {withoutTeam(path)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
  );
}

/**
 * The destinations of a file or a distribution. The first few are chips, each titled with its own full path
 * only. The rest are behind a "+N" button that opens a popover listing just those, grouped by team (D-M3-2).
 */
export function DestinationChips({ paths, visible = 2 }: Props) {
  const shown = paths.slice(0, visible);
  const hidden = paths.slice(visible);
  return (
    <>
      {shown.map((path) => (
        <span className="chip" key={path} title={path}>
          {describeDestination(path).name}
        </span>
      ))}
      {hidden.length > 0 && (
        <Popover
          label={`+${hidden.length}`}
          ariaLabel={`Show ${hidden.length} more ${hidden.length === 1 ? 'folder' : 'folders'}`}
          panelLabel={`${hidden.length} more ${hidden.length === 1 ? 'folder' : 'folders'}`}
          className="chip more"
        >
          <FolderList paths={hidden} />
        </Popover>
      )}
    </>
  );
}
