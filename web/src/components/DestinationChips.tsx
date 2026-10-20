import { describeDestination } from '../distribute/mapping.js';
import { Popover } from './Popover.js';

interface Props {
  /** Full destination paths, for example "Cardio / CARDIO-301 Regulatory / Protocol amendments". */
  paths: readonly string[];
  /** How many chips show before "+N". */
  visible?: number;
}

/**
 * The destinations of a file or a distribution. The first few are chips: the folder's name, and its full path as the
 * tooltip and the accessible name. The rest are behind a "+N" count link that opens a popover listing just those with
 * their paths (D-M3-2, D-F1-33, D-F1-42).
 */
export function DestinationChips({ paths, visible = 2 }: Props) {
  const shown = paths.slice(0, visible);
  const hidden = paths.slice(visible);
  return (
    <>
      {shown.map((path) => (
        <span className="chip" key={path} title={path} role="img" aria-label={path}>
          {describeDestination(path).name}
        </span>
      ))}
      {hidden.length > 0 && (
        <Popover
          label={`+${hidden.length}`}
          ariaLabel={`Show ${hidden.length} more ${hidden.length === 1 ? 'folder' : 'folders'}`}
          panelLabel={`${hidden.length} more ${hidden.length === 1 ? 'folder' : 'folders'}`}
          items={hidden}
        />
      )}
    </>
  );
}
