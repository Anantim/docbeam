import { CopyIcon } from './Icons.js';

/** Says something in the toast corner. */
export type Notify = (text: string, kind?: 'ok' | 'error') => void;

interface Props {
  jobId: string;
  notify: Notify;
  /** `always` in the panel header; `reveal` in the list, where it shows on row hover and keyboard focus (D-F1-18). */
  show: 'always' | 'reveal';
}

/** The link that opens a distribution: this page's address with the full id. */
const distributionLink = (jobId: string): string => `${window.location.origin}/#/status/${jobId}`;

/**
 * A small copy icon that sits after a distribution's id. It copies the link and says so in the toast; a click does not
 * reach the row under it, so it never opens or closes the panel.
 */
export function CopyLinkButton({ jobId, notify, show }: Props) {
  return (
    <button
      type="button"
      className={`icon small copy-link ${show}`}
      aria-label="Copy link"
      title="Copy link"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard
          ?.writeText(distributionLink(jobId))
          .then(() => notify('Link copied.'))
          .catch(() => notify('The link could not be copied.', 'error'));
      }}
    >
      <CopyIcon size={14} />
    </button>
  );
}
