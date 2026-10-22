import { forwardRef, type ReactNode } from 'react';
import { AlertIcon, CloseIcon, InfoIcon } from './Icons.js';
import { Tooltip } from './Tooltip.js';

interface Props {
  /** `error` (the default) is a problem and is announced at once; `info` is a quiet note. */
  tone?: 'error' | 'info';
  /** The short bold first line. */
  heading: string;
  /** What else there is to say, in muted text under the first line. */
  detail?: ReactNode;
  /** More under the detail, for example the list of files that were not added. */
  children?: ReactNode;
  /** "Try again", as a link after the message, wherever a load failed. */
  onRetry?: () => void;
  /** The small Close icon, where the note can be closed. */
  onClose?: () => void;
  /** Spacing from the box it sits in. */
  className?: string;
}

/**
 * The one in-page note (D-F1-78): an alert or info icon, a short bold first line, an optional muted detail, and a 3 px coloured
 * edge on the left. Every error and every message that sits in a page, a card or a dialog is this, so they cannot drift apart.
 * An error is `role="alert"`, an info note `role="status"`. Toasts are not notes. "Try again" and Close are the same everywhere.
 */
export const Notice = forwardRef<HTMLDivElement, Props>(function Notice({ tone = 'error', heading, detail, children, onRetry, onClose, className = '' }, ref) {
  return (
    <div ref={ref} className={`notice ${tone} ${className}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span className="notice-icon" aria-hidden="true">
        {tone === 'error' ? <AlertIcon size={16} /> : <InfoIcon size={16} />}
      </span>
      <div className="notice-body">
        <strong>{heading}</strong>
        {detail !== undefined && <span className="notice-detail">{detail}</span>}
        {children}
        {onRetry && (
          <button className="link notice-retry" type="button" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
      {onClose && (
        <Tooltip text="Close">
          {/* The tooltip says "Close"; the screen-reader name says which note, so it is not confused with the panel's Close (D-F1-81). */}
          <button className="icon small" type="button" aria-label={`Close note: ${heading}`} onClick={onClose}>
            <CloseIcon />
          </button>
        </Tooltip>
      )}
    </div>
  );
});
