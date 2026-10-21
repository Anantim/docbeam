import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FILTER_AFTER, ListFilter, matchesFilter, NoMatches } from './ListFilter.js';
import { overlayRoot } from './overlay.js';

interface Props {
  /** What the count link shows, for example "+3" or "5 folders". */
  label: string;
  /** What a screen reader says for the link, for example "Show 3 more folders". */
  ariaLabel: string;
  /** Accessible name of the opened panel. */
  panelLabel: string;
  /** The list in the panel: full folder paths, or file names. */
  items: readonly string[];
  /** `end` lines the panel's right edge up with the link's, for a link at the right of the window (the header). */
  align?: 'start' | 'end';
}

const OPEN_AFTER_MS = 300;
const CLOSE_AFTER_MS = 200;
const WIDTH = 340;
const MARGIN = 8;
const MAX_HEIGHT = 360;

interface Place {
  top: number;
  left: number;
  maxHeight: number;
  /** Placed above the link: it then rises into place, and slides down from it when placed below (D-F1-47). */
  above?: boolean;
}

/**
 * The one count link and its popover (D-F1-42): "+N" on Status and in the side panel, "N folders" on a file row, "N files"
 * beside a ticked folder. All look the same (`.count-link`) and behave the same.
 *  - It opens on hover after 300 ms, on keyboard focus, and on a click or Enter (which pins it). It stays open while the
 *    pointer is on the link or on the panel, so the list can be scrolled, and closes 200 ms after the pointer leaves
 *    both, on Esc, on a click outside, or when its link scrolls out of view.
 *  - The panel is drawn in a portal on the page body, so no card or scroll area clips it, and it is placed below the
 *    link, or above when there is more room there, and kept inside the window.
 *  - A list of more than 15 gets a "Filter…" box. Focusing or clicking the box pins the panel open until Esc or a click
 *    outside; a panel opened by a click or the keyboard is pinned and puts focus in the box (or on the list) at once.
 */
