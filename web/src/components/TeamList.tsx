import { useLayoutEffect, useRef, useState } from 'react';
import { Popover } from './Popover.js';

interface Props {
  /** The names, in the order to show them. */
  names: readonly string[];
  /** The accessible name of the popover that lists them all, for example "Your teams". */
  panelLabel: string;
  /** Text after the last name when every name fits, for example ".". */
  end?: string;
  /** The popover opens with its right edge at the "+N" link, so it stays inside the window from the right-hand header. */
  align?: 'start' | 'end';
  /** `max-width` for a box as wide as its content (the header), whose limit is a `max-width`; `self` (the default) for a box that fills the space it is given. */
  room?: 'self' | 'max-width';
}

/** The names that fit in `room` px with ", " between them and, when some are left out, a "+N" link after them. At least one name is always shown. */
export function fitCount(widths: readonly number[], separator: number, plus: number, room: number, end = 0): number {
  const n = widths.length;
  const total = widths.reduce((sum, w, i) => sum + w + (i > 0 ? separator : 0), 0);
  if (total + end <= room) return n; // the end text ("."), shown only when every name fits, needs room too
  let used = 0;
  let k = 0;
  for (let i = 0; i < n; i += 1) {
    const next = used + (i > 0 ? separator : 0) + (widths[i] as number);
    if (next + separator + plus > room) break;
    used = next;
    k = i + 1;
  }
  return Math.max(1, k);
}

/**
 * The room for the names. A box that is as wide as its content (the header) would shrink with the names and never grow
 * back, so the nearest ancestor with a `max-width` in px gives the room; otherwise the box's own width is used.
 */
function roomOf(el: HTMLElement, room: 'self' | 'max-width'): number {
  if (room === 'self') return el.clientWidth;
  for (let node: HTMLElement | null = el; node && node !== document.body; node = node.parentElement) {
    const limit = getComputedStyle(node).maxWidth;
    if (limit.endsWith('px')) return Number.parseFloat(limit); // not "none" or a percentage
  }
  return el.clientWidth;
}

/**
 * A list of names on one line (D-F1-53): the names that fit, comma-separated, and the rest as "+N" in the accent link style,
 * which opens the shared count popover with every name (hover after 300 ms, focus or a click; a "Filter…" box over 15). It is
 * measured with the real font and again when its box changes size, so a narrower window or panel shows fewer names.
 */
export function TeamList({ names, panelLabel, end = '', align = 'start', room = 'self' }: Props) {
  const box = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(names.length);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = (): void => {
      // The widths are read from a hidden copy in the same font, so the visible text is never duplicated in the page.
      const probe = document.createElement('span');
      probe.setAttribute('aria-hidden', 'true');
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;pointer-events:none;font:${getComputedStyle(el).font}`;
      const part = (text: string): HTMLSpanElement => {
        const s = document.createElement('span');
        s.textContent = text;
        probe.appendChild(s);
        return s;
      };
      const parts = names.map(part);
      const sep = part(', ');
      const plus = part(`+${Math.max(1, names.length)}`);
      const tail = part(end);
      document.body.appendChild(probe);
      const widths = parts.map((p) => p.offsetWidth);
      const result = fitCount(widths, sep.offsetWidth, plus.offsetWidth + 8, roomOf(el, room), tail.offsetWidth);
      probe.remove();
      setShown((was) => (was === result ? was : result));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const watcher = new ResizeObserver(measure);
    watcher.observe(el);
    return () => watcher.disconnect();
  }, [names, end, room]);

  const hidden = names.length - shown;
  return (
    <span className="teamlist" ref={box}>
      {names.slice(0, shown).join(', ')}
      {hidden === 0 ? end : null}
      {hidden > 0 && (
        <span className="teamlist-more">
          <Popover
            label={`+${hidden}`}
            ariaLabel={`Show all ${names.length} ${names.length === 1 ? 'team' : 'teams'}`}
            panelLabel={panelLabel}
            items={names}
            align={align}
          />
        </span>
      )}
    </span>
  );
}
