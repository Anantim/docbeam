import { useEffect, useRef, useState } from 'react';
import { shortId } from '../tracking/format.js';
import { CheckIcon, CopyIcon } from './Icons.js';
import { Tooltip } from './Tooltip.js';

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

/** How long the green tick stays. */
export const COPIED_MS = 2000;

/**
 * A small copy icon that sits after a distribution's id. A click copies the link and, for 2 seconds, cross-fades the icon to
 * a green tick (no visible label, D-F1-51); a screen reader is told "Link copied" through a polite live region that is always
 * there. There is no toast for a good copy. A click does not reach the row under it, so it never opens or closes the panel.
 */
export function CopyLinkButton({ jobId, notify, show, tabbable = true }: Props) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <span className="copy-wrap">
      <Tooltip text="Copy link">
      <button
        type="button"
        tabIndex={tabbable ? 0 : -1}
        className={`icon small copy-link ${show} ${copied ? 'copied' : ''}`}
        aria-label={`Copy link to ${shortId(jobId)}`}
        onClick={(e) => {
          e.stopPropagation();
          void navigator.clipboard
            ?.writeText(distributionLink(jobId))
            .then(() => {
              setCopied(true);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => setCopied(false), COPIED_MS);
            })
            .catch(() => notify("The link couldn't be copied.", 'error'));
        }}
      >
        {/* Both icons are always there and cross-fade over 120 ms (D-F1-47). */}
        <span className={`copy-icons ${copied ? 'on' : ''}`}>
          <span className="copy" style={{ display: 'contents' }}>
            <CopyIcon size={14} />
          </span>
          <span className="tick" style={{ display: 'contents' }}>
            <CheckIcon size={14} />
          </span>
        </span>
      </button>
      </Tooltip>
      <span className="sr" role="status" aria-live="polite">
        {copied ? 'Link copied' : ''}
      </span>
    </span>
  );
}
