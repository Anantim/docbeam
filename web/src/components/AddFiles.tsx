import { useRef, useState, type ReactNode } from 'react';
import { ALLOWED_FILE_TYPES } from '@docbeam/shared/browser';
import type { Rejected } from '../distribute/files.js';
import { AlertIcon, CloseIcon, UploadIcon } from './Icons.js';
import { Tooltip } from './Tooltip.js';
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
        {!empty && (
          <span className="files-head-tools">
            {tools}
            <button className="btn2 btnsm" type="button" onClick={() => input.current?.click()}>
              Add files
            </button>
          </span>
        )}
      </div>
      <div className={`files-wrap fadewrap ${more ? 'more-below' : ''}`}>
      <div className="files-scroll" ref={scroll}>
      {rejected.length > 0 && (
        // Calm: a light box with an error-coloured edge and icon, the file name in normal text and the reason muted. One
        // button closes the whole box; it stays until it is closed or the page is cleared (D-F1-35).
        <div className="not-added" role="alert">
          <span className="not-added-icon" aria-hidden="true">
            <AlertIcon size={16} />
          </span>
          <div className="not-added-body">
            <strong>
              {rejected.length} {rejected.length === 1 ? 'file' : 'files'} not added
            </strong>
            <ul>
              {rejected.map((r, i) => (
                <li key={`${r.name}-${i}`}>
                  <span className="not-added-name">{r.name}</span> <span className="not-added-reason">{r.reason}</span>
                </li>
              ))}
            </ul>
          </div>
          <Tooltip text="Close">
            <button className="icon small" type="button" aria-label="Close" onClick={onDismiss}>
              <CloseIcon />
            </button>
          </Tooltip>
        </div>
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
