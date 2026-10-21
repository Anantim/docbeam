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

interface Props {
  /** What it says. Nothing (undefined or empty) means no tooltip and no wrapper. */
  text: string | undefined;
  children: ReactNode;
  /** The wrapper is a block (for a cut-off line of text) and not an inline box. */
  block?: boolean;
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
export function Tooltip({ text, children, block = false }: Props) {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mouseDown = useRef(false);
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
    const left = Math.max(MARGIN, Math.min(centre, window.innerWidth - t.width - MARGIN));
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
        onFocus={(event) => {
          // Keyboard focus shows it at once; focus that a click brought does not (the pointer already had its turn).
          if (mouseDown.current) {
            mouseDown.current = false;
            return;
          }
          // Something the code focuses (a heading with tabindex -1, where the focus lands after a send) is not a keyboard stop: no tooltip.
          if (on && (event.target as HTMLElement).getAttribute('tabindex') !== '-1') show();
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
