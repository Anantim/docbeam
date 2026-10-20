import { typeLabel } from '../distribute/files.js';

/** PDF, DOCX, XLSX, PNG or JPG as plain text in a neutral tag: colour is kept for status (D-F1-5). */
export function TypeBadge({ contentType, big = false }: { contentType: string; big?: boolean }) {
  const label = typeLabel(contentType);
  return (
    <span className={`typetile ${big ? 'big' : ''}`}>
      {label}
    </span>
  );
}