export function Popover({ label, ariaLabel, panelLabel, items, align = 'start' }: Props) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [query, setQuery] = useState('');
  const [place, setPlace] = useState<Place | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const quiet = useRef(false);
  const id = useId();
  const filterable = items.length > FILTER_AFTER.popover;
  const shown = filterable ? items.filter((item) => matchesFilter(item, query)) : items;

  const stopTimer = (): void => clearTimeout(timer.current);
  const after = (ms: number, fn: () => void): void => {
    stopTimer();
    timer.current = setTimeout(fn, ms);
  };
  const close = (): void => {
    stopTimer();
    setOpen(false);
    setPinned(false);
    setQuery('');
    setPlace(null);
  };
  const pin = (): void => {
    stopTimer();
    setOpen(true);
    setPinned(true);
  };

  // Below the link, or above it when there is more room there; inside the window sideways.
  const reposition = (): void => {
    const link = trigger.current;
    const card = panel.current;
    if (!link || !card) return;
    const r = link.getBoundingClientRect();
    const width = Math.min(WIDTH, window.innerWidth - 2 * MARGIN);
    const edge = align === 'end' ? r.right - width : r.left;
    const left = Math.max(MARGIN, Math.min(edge, window.innerWidth - width - MARGIN));
    const below = window.innerHeight - r.bottom - MARGIN;
    const above = r.top - MARGIN;
    const wanted = Math.min(card.scrollHeight, MAX_HEIGHT);
    if (wanted <= below || below >= above) setPlace({ top: r.bottom, left, maxHeight: Math.min(MAX_HEIGHT, below) });
    else {
      const height = Math.min(wanted, above);
      setPlace({ top: r.top - height, left, maxHeight: Math.min(MAX_HEIGHT, above), above: true });
    }
  };
  // After the list or the filter changes the panel is placed again (a shorter list may now fit below).
  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, query, items.length]);

  // Pinned by a click or the keyboard: the focus goes in at once, to the box or, with no box, to the list (so it scrolls by keyboard).
  useEffect(() => {
    if (open && pinned && place) (box.current ?? list.current)?.focus({ preventScroll: true });
  }, [open, pinned, place === null]);

  useEffect(() => {
    if (!open) return;
    const inside = (node: EventTarget | null): boolean => node instanceof Node && (trigger.current?.contains(node) === true || panel.current?.contains(node) === true);
    const onPointerDown = (event: PointerEvent): void => {
      if (!inside(event.target)) close();
    };
    // Esc: first it empties the box, then it closes the panel and gives the focus back to the link. It does not go on to
    // the side panel under it, which also closes on Esc.
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      event.preventDefault();
      if (box.current && box.current.value !== '') {
        setQuery('');
        return;
      }
      close();
      quiet.current = document.activeElement !== trigger.current; // the focus coming back to the link must not open the panel again
      trigger.current?.focus({ preventScroll: true });
    };
    const onScrollOrResize = (event: Event): void => {
      if (panel.current?.contains(event.target as Node)) return; // the list scrolling inside the panel
      reposition();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    // The link scrolled out of its card or out of the window: the panel would hang over nothing.
    const watcher = typeof IntersectionObserver === 'undefined' || !trigger.current ? null : new IntersectionObserver((entries) => entries.some((e) => e.intersectionRatio === 0) && close());
    if (trigger.current) watcher?.observe(trigger.current);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
      watcher?.disconnect();
    };
  }, [open]);

  useEffect(() => stopTimer, []);

  const enter = (): void => {
    stopTimer();
    if (!open) after(OPEN_AFTER_MS, () => setOpen(true));
  };
  const leave = (): void => {
    stopTimer();
    if (open && !pinned) after(CLOSE_AFTER_MS, close);
  };
  const focusLeft = (event: React.FocusEvent): void => {
    const next = event.relatedTarget as Node | null;
    if (next && (trigger.current?.contains(next) || panel.current?.contains(next))) return;
    if (next === null && pinned) return; // a click on the panel's own scrollbar: a click outside closes a pinned panel
    close();
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="count-link"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onMouseEnter={enter}
        onMouseLeave={leave}
        onFocus={() => {
          if (quiet.current) {
            quiet.current = false;
            return;
          }
          stopTimer();
          setOpen(true);
        }}
        onBlur={focusLeft}
        onClick={(e) => {
          e.stopPropagation(); // a count link inside a row does not open the row
          if (pinned) close();
          else pin();
        }}
      >
        {label}
      </button>
      {open &&
        createPortal(
          <div
            id={id}
            ref={panel}
            className={`popover-panel ${place?.above ? 'above' : ''}`}
            role="dialog"
            aria-label={panelLabel}
            style={{ top: place?.top ?? 0, left: place?.left ?? 0, width: Math.min(WIDTH, window.innerWidth - 2 * MARGIN), maxHeight: place?.maxHeight, visibility: place ? 'visible' : 'hidden' }}
            onMouseEnter={() => stopTimer()}
            onMouseLeave={leave}
            onPointerDown={() => setPinned(true)} // a click inside, on the list or its scrollbar, keeps it open
            onBlur={focusLeft}
            onClick={(e) => e.stopPropagation()}
          >
            {filterable && (
              <div className="popover-filter">
                <ListFilter ref={box} value={query} onChange={setQuery} label={`Filter ${panelLabel}`} onFocus={pin} onClick={pin} />
              </div>
            )}
            <div className="popover-list" ref={list} tabIndex={0} aria-label={panelLabel}>
              {shown.length === 0 ? (
                <NoMatches
                  onClear={() => {
                    setQuery('');
                    box.current?.focus();
                  }}
                />
              ) : (
                <ul>
                  {shown.map((item, i) => (
                    <li key={`${i}-${item}`}>
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>,
          overlayRoot(),
        )}
    </>
  );
}
