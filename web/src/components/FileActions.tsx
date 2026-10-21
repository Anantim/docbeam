import { DownloadIcon, EyeIcon } from './Icons.js';
import { Tooltip } from './Tooltip.js';

// Preview (an eye) and Download (an arrow) as icon buttons, the same on Distribute and on Status (D-M3-12).
// An icon-only button has an aria-label and a tooltip with the same text (D-M3-10, D-F1-47). A button that is off puts
// the reason in that text.

interface Props {
  /** What it acts on, for example the file name. */
  name: string;
  /** Set when the button is off: the plain-English reason. */
  offBecause?: string;
  onClick?: () => void;
  small?: boolean;
}

export function PreviewButton({ name, offBecause, onClick, small = false }: Props) {
  const label = offBecause ? `Preview ${name}. ${offBecause}` : `Preview ${name}`;
  return (
    <Tooltip text={label}>
      <button className={`icon ${small ? 'small' : ''}`} type="button" aria-label={label} disabled={!!offBecause} onClick={onClick}>
        <EyeIcon />
      </button>
    </Tooltip>
  );
}

export function DownloadButton({ name, offBecause, onClick, small = false }: Props) {
  const label = offBecause ? `Download ${name}. ${offBecause}` : `Download ${name}`;
  return (
    <Tooltip text={label}>
      <button className={`icon ${small ? 'small' : ''}`} type="button" aria-label={label} disabled={!!offBecause} onClick={onClick}>
        <DownloadIcon />
      </button>
    </Tooltip>
  );
}
