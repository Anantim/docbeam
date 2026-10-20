import { useEffect, useRef, useState } from 'react';
import { useFocusTrap } from './useFocusTrap.js';
import { CloseIcon, LockIcon } from './Icons.js';
import { TypeBadge } from './TypeBadge.js';
import { docxSrcdoc, xlsxSheets } from '../preview/office.js';
import { sheetHtml, type SheetModel } from '../preview/render.js';

/** DOCX and XLSX are rendered in the page, so a very large one would freeze the tab (D-M2-20). */
export const OFFICE_PREVIEW_MAX_BYTES = 50 * 1024 ** 2;

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Reads the stored file from its link. The Object Store's CORS rule allows GET from this site. */
async function fetchBlob(url: string | undefined): Promise<Blob> {
  if (!url) throw new Error('No file to show.');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`The file could not be read (${res.status}).`);
  return res.blob();
}

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
  /** The copy already in the browser (before Send). Give this or `url`. */
  blob?: Blob;
  /** A 2-minute inline link to the stored file (M4). PDF and images open from it; DOCX and XLSX are fetched from it. */
  url?: string;
  /** Under the name: the size, for example "1.2 MB". */
  meta: string;
  /** A line under the file, for a file that was sent. Before Send there is none, and the header holds the name and the size only (D-F1-23, D-F1-27). */
  note?: string;
  onClose: () => void;
}

/**
 * The preview dialog of the mockup. PDFs open in the browser's own viewer and images in an `img`. DOCX and XLSX are
 * turned into HTML here and shown in an iframe with `sandbox=""` (no scripts, no same origin) through `srcdoc`, so a
 * file that someone else sent can never run code in this page.
 */
export function Preview({ name, contentType, sizeBytes, blob, url: link, meta, note, onClose }: Props) {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [sheet, setSheet] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let url: string | undefined;
    const show = (v: View) => !cancelled && setView(v);
    const fail = () => show({ kind: 'message', text: 'This file could not be shown. It may be damaged.' });

    const isOffice = contentType === DOCX || contentType === XLSX;
    if (isOffice && sizeBytes > OFFICE_PREVIEW_MAX_BYTES) {
      show({
        kind: 'message',
        text: blob ? 'This file is too large to show in the page. It is still sent as it is.' : 'This file is too large to show in the page. Download it to open it.',
      });
    } else if (isOffice) {
      const bytes = blob ? Promise.resolve(blob) : fetchBlob(link);
      bytes
        .then((b) => (contentType === DOCX ? docxSrcdoc(b).then((srcdoc) => show({ kind: 'docx', srcdoc })) : xlsxSheets(b).then((sheets) => show({ kind: 'xlsx', sheets }))))
        .catch(fail);
    } else {
      if (blob) url = URL.createObjectURL(blob);
      const src = url ?? link;
      if (src) show({ kind: contentType === 'application/pdf' ? 'pdf' : 'image', url: src });
      else fail();
    }
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [blob, link, contentType, sizeBytes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const box = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useFocusTrap(box, closeButton);
  const sheets = view.kind === 'xlsx' ? view.sheets : [];
  const current = sheets[sheet];

  return (
    <>
      <div className="overlay preview-overlay" onClick={onClose} />
      <div ref={box} className="preview" role="dialog" aria-modal="true" aria-label="File preview">
        <div className="preview-head">
          <TypeBadge contentType={contentType} big />
          <div className="grow">
            <div className="pv-name" title={name}>
              {name}
            </div>
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
          <button ref={closeButton} className="icon" type="button" aria-label="Close preview" title="Close preview" onClick={onClose}>
            <CloseIcon />
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
        {note && (
          <div className="preview-note">
            <LockIcon size={14} />
            {note}
          </div>
        )}
      </div>
    </>
  );
}
