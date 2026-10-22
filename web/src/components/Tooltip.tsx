import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { prefersReducedMotion } from '../motion.js';
import { overlayRoot } from './overlay.js';

/** How long the pointer rests before a tooltip shows. Keyboard focus shows it at once. */
export const TOOLTIP_DELAY_MS = 300;
const OUT_MS = 80;
const MARGIN = 8;
const GAP = 6;
const MAX_WIDTH = 320;

/**
 * A tooltip shows on hover, and on focus only when the keyboard moved the focus there (D-F1-81). Focus that the app moves (a dialog
 * opening, the focus going back to a button after Esc or Close) shows nothing. The page notes when the last key that moves the
 * focus was pressed: a focus that comes right after one is the keyboard's.
 */
const NAV_KEYS = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);
const KEY_FOCUS_MS = 300;
let lastNavKeyAt = Number.NEGATIVE_INFINITY;
/** Counts the focus-moving key presses, so one key press shows a tooltip once: focus that comes back to the same button later does not. */
let navKeyCount = 0;
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (event) => {
    if (!NAV_KEYS.has(event.key)) return;
    lastNavKeyAt = Date.now();
    navKeyCount += 1;
  }, true);
}
const keyboardMovedFocus = (): number | null => (Date.now() - lastNavKeyAt < KEY_FOCUS_MS ? navKeyCount : null);

/** The event that closes every open tooltip at once, with no fade: a dialog opening sends it (D-F1-81). */
const CLOSE_ALL = 'docbeam:close-tooltips';
export const closeAllTooltips = (): void => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CLOSE_ALL));
};

interface Props {
  /** What it says. Nothing (undefined or empty) means no tooltip and no wrapper. */
  text: string | undefined;
  children: ReactNode;
  /** The wrapper is a block (for a cut-off line of text) and not an inline box. */
  block?: boolean;
  /** A click shows it too (and it stays until Esc, a click elsewhere or the pointer or focus leaving), for a trigger that carries a reason. */
  openOnClick?: boolean;
  /** A selector for an ancestor the tooltip must stay inside sideways (the panel), instead of the whole window. */
  within?: string;
}

interface Place {
  top: number;
  left: number;
  below: boolean;
}

/**
 * The one tooltip (D-F1-47), in place of the browser's `title` attribute. It shows after the pointer rests for 300 ms, or at
 * once on keyboard focus, and Esc closes it (the same Esc still reaches a dialog or panel, which closes too). It is a
 * `role="tooltip"` drawn in the shared overlay, so no card clips it; the trigger gets `aria-describedby` while it shows. It
 * rises 4 px and fades in over 120 ms and fades out over 80 ms (the movement is 0 for a person who asked for less motion).
 * It never delays anything: the wrapper only listens, and a press or a scroll closes it at once.
 *
 * The wrapper is a span around the trigger, so a disabled button (which gets no pointer events of its own) still has a tooltip.
 */
export function Tooltip({ text, children, block = false, openOnClick = false, within }: Props) {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mouseDown = useRef(false);
  const shownForKey = useRef(-1);
  const id = useId();
  const mounted = open || leaving;

  const stop = (): void => clearTimeout(timer.current);
  const hide = (): void => {
    stop();
    if (!open) return;
    setOpen(false);
    if (prefersReducedMotion()) return;
    setLeaving(true);
    timer.current = setTimeout(() => setLeaving(false), OUT_MS);
  };
  const show = (): void => {
    stop();
    setLeaving(false);
    setOpen(true);
  };

  // Above the trigger, or below it when there is no room, and inside the window sideways.
  useLayoutEffect(() => {
    if (!mounted || !wrap.current || !tip.current) return;
    const r = wrap.current.getBoundingClientRect();
    const t = tip.current.getBoundingClientRect();
    const centre = r.left + r.width / 2 - t.width / 2;
    // Inside the window, or inside the ancestor `within` names (the side panel), when there is one.
    const box = within ? wrap.current.closest(within)?.getBoundingClientRect() : undefined;
    const from = Math.max(MARGIN, (box?.left ?? 0) + (box ? GAP : 0));
    const to = Math.min(window.innerWidth - MARGIN, (box?.right ?? window.innerWidth) - (box ? GAP : 0));
    const left = Math.max(from, Math.min(centre, to - t.width));
    const below = r.top - t.height - GAP < MARGIN;
    setPlace({ top: below ? r.bottom + GAP : r.top - t.height - GAP, left, below });
  }, [mounted, text]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      hide(); // Esc closes the tooltip; it goes on to whatever else Esc closes (a dialog's close button has the focus when it opens, and shows its tooltip)
    };
    const onScroll = (): void => hide();
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  useEffect(() => stop, []);
  useEffect(() => {
    const closeNow = (): void => {
      stop();
      setOpen(false);
      setLeaving(false);
    };
    window.addEventListener(CLOSE_ALL, closeNow);
    return () => window.removeEventListener(CLOSE_ALL, closeNow);
  }, []);

  // The wrapper stays even with no text (the text comes and goes, as for a disabled button), so the trigger is never remounted.
  const on = !!text;

  return (
    <>
      <span
        ref={wrap}
        className={`tip-wrap ${block ? 'block' : ''}`}
        aria-describedby={open && on ? id : undefined}
        onMouseEnter={() => {
          stop();
          if (on && !open) timer.current = setTimeout(show, TOOLTIP_DELAY_MS);
        }}
        onMouseLeave={hide}
        onPointerDown={() => {
          mouseDown.current = true;
          hide();
        }}
        onPointerUp={() => {
          mouseDown.current = false;
        }}
        onClick={() => {
          if (openOnClick && on) show();
        }}
        onFocus={(event) => {
          // Focus that a click brought does not show it (the pointer already had its turn).
          if (mouseDown.current) {
            mouseDown.current = false;
            return;
          }
          // Keyboard focus shows it at once. Focus the app moved (a dialog opening, focus returning after Esc or Close, a heading with
          // tabindex -1 after a send) is not a keyboard stop: no tooltip (D-F1-81).
          const key = keyboardMovedFocus();
          if (on && key !== null && key !== shownForKey.current && (event.target as HTMLElement).getAttribute('tabindex') !== '-1') {
            shownForKey.current = key;
            show();
          }
        }}
        onBlur={hide}
      >
        {children}
      </span>
      {mounted &&
        on &&
        createPortal(
          <div
            id={id}
            ref={tip}
            role="tooltip"
            className={`tooltip ${place?.below ? 'below' : ''} ${leaving && !open ? 'leaving' : ''}`}
            style={{ top: place?.top ?? 0, left: place?.left ?? 0, maxWidth: Math.min(MAX_WIDTH, window.innerWidth - 2 * MARGIN), visibility: place ? 'visible' : 'hidden' }}
          >
            {text}
          </div>,
          overlayRoot(),
        )}
    </>
  );
}
