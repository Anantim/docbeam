import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ALLOWED_FILE_TYPES } from '@docbeam/shared/browser';
import type { Rejected } from '../distribute/files.js';
import { UploadIcon } from './Icons.js';
import { Notice } from './Notice.js';
import { useMoreBelow } from './useMoreBelow.js';

const ACCEPT = ALLOWED_FILE_TYPES.flatMap((t) => t.extensions).join(',');

interface Props {
  onPick: (files: File[]) => void;
  rejected: Rejected[];
  /** Closes the whole "not added" box. */
  onDismiss: () => void;
  /** True when there is no file yet: the card is one big place to drop files. */
  empty: boolean;
  /** The documents table, shown when there are files. */
  children?: ReactNode;
  /** The "Filter…" box, in the card header beside "Add files". */
  tools?: ReactNode;
  /** Quiet words beside the title: "Showing 3 of 40" while the list is filtered. */
  hint?: string;
}

/**
 * The Files card: the one place to add files. Drop them anywhere on the card, or choose them. With no file it is a
 * drop area (the empty state); with files it holds the table and an "Add files" button in its header.
 */
export function AddFiles({ onPick, rejected, onDismiss, empty, children, tools, hint }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const notice = useRef<HTMLDivElement>(null);
  // When the box gains an entry and is out of view (the list is scrolled), it scrolls into view, smoothly.
  const shown = useRef(0);
  useEffect(() => {
    if (rejected.length > shown.current) notice.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    shown.current = rejected.length;
  }, [rejected.length]);
  const [over, setOver] = useState(false);
  const { ref: scroll, more } = useMoreBelow<HTMLDivElement>();

  return (
    <section
      className={`card files ${over ? 'over' : ''}`}
      aria-label="Documents"
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onPick(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="card-head">
        <h2>Files</h2>
        {hint && (
          <span className="card-hint" role="status">
            {hint}
          </span>
        )}
        {/* The "Filter…" box is always here, and off while there is no file; "Add files" comes with the first file (the drop
            area has its own "choose files"). Both are as tall as every other control (D-F1-77). */}
        <span className="files-head-tools">
          {tools}
          {!empty && (
            <button className="btn2" type="button" onClick={() => input.current?.click()}>
              Add files
            </button>
          )}
        </span>
      </div>
      <div className={`files-wrap fadewrap ${more ? 'more-below' : ''}`}>
      <div className="files-scroll" ref={scroll}>
      {rejected.length > 0 && (
        // The one note style (D-F1-78): the file name in normal text and the reason muted, the newest at the bottom. One button
        // closes the whole box; it stays until it is closed or the page is cleared (D-F1-35). A file with malware is added here
        // too, and the box scrolls into view when it gains an entry.
        <Notice ref={notice} className="in-card" heading={`${rejected.length} ${rejected.length === 1 ? 'file' : 'files'} not added.`} onClose={onDismiss}>
          <ul className="notice-list">
            {rejected.map((r, i) => (
              <li key={`${r.name}-${i}`}>
                <span className="notice-name">{r.name}</span> <span className="notice-detail">{r.reason}</span>
              </li>
            ))}
          </ul>
        </Notice>
      )}
      {empty ? (
        <div className="state drop-state">
          <span className="state-icon" aria-hidden="true">
            <UploadIcon size={20} />
          </span>
          <strong>Drop files here</strong>
          <span>
            or{' '}
            <button className="link strong" type="button" onClick={() => input.current?.click()}>
              choose files
            </button>
          </span>
          <span className="lead">PDF, DOCX, XLSX, PNG, JPG. Up to 100 files, 1 GB each.</span>
        </div>
      ) : (
        children
      )}
      </div>
      </div>
      <input
        ref={input}
        className="sr"
        type="file"
        multiple
        accept={ACCEPT}
        aria-label="Choose files"
        onChange={(e) => {
          onPick(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
    </section>
  );
}
