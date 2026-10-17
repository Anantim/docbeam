import { typeLabel } from '../distribute/files.js';
import { TYPE_COLOURS } from '../fileTypes.js';

/** PDF, DOCX, XLSX, PNG or JPG, coloured by type. The text stays, so colour is never the only signal. */
export function TypeBadge({ contentType, big = false }: { contentType: string; big?: boolean }) {
  const label = typeLabel(contentType);
  const c = TYPE_COLOURS[label];
  return (
    <span className={`typetile ${big ? 'big' : ''}`} data-type={label} style={{ background: c.bg, color: c.fg }}>
      {label}
    </span>
  );
}
