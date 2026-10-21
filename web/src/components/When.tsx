import { useSyncExternalStore } from 'react';
import { formatFull, formatWhen } from '../tracking/format.js';
import { Tooltip } from './Tooltip.js';

// "Today" and "Yesterday" change at midnight, so every time on the page listens to one clock that ticks when the day changes
// (D-F1-59). It runs only while a time is on the page.
const dayKey = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};
let day = dayKey();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

function check(): void {
  const next = dayKey();
  if (next !== day) {
    day = next;
    listeners.forEach((fn) => fn());
  }
}
function schedule(): void {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  timer = setTimeout(() => {
    check();
    schedule();
  }, midnight - now.getTime() + 500);
}
function subscribe(fn: () => void): () => void {
  if (listeners.size === 0) {
    schedule();
    document.addEventListener('visibilitychange', check); // a laptop that slept through midnight
  }
  listeners.add(fn);
  check();
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', check);
    }
  };
}

interface Props {
  iso: string;
  /** False inside a button or a link, where a second tab stop would be wrong: the full time still shows on hover. */
  focusable?: boolean;
}

/** A time: "Today, 04:34", with the full time and zone in the shared tooltip, and the ISO value in the `<time>` element. */
export function When({ iso, focusable = true }: Props) {
  useSyncExternalStore(subscribe, () => day);
  return (
    <Tooltip text={formatFull(iso)}>
      <time className="when" dateTime={iso} tabIndex={focusable ? 0 : undefined}>
        {formatWhen(iso)}
      </time>
    </Tooltip>
  );
}
