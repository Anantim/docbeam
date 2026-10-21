import { useRef } from 'react';
import { UPLOAD_STATUS_MEANING, UPLOAD_STATUS_SHORT } from '../explain.js';
import { formatSize } from '../distribute/files.js';
import { isUsable, type Mapping } from '../distribute/mapping.js';
import type { PageFile } from '../upload/manager.js';
import { PreviewButton } from './FileActions.js';
import { CheckIcon, CloseIcon, MinusIcon, RetryIcon } from './Icons.js';
import { NoMatches } from './ListFilter.js';
import { Popover } from './Popover.js';
import { StatusChip, type Tone } from './StatusChip.js';
import { Tooltip } from './Tooltip.js';
import { TypeBadge } from './TypeBadge.js';

interface StatusView {
  /** The state of the upload, in one word: Uploading, Scanning, Ready, Failed, Interrupted or Refused (malware only). */
  text: string;
  tone: Tone;
  bar: boolean;
  /** Why a file failed, was refused or stopped, in one line. */
  reason?: string;
  /** The tooltip and screen-reader name of a state with no reason, for example "Scanning for malware". */
  tip?: string;
  /** Where an upload is: a percent, or the part of a large file. */
  detail?: string;
}

export function statusView(f: PageFile): StatusView {
  switch (f.status) {
    case 'hashing':
    case 'waiting':
      return { text: 'Uploading', tone: 'idle', bar: false };
    case 'uploading':
      return { text: 'Uploading', tone: 'busy', bar: true, detail: f.partCount > 0 ? `Part ${f.partsDone} of ${f.partCount}` : `${percent(f)}%` };
    case 'checking':
      return { text: 'Scanning', tone: 'warn', bar: false, tip: 'Scanning for malware' };
    case 'verified':
      return { text: 'Ready', tone: 'ok', bar: false };
    // "Failed" is a problem that can be tried again (Retry): storage did not accept the upload, or the scan could not run.
    // "Refused" is only for malware: final, no Retry, the tick box locked (D-F1-38).
    case 'refused':
      return { text: 'Failed', tone: 'bad', bar: false, reason: f.message ?? 'Storage did not accept the upload. Retry it.' };
    case 'interrupted':
      return { text: 'Interrupted', tone: 'bad', bar: false, reason: f.message ?? 'The connection broke. Retry carries on where it stopped.' };
    case 'unchecked':
      return { text: 'Failed', tone: 'bad', bar: false, reason: 'The file could not be scanned. Retry it or remove it.' };
    case 'infected':
      return { text: 'Refused', tone: 'bad', bar: false, reason: 'Malware was found. The file was deleted and cannot be sent.' };
  }
}

/** Percent done for the progress bar of a file that is moving. */
const percent = (f: PageFile): number => Math.round(f.progress * 100);

interface Props {
  /** Every file: the header box, "Select all" and the selection are about all of them, whatever is listed. */
  files: readonly PageFile[];
  /** The files that are listed (the filter box narrows this); all of them when it is empty. */
  listed?: readonly PageFile[];
  /** "Clear filter" under "No matches": empties the box and puts the focus back in it. */
  onClearFilter?: () => void;
  mapping: Mapping;
  selected: ReadonlySet<string>;
  /** A click on a row, with the keys held, selects it (Shift for a range, Ctrl or Cmd to add). */
  onPick: (id: string, mods: { shift: boolean; ctrl: boolean }) => void;
  onToggleAll: () => void;
  onPreview: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}

/**
 * The files of the distribution, one row each: type, name and size, the state of the upload, and how many folders
 * it goes to. A click selects a row; the Destinations tree then ticks folders for the selected files (D-F1-8).
 * It is a grid so a screen reader announces which rows are selected; Enter or Space on a row selects it too.
 */
