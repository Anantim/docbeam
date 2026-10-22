import { useEffect, useRef, useState } from 'react';
import { CloseIcon } from './Icons.js';
import { Tooltip } from './Tooltip.js';

export interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'error';
}

/** A success toast fades after this long. An error toast stays until it is closed (D-F1-81). */
export const TOAST_MS = 4000;
/** At most this many toasts are on screen; the oldest goes first. */
export const TOAST_MAX = 3;

/** The list after a new toast: the newest 3. */
export const addToast = (toasts: Toast[], toast: Toast): Toast[] => [...toasts, toast].slice(-TOAST_MAX);

function ToastItem({ toast, onClose }: { toast: Toast; onClose: (id: number) => void }) {
  const [held, setHeld] = useState(false);
  // How long a success toast still has to stay: the clock stops while the pointer is over it or it has the focus, and carries on from where it was.
  const left = useRef(TOAST_MS);
  useEffect(() => {
    if (toast.kind === 'error' || held) return;
    const startedAt = Date.now();
    const timer = setTimeout(() => onClose(toast.id), left.current);
    return () => {
      clearTimeout(timer);
      left.current = Math.max(0, left.current - (Date.now() - startedAt));
    };
  }, [toast.kind, toast.id, held, onClose]);
  return (
    <div
      className={`toast ${toast.kind === 'error' ? 'error' : ''}`}
      role={toast.kind === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <i />
      <span className="toast-text">{toast.text}</span>
      {toast.kind === 'error' && (
        <Tooltip text="Close">
          <button className="icon small toast-close" type="button" aria-label={`Close message: ${toast.text}`} onClick={() => onClose(toast.id)}>
            <CloseIcon />
          </button>
        </Tooltip>
      )}
    </div>
  );
}

export function Toasts({ toasts, onClose }: { toasts: Toast[]; onClose: (id: number) => void }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onClose={onClose} />
      ))}
    </div>
  );
}
