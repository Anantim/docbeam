import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A small yes/no question over the page. Esc and the overlay answer no. */
export function ConfirmDialog({ title, children, confirmLabel, cancelLabel, busy = false, onConfirm, onCancel }: Props) {
  const keep = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // The safe answer has the focus, so Enter by accident does not confirm.
    keep.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <>
      <div className="overlay" onClick={onCancel} />
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <div className="dialog-body">{children}</div>
        <div className="actions">
          <button ref={keep} className="btn2" type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className="btn danger" type="button" disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
