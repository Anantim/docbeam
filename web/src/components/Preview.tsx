import { useEffect, useState } from 'react';
import { typeLabel } from '../distribute/files.js';
import { docxSrcdoc, xlsxSheets } from '../preview/office.js';
import { sheetHtml, type SheetModel } from '../preview/render.js';

/** DOCX and XLSX are rendered in the page, so a very large one would freeze the tab (D-M2-20). */
export const OFFICE_PREVIEW_MAX_BYTES = 50 * 1024 ** 2;

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type View =
  | { kind: 'loading' }
  | { kind: 'pdf'; url: string }
  | { kind: 'image'; url: string }
  | { kind: 'docx'; srcdoc: string }
  | { kind: 'xlsx'; sheets: SheetModel[] }
  | { kind: 'message'; text: string };

interface Props {
  name: string;
  contentType: string;
  sizeBytes: number;
  /** The bytes to show: the copy already in the browser (before Send) or a downloaded one (M4). */
  blob: Blob;
  /** For example "PDF, 1.2 MB, not sent yet". */
  meta: string;
  note: string;
  onClose: () => void;
}

/**
 * The preview dialog of the mockup. PDFs open in the browser's own viewer and images in an `img`. DOCX and XLSX are
 * turned into HTML here and shown in an iframe with `sandbox=""` (no scripts, no same origin) through `srcdoc`, so a
 * file that someone else sent can never run code in this page.
 */
export function Preview({ name, contentType, sizeBytes, blob, meta, note, onClose }: Props) {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [sheet, setSheet] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let url: string | undefined;
    const show = (v: View) => !cancelled && setView(v);
    const fail = () => show({ kind: 'message', text: 'This file could not be shown. It may be damaged.' });

    const isOffice = contentType === DOCX || contentType === XLSX;
    if (isOffice && sizeBytes > OFFICE_PREVIEW_MAX_BYTES) {
      show({ kind: 'message', text: 'This file is too large to show in the page. It is still sent as it is.' });
    } else if (contentType === DOCX) {
      docxSrcdoc(blob).then((srcdoc) => show({ kind: 'docx', srcdoc }), fail);
    } else if (contentType === XLSX) {
      xlsxSheets(blob).then((sheets) => show({ kind: 'xlsx', sheets }), fail);
    } else {
      url = URL.createObjectURL(blob);
      show({ kind: contentType === 'application/pdf' ? 'pdf' : 'image', url });
    }
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [blob, contentType, sizeBytes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sheets = view.kind === 'xlsx' ? view.sheets : [];
  const current = sheets[sheet];

  return (
    <>
      <div className="overlay preview-overlay" onClick={onClose} />
      <div className="preview" role="dialog" aria-modal="true" aria-label="File preview">
        <div className="preview-head">
          <span className="typetile big">{typeLabel(contentType)}</span>
          <div className="grow">
            <div className="pv-name">{name}</div>
            <div className="pv-meta">{meta}</div>
          </div>
          {sheets.length > 1 && (
            <select aria-label="Sheet" className="field sheet-pick" value={sheet} onChange={(e) => setSheet(Number(e.target.value))}>
              {sheets.map((s, i) => (
                <option key={s.name} value={i}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <button className="icon" type="button" aria-label="Close preview" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="preview-body">
          {view.kind === 'loading' && <div className="pv-message">Opening the file…</div>}
          {view.kind === 'message' && <div className="pv-message">{view.text}</div>}
          {view.kind === 'pdf' && <iframe className="pv-frame" title={`Preview of ${name}`} src={view.url} />}
          {view.kind === 'image' && <img className="pv-image" alt={name} src={view.url} />}
          {view.kind === 'docx' && <iframe className="pv-frame" title={`Preview of ${name}`} sandbox="" srcDoc={view.srcdoc} />}
          {view.kind === 'xlsx' && current && <iframe className="pv-frame" title={`Preview of ${name}`} sandbox="" srcDoc={sheetHtml(current)} />}
        </div>
        <div className="preview-note">🔒 {note}</div>
      </div>
    </>
  );
}