export function FileTable({ files, listed = files, onClearFilter, mapping, selected, onPick, onToggleAll, onPreview, onRetry, onRemove }: Props) {
  const usable = files.filter(isUsable);
  const allOn = usable.length > 0 && usable.every((f) => selected.has(f.id));
  const someOn = !allOn && usable.some((f) => selected.has(f.id));
  const rows = useRef<HTMLDivElement>(null);

  // Up and Down move between rows; the rows are the tab stops of the grid (one Tab goes into it, arrows move in it).
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    const all = [...(rows.current?.querySelectorAll<HTMLElement>('.frow[role="row"][data-id]') ?? [])];
    const at = all.indexOf(event.currentTarget);
    if (event.key === 'ArrowDown') all[at + 1]?.focus();
    else if (event.key === 'ArrowUp') all[at - 1]?.focus();
    else return;
    event.preventDefault();
  };

  return (
    <div className="table-scroll">
      <div ref={rows} className="ftable" role="grid" aria-label="Files" aria-multiselectable="true">
        <div className="frow thead" role="row">
          <div role="columnheader">
            <Tooltip text="Select all to choose their folders">
              <button
                className="ck"
                type="button"
                role="checkbox"
                aria-checked={someOn ? 'mixed' : allOn}
                aria-label="Select all to choose their folders"
                onClick={onToggleAll}
              >
                <span className={`box ${someOn ? 'mixed' : ''}`}>{allOn ? <CheckIcon size={12} /> : someOn ? <MinusIcon size={12} /> : null}</span>
              </button>
            </Tooltip>
          </div>
          <div className="hcell" role="columnheader">
            File
          </div>
          <div className="hcell" role="columnheader">
            State
          </div>
          <div className="hcell" role="columnheader">
            Folders
          </div>
          <div className="hcell right" role="columnheader">
            <span className="sr">Actions</span>
          </div>
        </div>

        {listed.length === 0 && files.length > 0 && onClearFilter && <NoMatches onClear={onClearFilter} />}
        {listed.map((f) => {
          const view = statusView(f);
          const keys = isUsable(f) ? (mapping.files[f.id] ?? []) : [];
          const paths = keys.map((k) => mapping.destinations[k]?.path ?? '');
          const on = selected.has(f.id);
          const infected = f.status === 'infected';
          const canRetry = f.status === 'refused' || f.status === 'interrupted' || f.status === 'unchecked';
          return (
            <div
              className={`frow ${on ? 'sel' : ''}`}
              role="row"
              data-id={f.id}
              aria-selected={infected ? undefined : on}
              tabIndex={infected ? undefined : 0}
              key={f.id}
              onKeyDown={(e) => {
                onKeyDown(e);
                // Enter or Space selects the focused row; Space must not also scroll the page.
                if (!infected && e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  onPick(f.id, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
                }
              }}
              onClick={(e) => {
                if (infected || (e.target as HTMLElement).closest('button, a, input')) return;
                onPick(f.id, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
              }}
            >
              <div role="gridcell">
                {infected ? (
                  <Tooltip text={`${f.name} was refused for malware and cannot be selected or sent`}>
                    <span className="ck locked" role="img" aria-label={`${f.name} was refused for malware and cannot be selected or sent`}>
                      <CloseIcon size={14} />
                    </span>
                  </Tooltip>
                ) : (
                  // The row itself selects on a click or Enter; this box says what the selection is for, and is a click target
                  // like the rest of the row (D-F1-23).
                  <Tooltip text="Select to choose folders for this file">
                    <span className={`box ${on ? 'on' : ''}`} role="checkbox" aria-checked={on} aria-label="Select to choose folders for this file">
                      {on ? <CheckIcon size={12} /> : null}
                    </span>
                  </Tooltip>
                )}
              </div>
              <div className="fname" role="gridcell">
                <TypeBadge contentType={f.contentType} />
                <Tooltip text={f.name}>
                  <span className={infected ? 'struck' : 'ellipsis fname-text'}>{f.name}</span>
                </Tooltip>
                <Tooltip text={`${f.sizeBytes.toLocaleString('en-US')} bytes`}>
                  <span className="size">{formatSize(f.sizeBytes)}</span>
                </Tooltip>
              </div>
              <div className="fstatus" role="gridcell">
                {view.bar && (
                  <div className="bar" aria-hidden="true">
                    <div style={{ width: `${percent(f)}%` }} />
                  </div>
                )}
                {/* The tooltip and the screen-reader name of a state that has a reason are that reason (the line under the chip).
                    A new state is a new chip (the key), which fades in (D-F1-47). */}
                <StatusChip key={view.text} tone={view.tone} label={view.text} meaning={view.reason ?? view.tip ?? UPLOAD_STATUS_MEANING[f.status]} ariaLabel={view.reason ?? view.tip} />
                {/* A problem that needs action keeps one short line under the chip (cut by an ellipsis); the whole sentence is the
                    tooltip, on hover and on keyboard focus (D-F1-58). */}
                {view.reason !== undefined ? (
                  <Tooltip text={view.reason} block>
                    <div className="fmsg short" tabIndex={0} aria-label={view.reason}>
                      {UPLOAD_STATUS_SHORT[f.status] ?? view.reason}
                    </div>
                  </Tooltip>
                ) : (
                  view.detail !== undefined && <div className="fmsg">{view.detail}</div>
                )}
              </div>
              <div className="chips" role="gridcell">
                {infected ? (
                  <span className="dot-text bad">Will not be sent</span>
                ) : paths.length === 0 ? (
                  <span className="dot-text warn">None yet</span>
                ) : (
                  <Popover
                    label={paths.length === 1 ? '1 folder' : `${paths.length} folders`}
                    ariaLabel={`Show the ${paths.length === 1 ? 'folder' : `${paths.length} folders`} of ${f.name}`}
                    panelLabel={`Folders of ${f.name}`}
                    items={paths}
                  />
                )}
              </div>
              <div className="actions" role="gridcell">
                {!infected && <PreviewButton name={f.name} onClick={() => onPreview(f.id)} />}
                {canRetry && (
                  <Tooltip text={`Retry upload of ${f.name}`}>
                    <button className="icon retry" type="button" aria-label={`Retry upload of ${f.name}`} onClick={() => onRetry(f.id)}>
                      <RetryIcon />
                    </button>
                  </Tooltip>
                )}
                <Tooltip text={`Remove ${f.name}`}>
                  <button className="icon" type="button" aria-label={`Remove ${f.name}`} onClick={() => onRemove(f.id)}>
                    <CloseIcon />
                  </button>
                </Tooltip>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
