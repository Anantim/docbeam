import { useState } from 'react';
import { isUsable, type Mapping } from '../distribute/mapping.js';
import { DestinationChips } from './DestinationChips.js';
import { formatSize, typeLabel } from '../distribute/files.js';
import type { PageFile } from '../upload/manager.js';

interface StatusView {
  text: string;
  tone: 'idle' | 'busy' | 'warn' | 'ok' | 'bad';
  bar: boolean;
}

export function statusView(f: PageFile): StatusView {
  const pct = Math.round(f.progress * 100);
  switch (f.status) {
    case 'hashing':
      return { text: pct > 0 ? `Preparing ${pct}%` : 'Preparing', tone: 'idle', bar: false };
    case 'waiting':
      return { text: 'Waiting to upload', tone: 'idle', bar: false };
    case 'uploading':
      return { text: f.partCount > 0 ? `Uploading parts ${f.partsDone}/${f.partCount}` : `Uploading ${pct}%`, tone: 'busy', bar: true };
    case 'checking':
      return { text: 'Checking for malware', tone: 'warn', bar: false };
    case 'verified':
      return { text: 'Verified', tone: 'ok', bar: false };
    case 'refused':
      return { text: 'Refused by storage', tone: 'bad', bar: false };
    case 'interrupted':
      return { text: 'Upload interrupted', tone: 'bad', bar: false };
    case 'unchecked':
      return { text: 'Refused: could not be checked', tone: 'bad', bar: false };
    case 'infected':
      return { text: 'Refused: malware found', tone: 'bad', bar: false };
  }
}

const COLUMNS = [
  { key: 'name', label: 'Name', width: 260 },
  { key: 'dest', label: 'Destinations', width: 220 },
  { key: 'status', label: 'Status', width: 190 },
  { key: 'size', label: 'Size', width: 80 },
] as const;

interface Props {
  files: readonly PageFile[];
  mapping: Mapping;
  selected: ReadonlySet<string>;
  onToggleSelected: (id: string) => void;
  onToggleAll: () => void;
  onOnly: (id: string) => void;
  onPreview: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}

/** The Documents table. Column widths can be dragged, or changed with the arrow keys; a double click resets them. */
export function FileTable({ files, mapping, selected, onToggleSelected, onToggleAll, onOnly, onPreview, onRetry, onRemove }: Props) {
  const [widths, setWidths] = useState<number[]>(COLUMNS.map((c) => c.width));
  const grid = `32px ${widths.map((w) => `${w}px`).join(' ')} minmax(84px, 1fr)`;
  const usable = files.filter(isUsable);
  const allOn = usable.length > 0 && usable.every((f) => selected.has(f.id));
  const someOn = !allOn && usable.some((f) => selected.has(f.id));

  const resize = (index: number, next: number) =>
    setWidths((w) => w.map((x, i) => (i === index ? Math.max(64, Math.min(700, Math.round(next))) : x)));
  const startDrag = (index: number, event: React.MouseEvent) => {
    event.preventDefault();
    const x0 = event.clientX;
    const w0 = widths[index] ?? 0;
    const move = (e: MouseEvent) => resize(index, w0 + e.clientX - x0);
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div className="table-scroll">
      <div className="ftable" role="table" aria-label="Documents">
        <div className="frow thead" role="row" style={{ gridTemplateColumns: grid }}>
          <button
            className="ck"
            type="button"
            role="checkbox"
            aria-checked={someOn ? 'mixed' : allOn}
            aria-label="Select all files"
            onClick={onToggleAll}
          >
            <span className={`box ${someOn ? 'mixed' : ''}`}>{allOn ? '✓' : someOn ? '–' : ''}</span>
          </button>
          {COLUMNS.map((c, i) => (
            <div className={`hcell ${c.key === 'size' ? 'right' : ''}`} role="columnheader" key={c.key}>
              {c.label}
              <span
                className="rsz"
                role="separator"
                aria-orientation="vertical"
                aria-label={`Resize the ${c.label} column`}
                title="Drag to resize, double-click to reset"
                tabIndex={0}
                onMouseDown={(e) => startDrag(i, e)}
                onDoubleClick={() => resize(i, c.width)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft') resize(i, (widths[i] ?? c.width) - 16);
                  if (e.key === 'ArrowRight') resize(i, (widths[i] ?? c.width) + 16);
                }}
              />
            </div>
          ))}
          <div className="hcell right" role="columnheader">
            Actions
          </div>
        </div>

        {files.map((f) => {
          const view = statusView(f);
          const keys = isUsable(f) ? (mapping.files[f.id] ?? []) : [];
          const paths = keys.map((k) => mapping.destinations[k]?.path ?? '');
          const on = selected.has(f.id);
          const infected = f.status === 'infected';
          const canRetry = f.status === 'refused' || f.status === 'interrupted' || f.status === 'unchecked';
          return (
            <div className={`frow ${on ? 'sel' : ''}`} role="row" key={f.id} style={{ gridTemplateColumns: grid }}>
              {infected ? (
                <span className="ck locked" role="img" aria-label={`${f.name} was refused for malware and cannot be selected or sent`} title="Refused for malware: cannot be selected">
                  ✕
                </span>
              ) : (
                <button className="ck" type="button" role="checkbox" aria-checked={on} aria-label={`Select ${f.name}`} onClick={() => onToggleSelected(f.id)}>
                  <span className="box">{on ? '✓' : ''}</span>
                </button>
              )}
              <div className="fname">
                <span className="typetile">{typeLabel(f.contentType)}</span>
                {infected ? (
                  <span className="struck">{f.name}</span>
                ) : (
                  <button className="link plain" type="button" title="Map only this file" onClick={() => onOnly(f.id)}>
                    {f.name}
                  </button>
                )}
              </div>
              <div className="chips">
                {infected ? (
                  <span className="dot-text bad">Will not be sent</span>
                ) : paths.length === 0 ? (
                  <span className="dot-text warn">No destination yet</span>
                ) : (
                  <DestinationChips paths={paths} />
                )}
              </div>
              <div>
                {view.bar && (
                  <div className="bar" aria-hidden="true">
                    <div style={{ width: `${Math.round(f.progress * 100)}%` }} />
                  </div>
                )}
                <span className={`status ${view.tone}`}>
                  <span className="sdot" />
                  {view.text}
                </span>
                {f.message && <div className="fmsg">{f.message}</div>}
              </div>
              <div className="right size">{formatSize(f.sizeBytes)}</div>
              <div className="actions">
                {!infected && (
                  <button className="icon" type="button" aria-label={`Preview ${f.name}`} title="Preview" onClick={() => onPreview(f.id)}>
                    👁
                  </button>
                )}
                {canRetry && (
                  <button className="icon retry" type="button" aria-label={`Retry ${f.name}`} title="Retry upload" onClick={() => onRetry(f.id)}>
                    ↻
                  </button>
                )}
                <button className="icon" type="button" aria-label={`Remove ${f.name}`} title="Remove" onClick={() => onRemove(f.id)}>
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
