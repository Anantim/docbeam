import { useEffect, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps Tab and Shift+Tab inside a dialog while it is open, and gives focus back to what had it before the dialog
 * opened (D-F1-9). While a dialog is open the page behind it does not scroll (D-F1-14). Escape is handled by each
 * dialog, which knows what "no" means for it.
 */
export function useFocusTrap(box: RefObject<HTMLElement | null>, initial?: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    initial?.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab' || !box.current) return;
      const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0] as HTMLElement;
      const last = items[items.length - 1] as HTMLElement;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !box.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !box.current.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      // Back to what opened it; if that is gone (the dialog was the question before Send, which clears the page), the page heading.
      // A button that is off now (Send, after the page was cleared) cannot take the focus either.
      const usable = before && document.contains(before) && before !== document.body && !(before as HTMLButtonElement).disabled;
      if (usable) before.focus();
      else focusPageHeading();
    };
  }, [box, initial]);
}

/** The first heading that is not hidden, which is the screen that shows, where the focus goes when what had it has left the page (D-F1-78). */
export function focusPageHeading(): void {
  const heading = [...document.querySelectorAll<HTMLElement>('h1')].find((h) => !h.closest('[hidden]'));
  if (!heading) return;
  heading.tabIndex = -1;
  heading.focus();
}
