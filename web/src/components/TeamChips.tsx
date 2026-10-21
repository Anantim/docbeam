import { useLayoutEffect, useRef, useState } from 'react';
import { Popover } from './Popover.js';
import { Tooltip } from './Tooltip.js';

/** Up to this many teams are all shown as chips; with more, the first SHOWN_WHEN_MORE are and the rest are one "+N" link. */
export const CHIPS_ALL = 3;
export const SHOWN_WHEN_MORE = 2;

/** "Cardio", "Cardio and Neuro", "Cardio, Neuro and Oncology". */
export function andList(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The team names, sorted A to Z, each once. */
export function sortedTeams(names: readonly string[]): string[] {
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

/** One team: the same chip as a folder chip, at most 100 px wide and cut with an ellipsis, with the full name on hover when it was cut. */
function Chip({ name }: { name: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (el) setCut(el.scrollWidth > el.clientWidth);
  }, [name]);
  return (
    <Tooltip text={cut ? name : undefined} within=".panel">
      <span ref={box} className="chip">
        {name}
      </span>
    </Tooltip>
  );
}

/**
 * For a viewer who is not the sender (D-F1-77): " · Showing only deliveries to" and the teams as chips, on the one line with
 * the time. Up to 3 teams are all shown; with more, the first 2 and a "+N" link, which opens the shared popover with every
 * team (a list of names is a popover, never a dark tooltip, D-F1-78). A screen reader gets the whole sentence once.
 */
export function TeamChips({ teams }: { teams: readonly string[] }) {
  const names = sortedTeams(teams);
  if (names.length === 0) return null;
  const many = names.length > CHIPS_ALL;
  const shown = many ? names.slice(0, SHOWN_WHEN_MORE) : names;
  const hidden = many ? names.length - SHOWN_WHEN_MORE : 0;
  return (
    <span className="panel-note">
      <span className="sr">Showing only deliveries to {andList(names)}</span>
      <span className="panel-sep" aria-hidden="true">
        {' · '}
      </span>
      <span className="panel-note-label" aria-hidden="true">
        Showing only deliveries to
      </span>
      <span className="team-chips">
        {shown.map((n) => (
          <span aria-hidden="true" key={n}>
            <Chip name={n} />
          </span>
        ))}
        {hidden > 0 && <Popover label={`+${hidden}`} ariaLabel={`Show all ${names.length} teams`} panelLabel="Teams" items={names} align="end" />}
      </span>
    </span>
  );
}
