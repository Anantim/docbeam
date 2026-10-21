import { typeLabel } from '../distribute/files.js';
import { Tooltip } from './Tooltip.js';

/** PDF, DOCX, XLSX, PNG or JPG as plain text in a neutral tag: colour is kept for status (D-F1-5). The tooltip says where the type comes from (D-F1-71). */
export function TypeBadge({ contentType, big = false }: { contentType: string; big?: boolean }) {
  const label = typeLabel(contentType);
  return (
    <Tooltip text="Type read from the file's contents">
      <span className={big ? 'typetile big' : 'typetile'}>{label}</span>
    </Tooltip>
  );
}
