// Preview (an eye) and Download (an arrow) as icon buttons, the same on Distribute and on Status (D-M3-12).
// An icon-only button has an aria-label and a title with the same text (D-M3-10). A button that is off puts
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
    <button className={`icon ${small ? 'small' : ''}`} type="button" aria-label={label} title={label} disabled={!!offBecause} onClick={onClick}>
      👁
    </button>
  );
}

export function DownloadButton({ name, offBecause, onClick, small = false }: Props) {
  const label = offBecause ? `Download ${name}. ${offBecause}` : `Download ${name}`;
  return (
    <button className={`icon ${small ? 'small' : ''}`} type="button" aria-label={label} title={label} disabled={!!offBecause} onClick={onClick}>
      ⬇
    </button>
  );
}

/** Why Preview and Download are off on the Status page until the next release. */
export const NOT_YET = 'Preview and download arrive in the next milestone';
