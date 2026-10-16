import { useRef, useState } from 'react';
import { ALLOWED_FILE_TYPES } from '@docbeam/shared/browser';
import type { Rejected } from '../distribute/files.js';

const ACCEPT = ALLOWED_FILE_TYPES.flatMap((t) => t.extensions).join(',');

interface Props {
  onPick: (files: File[]) => void;
  rejected: Rejected[];
  onDismiss: (name?: string) => void;
}

/** The "Add files" card: click to browse or drag files here, with the "Not added" list under it. */
export function AddFiles({ onPick, rejected, onDismiss }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div className="card add-files">
      <h2>Add files</h2>
      <div
        className={`drop ${over ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          onPick(Array.from(e.dataTransfer.files));
        }}
      >
        <span className="drop-icon" aria-hidden="true">
          ⬆
        </span>
        <div>
          <button className="link strong" type="button" onClick={() => input.current?.click()}>
            Click to browse
          </button>{' '}
          or drag files here
        </div>
        <div className="hint">PDF, DOCX, XLSX, PNG, JPG. Up to 100 files, 1 GB each.</div>
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
      </div>
      {rejected.length > 0 && (
        <div className="alert not-added" role="alert">
          <div className="not-added-head">
            <strong>Not added</strong>
            <button className="icon small" type="button" aria-label="Dismiss all" onClick={() => onDismiss()}>
              ✕
            </button>
          </div>
          {rejected.map((r, i) => (
            <div className="not-added-row" key={`${r.name}-${i}`}>
              <span>
                <span className="mono">{r.name}</span>: {r.reason}
              </span>
              <button className="icon small" type="button" aria-label={`Dismiss ${r.name}`} onClick={() => onDismiss(r.name)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
