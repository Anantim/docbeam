import { useEffect, useRef, useState } from 'react';
import { CheckIcon, CopyIcon } from './Icons.js';

/** Says something in the toast corner. */
export type Notify = (text: string, kind?: 'ok' | 'error') => void;

interface Props {
  jobId: string;
  /** Only for a failure: a copy that works shows its own tick, with no toast (D-F1-43). */
  notify: Notify;
  /** `always` in the panel header; `reveal` in the list, where it shows on row hover and keyboard focus (D-F1-18). */
  show: 'always' | 'reveal';
  /** In the Tab order (default). A list row that is not its list's Tab stop sets false. */
  tabbable?: boolean;
}

/** The link that opens a distribution: this page's address with the full id. */
const distributionLink = (jobId: string): string => `${window.location.origin}/#/status/${jobId}`;

/** How long the green tick and "Copied" stay. */
export const COPIED_MS = 2000;

/**
 * A small copy icon that sits after a distribution's id. A click copies the link and, for 2 seconds, swaps the icon for a
 * green tick with a small "Copied" label; a screen reader is told "Link copied" through a polite live region. There is no
 * toast for a good copy. A click does not reach the row under it, so it never opens or closes the panel.
 */
export function CopyLinkButton({ jobId, notify, show, tabbable = true }: Props) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <span className="copy-wrap">
      <button
        type="button"
        tabIndex={tabbable ? 0 : -1}
        className={`icon small copy-link ${show} ${copied ? 'copied' : ''}`}
        aria-label="Copy link"
        title="Copy link"
        onClick={(e) => {
          e.stopPropagation();
          void navigator.clipboard
            ?.writeText(distributionLink(jobId))
            .then(() => {
              setCopied(true);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => setCopied(false), COPIED_MS);
            })
            .catch(() => notify('The link could not be copied.', 'error'));
        }}
      >
        {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
      </button>
      {copied && (
        <span className={`copied-label ${show === 'reveal' ? 'above' : ''}`} aria-hidden="true">
          Copied
        </span>
      )}
      <span className="sr" role="status" aria-live="polite">
        {copied ? 'Link copied' : ''}
      </span>
    </span>
  );
}
