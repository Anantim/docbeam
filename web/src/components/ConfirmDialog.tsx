import { useEffect, useRef, type ReactNode } from 'react';
import { useFocusTrap } from './useFocusTrap.js';

interface Props {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  /** The look of the confirm button: the one main action, or a risky one. */
  tone?: 'primary' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A small yes/no question over the page. Esc and the overlay answer no, and so does Enter: the focus starts on the safe answer. */
export function ConfirmDialog({ title, children, confirmLabel, cancelLabel, tone = 'danger', busy = false, onConfirm, onCancel }: Props) {
  const keep = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useFocusTrap(box);

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
      <div ref={box} className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <div className="dialog-body">{children}</div>
        <div className="actions">
          <button ref={keep} className="btn2" type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className={tone === 'danger' ? 'btn danger' : 'btn'} type="button" disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
