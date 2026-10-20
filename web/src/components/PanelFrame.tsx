import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  label: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * The side panel's box. Escape closes it wherever the focus is on the page (a click on the list leaves the focus there),
 * unless a dialog (a preview, a question) is open or something inside has already taken the Escape (a popover, the Open by ID card).
 */
export function PanelFrame({ label, onClose, children }: Props) {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[role="dialog"]')) return;
      close.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <aside className="card panel" aria-label={label}>
      {children}
    </aside>
  );
}
