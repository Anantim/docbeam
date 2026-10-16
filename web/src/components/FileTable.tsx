import { UPLOAD_STATUS_MEANING } from '../explain.js';
import { isUsable, type Mapping } from '../distribute/mapping.js';
import { formatSize } from '../distribute/files.js';
import type { PageFile } from '../upload/manager.js';
import { DestinationChips } from './DestinationChips.js';
import { PreviewButton } from './FileActions.js';
import { StatusChip, type Tone } from './StatusChip.js';
import { TypeBadge } from './TypeBadge.js';

interface StatusView {
  text: string;
  tone: Tone;
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

/**
 * The Documents table. The columns size to what is in them (D-M3-12): the file name takes the spare room,
 * Destinations, Status, Size and Actions take what their content needs, and long text ends with an ellipsis
 * and shows in full in its title. One grid holds every row, so the columns line up.
 */
export function FileTable({ files, mapping, selected, onToggleSelected, onToggleAll, onOnly, onPreview, onRetry, onRemove }: Props) {
  const usable = files.filter(isUsable);
  const allOn = usable.length > 0 && usable.every((f) => selected.has(f.id));
  const someOn = !allOn && usable.some((f) => selected.has(f.id));

  return (
    <div className="table-scroll">
      <div className="ftable" role="table" aria-label="Documents">
        <div className="frow thead" role="row">
          <button
            className="ck"
            type="button"
            role="checkbox"
            aria-checked={someOn ? 'mixed' : allOn}
            aria-label="Select all files"
            title="Select all files"
            onClick={onToggleAll}
          >
            <span className={`box ${someOn ? 'mixed' : ''}`}>{allOn ? '✓' : someOn ? '–' : ''}</span>
          </button>
          <div className="hcell" role="columnheader">
            Name
          </div>
          <div className="hcell" role="columnheader">
            Destinations
          </div>
          <div className="hcell" role="columnheader">
            Status
          </div>
          <div className="hcell right" role="columnheader">
            Size
          </div>
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
            <div className={`frow ${on ? 'sel' : ''}`} role="row" key={f.id}>
              {infected ? (
                <span
                  className="ck locked"
                  role="img"
                  aria-label={`${f.name} was refused for malware and cannot be selected or sent`}
                  title={`${f.name} was refused for malware and cannot be selected or sent`}
                >
                  ✕
                </span>
              ) : (
                <button className="ck" type="button" role="checkbox" aria-checked={on} aria-label={`Select ${f.name}`} title={`Select ${f.name}`} onClick={() => onToggleSelected(f.id)}>
                  <span className="box">{on ? '✓' : ''}</span>
                </button>
              )}
              <div className="fname">
                <TypeBadge contentType={f.contentType} />
                {infected ? (
                  <span className="struck" title={f.name}>
                    {f.name}
                  </span>
                ) : (
                  <button className="link plain" type="button" title={`${f.name}. Click to map only this file.`} onClick={() => onOnly(f.id)}>
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
              <div className="fstatus">
                {view.bar && (
                  <div className="bar" aria-hidden="true">
                    <div style={{ width: `${Math.round(f.progress * 100)}%` }} />
                  </div>
                )}
                <StatusChip tone={view.tone} label={view.text} title={UPLOAD_STATUS_MEANING[f.status]} />
                {f.message && <div className="fmsg">{f.message}</div>}
              </div>
              <div className="right size">{formatSize(f.sizeBytes)}</div>
              <div className="actions">
                {!infected && <PreviewButton name={f.name} onClick={() => onPreview(f.id)} />}
                {canRetry && (
                  <button className="icon retry" type="button" aria-label={`Retry upload of ${f.name}`} title={`Retry upload of ${f.name}`} onClick={() => onRetry(f.id)}>
                    ↻
                  </button>
                )}
                <button className="icon" type="button" aria-label={`Remove ${f.name}`} title={`Remove ${f.name}`} onClick={() => onRemove(f.id)}>
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
