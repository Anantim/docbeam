import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  /** What the button shows, for example "+3". */
  label: string;
  /** What a screen reader says for the button, for example "Show 3 more folders". */
  ariaLabel: string;
  /** Accessible name of the opened panel. */
  panelLabel: string;
  className?: string;
  children: ReactNode;
}

const OPEN_MARGIN = 4;
const PANEL_WIDTH = 280;
const LEAVE_DELAY_MS = 120;

/**
 * A small popover for a "+N" chip, in place of a native `title`. No library.
 *  - Hover or click opens it. A click keeps it open, another click closes it.
 *  - Esc, a click outside, scrolling, or Tab moving focus out of it closes it.
 *  - It is a button, so the keyboard reaches it; the panel's list scrolls by keyboard too.
 * The panel is `position: fixed`, so a table with its own scrolling cannot clip it.
 */
export function Popover({ label, ariaLabel, panelLabel, className = '', children }: Props) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const leave = useRef<ReturnType<typeof setTimeout>>(undefined);
  const panelId = useId();
  const open = hover || pinned;

  const close = (): void => {
    clearTimeout(leave.current);
    setHover(false);
    setPinned(false);
  };

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const r = button.current.getBoundingClientRect();
    setPos({ top: r.bottom + OPEN_MARGIN, left: Math.max(8, Math.min(r.left, window.innerWidth - PANEL_WIDTH - 8)) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent): void => {
      if (!wrap.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  useEffect(() => () => clearTimeout(leave.current), []);

  return (
    <span
      className="popover"
      ref={wrap}
      onMouseEnter={() => {
        clearTimeout(leave.current);
        setHover(true);
      }}
      onMouseLeave={() => {
        // A short delay lets the pointer cross the gap between the button and the panel.
        leave.current = setTimeout(() => setHover(false), LEAVE_DELAY_MS);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          close();
          button.current?.focus();
        }
      }}
      onBlur={(event) => {
        if (!wrap.current?.contains(event.relatedTarget as Node | null)) close();
      }}
    >
      <button
        ref={button}
        type="button"
        className={className}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          if (pinned) close();
          else setPinned(true);
        }}
      >
        {label}
      </button>
      {open && (
        <div id={panelId} className="popover-panel" role="dialog" aria-label={panelLabel} style={{ top: pos.top, left: pos.left, width: PANEL_WIDTH }}>
          {children}
        </div>
      )}
    </span>
  );
}
