import { useRef, useState, type ReactNode } from 'react';
import { ALLOWED_FILE_TYPES } from '@docbeam/shared/browser';
import type { Rejected } from '../distribute/files.js';
import { CloseIcon, UploadIcon } from './Icons.js';

const ACCEPT = ALLOWED_FILE_TYPES.flatMap((t) => t.extensions).join(',');

interface Props {
  onPick: (files: File[]) => void;
  rejected: Rejected[];
  onDismiss: (name?: string) => void;
  /** True when there is no file yet: the card is one big place to drop files. */
  empty: boolean;
  /** The documents table, shown when there are files. */
  children?: ReactNode;
}

/**
 * The Files card: the one place to add files. Drop them anywhere on the card, or choose them. With no file it is a
 * drop area (the empty state); with files it holds the table and an "Add files" button in its header.
 */
export function AddFiles({ onPick, rejected, onDismiss, empty, children }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

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
        {!empty && (
          <button className="btn2 btnsm" type="button" onClick={() => input.current?.click()}>
            Add files
          </button>
        )}
      </div>
      {rejected.length > 0 && (
        <div className="alert not-added" role="alert">
          <div className="not-added-head">
            <strong>Not added</strong>
            <button className="icon small" type="button" aria-label="Dismiss all" title="Dismiss all" onClick={() => onDismiss()}>
              <CloseIcon />
            </button>
          </div>
          {rejected.map((r, i) => (
            <div className="not-added-row" key={`${r.name}-${i}`}>
              <span>
                <span className="mono">{r.name}</span>: {r.reason}
              </span>
              <button className="icon small" type="button" aria-label={`Dismiss ${r.name}`} title={`Dismiss ${r.name}`} onClick={() => onDismiss(r.name)}>
                <CloseIcon />
              </button>
            </div>
          ))}
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
