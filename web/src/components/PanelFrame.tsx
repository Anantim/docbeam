import type { ReactNode } from 'react';

interface Props {
  label: string;
  onClose: () => void;
  children: ReactNode;
}

/** The side panel's box. Escape closes it while focus is inside, unless a dialog (a preview, a question, a popover) is open: that one takes the Escape. */
export function PanelFrame({ label, onClose, children }: Props) {
  return (
    <aside
      className="card panel"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) onClose();
      }}
    >
      {children}
    </aside>
  );
}
