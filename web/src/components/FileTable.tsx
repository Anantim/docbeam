import { useRef } from 'react';
import { UPLOAD_STATUS_MEANING } from '../explain.js';
import { formatSize } from '../distribute/files.js';
import { plural } from '../text.js';
import type { Mapping } from '../distribute/mapping.js';
import type { PageFile } from '../upload/manager.js';
import { PreviewButton } from './FileActions.js';
import { CheckIcon, CloseIcon, MinusIcon, RetryIcon } from './Icons.js';
import { NoMatches } from './ListFilter.js';
import { Popover } from './Popover.js';
import { StatusChip, type Tone } from './StatusChip.js';
import { Tooltip } from './Tooltip.js';
import { TypeBadge } from './TypeBadge.js';

interface StatusView {
  /** The state of the upload, in one word: Uploading, Scanning, Ready, Failed or Interrupted. */
  text: string;
  tone: Tone;
  bar: boolean;
  /** Why a file failed or stopped, in one line. */
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
      return { text: 'Scanning', tone: 'busy', bar: false, tip: 'Scanning for malware' }; // working, like Uploading: blue (D-F1-78)
    case 'verified':
      return { text: 'Ready', tone: 'ok', bar: false };
    // "Failed" is a problem that can be tried again (Retry): storage did not accept the upload, or the scan could not run.
    // A file with malware is not a row at all: the page takes it out and says why in the "not added" box (D-F1-78).
    // The reason is the tooltip of the chip, from the one reason map; nothing is written under the chip (D-F1-60).
    case 'refused':
      return { text: 'Failed', tone: 'bad', bar: false, reason: UPLOAD_STATUS_MEANING.refused };
    case 'interrupted':
      return { text: 'Interrupted', tone: 'bad', bar: false, reason: UPLOAD_STATUS_MEANING.interrupted };
    case 'unchecked':
      return { text: 'Failed', tone: 'bad', bar: false, reason: UPLOAD_STATUS_MEANING.unchecked };
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
  const allOn = files.length > 0 && files.every((f) => selected.has(f.id));
  const someOn = !allOn && files.some((f) => selected.has(f.id));
  const rows = useRef<HTMLDivElement>(null);
  // Two files may have the same name (different contents, D-F1-81): their buttons must still be told apart, so a name that is in the list more than once
  // is followed by which one it is ("report.pdf (2 of 3 with this name)").
  const sameName = new Map<string, string[]>();
  for (const f of files) sameName.set(f.name, [...(sameName.get(f.name) ?? []), f.id]);
  const named = (f: { id: string; name: string }): string => {
    const ids = sameName.get(f.name) ?? [];
    return ids.length > 1 ? `${f.name} (${ids.indexOf(f.id) + 1} of ${ids.length} with this name)` : f.name;
  };

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
          const keys = mapping.files[f.id] ?? [];
          const paths = keys.map((k) => mapping.destinations[k]?.path ?? '');
          const on = selected.has(f.id);
          const canRetry = f.status === 'refused' || f.status === 'interrupted' || f.status === 'unchecked';
          return (
            <div
              className={`frow ${on ? 'sel' : ''}`}
              role="row"
              data-id={f.id}
              aria-selected={on}
              tabIndex={0}
              key={f.id}
              onKeyDown={(e) => {
                onKeyDown(e);
                // Enter or Space selects the focused row; Space must not also scroll the page.
                if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  onPick(f.id, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
                }
              }}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('button, a, input')) return;
                onPick(f.id, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
              }}
            >
              <div role="gridcell">
                {/* The row itself selects on a click or Enter; this box says what the selection is for, and is a click target
                    like the rest of the row (D-F1-23). */}
                <Tooltip text="Select to choose folders for this file">
                  <span className={`box ${on ? 'on' : ''}`} role="checkbox" aria-checked={on} aria-label={`Select ${named(f)} to choose folders for this file`}>
                    {on ? <CheckIcon size={12} /> : null}
                  </span>
                </Tooltip>
              </div>
              <div className="fname" role="gridcell">
                <TypeBadge contentType={f.contentType} />
                <Tooltip text={f.name}>
                  <span className="ellipsis fname-text">{f.name}</span>
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
                {/* The tooltip and the screen-reader name of a state that has a reason are that reason, on hover, on keyboard focus and
                    on a click; a chip with a reason is a Tab stop. A new state is a new chip (the key), which fades in (D-F1-47). */}
                <StatusChip
                  key={view.text}
                  tone={view.tone}
                  label={view.text}
                  meaning={view.reason ?? view.tip ?? UPLOAD_STATUS_MEANING[f.status]}
                  ariaLabel={view.reason ?? view.tip}
                  focusable={view.reason !== undefined}
                />
                {view.detail !== undefined && <div className="fmsg">{view.detail}</div>}
              </div>
              <div className="chips" role="gridcell">
                {paths.length === 0 ? (
                  <span className="dot-text warn">None yet</span>
                ) : (
                  <Popover
                    label={plural(paths.length, 'folder', 'folders')}
                    ariaLabel={`Show the ${paths.length === 1 ? 'folder' : plural(paths.length, 'folder', 'folders')} of ${named(f)}`}
                    panelLabel={`Folders of ${named(f)}`}
                    items={paths}
                  />
                )}
              </div>
              <div className="actions" role="gridcell">
                <PreviewButton name={named(f)} onClick={() => onPreview(f.id)} {...(f.restored ? { offBecause: 'It is not available after a reload.' } : {})} />
                {canRetry && (
                  <Tooltip text={`Retry upload of ${f.name}`}>
                    <button className="icon" type="button" aria-label={`Retry upload of ${named(f)}`} onClick={() => onRetry(f.id)}>
                      <RetryIcon />
                    </button>
                  </Tooltip>
                )}
                <Tooltip text={`Remove ${f.name}`}>
                  <button className="icon" type="button" aria-label={`Remove ${named(f)}`} onClick={() => onRemove(f.id)}>
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
