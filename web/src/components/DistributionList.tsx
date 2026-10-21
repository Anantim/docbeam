import { memo, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { JOB_STATUS_MEANING } from '../explain.js';
import { statusFromCounts } from '../tracking/apply.js';
import type { Counts, JobSummary } from '../tracking/api.js';
import { describeDestination } from '../distribute/mapping.js';
import { jobChip, shortId } from '../tracking/format.js';
import { When } from './When.js';
import { CopyLinkButton, type Notify } from './CopyLinkButton.js';
import { JobBar } from './JobBar.js';
import { ListFoot } from './ListFoot.js';
import { Popover } from './Popover.js';
import { StatusChip } from './StatusChip.js';
import { Tooltip } from './Tooltip.js';

interface Props {
  /** The signed-in person, so their own distributions read "You" under any filter. */
  meId: string;
  /** A filter is set, so an empty list says "no match" and offers to clear them. */
  filtered?: boolean;
  onClearFilters: () => void;
  jobs: JobSummary[] | null;
  error: string;
  hasMore: boolean;
  loadingMore: boolean;
  /** The last request for the next page failed. */
  moreFailed: boolean;
  onMore: () => void;
  onRetry: () => void;
  selectedId: string | null;
  onOpen: (jobId: string) => void;
  /** Says "Link copied." and the like, in the toast corner. */
  notify: Notify;
  /** The open distribution's live counts. Its row follows them, so it never disagrees with the panel beside it. */
  live?: { jobId: string; counts: Counts } | null;
  /** The distribution that was just sent: its row is highlighted for a moment (D-F1-47). */
  freshId?: string | null;
  /** A distribution to bring into view and highlight for a second: Open by ID on the one that is already open (D-F1-51). */
  flashId?: string | null;
}
const SKELETON_ROWS = 5;
interface RowProps {
  job: JobSummary;
  /** The live counts of the open distribution, or null: its row follows them. */
  counts: Counts | null;
  meId: string;
  selected: boolean;
  /** The row whose buttons are in the Tab order; the others are reached with Up and Down (D-F1-29). */
  tabStop: boolean;
  onOpen: (jobId: string) => void;
  notify: Notify;
  /** The row came into the list after the first look at it: it fades in over 150 ms (D-F1-47). */
  arrive: boolean;
  /** The distribution that was just sent: its row is highlighted and the highlight fades out over a second. */
  fresh: boolean;
}

const sameNames = (a: readonly string[], b: readonly string[]): boolean => a === b || (a.length === b.length && a.every((x, i) => x === b[i]));

/** Two rows are the same when what they show is the same, so a refresh that changes nothing redraws no row. */
const sameRow = (a: RowProps, b: RowProps): boolean =>
  a.selected === b.selected &&
  a.meId === b.meId &&
  a.onOpen === b.onOpen &&
  a.notify === b.notify &&
  a.arrive === b.arrive &&
  a.fresh === b.fresh &&
  a.tabStop === b.tabStop &&
  a.counts === b.counts &&
  a.job.jobId === b.job.jobId &&
  a.job.status === b.job.status &&
  a.job.createdAt === b.job.createdAt &&
  a.job.taskCount === b.job.taskCount &&
  sameNames(a.job.fileNames, b.job.fileNames) &&
  sameNames(a.job.destinations, b.job.destinations) &&
  a.job.submittedBy.userId === b.job.submittedBy.userId &&
  a.job.submittedBy.name === b.job.submittedBy.name &&
  (Object.keys(a.job.counts) as Array<keyof Counts>).every((k) => a.job.counts[k] === b.job.counts[k]);

const Row = memo(function Row({ job, counts, meId, selected, tabStop, onOpen, notify, arrive, fresh }: RowProps) {
  const status = counts ? statusFromCounts(counts, job.status === 'cancelled') : job.status;
  const chip = jobChip(status);
  const sender = job.submittedBy.userId === meId ? 'You' : job.submittedBy.name;
  const firstFile = job.fileNames[0] ?? '';
  const firstFolders = job.destinations.slice(0, 2).map((p) => describeDestination(p).name).join(', ');
  return (
    <tr className={`${selected ? 'on' : ''} ${arrive ? 'arrive' : ''} ${fresh ? 'fresh' : ''}`} onClick={() => onOpen(job.jobId)}>
      <td>
        <span className="dist-id-cell">
          <Tooltip text={job.jobId}>
            <button
              type="button"
              className="link mono dist-id"
              data-job-id={job.jobId}
              tabIndex={tabStop ? 0 : -1}
              aria-current={selected ? 'true' : undefined}
              aria-label={`Open distribution ${shortId(job.jobId)}`}
              onClick={(e) => {
                e.stopPropagation();
                onOpen(job.jobId);
              }}
            >
              {shortId(job.jobId)}
            </button>
          </Tooltip>
          <CopyLinkButton jobId={job.jobId} notify={notify} show="reveal" tabbable={tabStop} />
        </span>
        {/* The sender is under the ID in every state: "You" or the name, small and muted (D-F1-33). */}
        <Tooltip text={job.submittedBy.name} block>
          <span className="dist-sender">{sender}</span>
        </Tooltip>
      </td>
      <td>
        <StatusChip tone={chip.tone} label={chip.label} meaning={JOB_STATUS_MEANING[status]} />
        {(status === 'pending' || status === 'in_progress') && <JobBar counts={counts ?? job.counts} total={job.taskCount} thin />}
      </td>
      <td>
        {/* The list has one Tab stop: the full time is on hover here, and on focus in the panel. */}
        <When iso={job.createdAt} focusable={false} />
      </td>
      {/* Files and Destinations: the first name or two on one line with an ellipsis, then "+N" for the rest. They share the
          spare width; the split view hides them (D-F1-40). */}
      <td className="dist-more dist-fill dist-files">
        <div className="cell-line">
          <Tooltip text={firstFile}>
            <span className="cell-text">{firstFile}</span>
          </Tooltip>
          {job.fileNames.length > 1 && (
            <Popover
              label={`+${job.fileNames.length - 1}`}
              ariaLabel={`Show ${job.fileNames.length - 1} more ${job.fileNames.length === 2 ? 'file' : 'files'} of ${shortId(job.jobId)}`}
              panelLabel={`More files of ${shortId(job.jobId)}`}
              items={job.fileNames.slice(1)}
            />
          )}
        </div>
      </td>
      <td className="dist-more dist-fill dist-dests">
        <div className="cell-line">
          <Tooltip text={firstFolders}>
            <span className="cell-text">{firstFolders}</span>
          </Tooltip>
          {job.destinations.length > 2 && (
            <Popover
              label={`+${job.destinations.length - 2}`}
              ariaLabel={`Show ${job.destinations.length - 2} more ${job.destinations.length === 3 ? 'folder' : 'folders'} of ${shortId(job.jobId)}`}
              panelLabel={`More folders of ${shortId(job.jobId)}`}
              items={job.destinations.slice(2)}
            />
          )}
        </div>
      </td>
    </tr>
  );
}, sameRow);

/** The header row, the same for the list and for its loading state. */
function ListHead() {
  return (
    <thead>
      <tr>
        <th scope="col" className="dist-fit">
          ID
        </th>
        <th scope="col" className="dist-fit">
          Status
        </th>
        <th scope="col" className="dist-fit dist-fit-sent">
          Sent
        </th>
        {/* The spare width is shared by these two, so a long name is cut with an ellipsis and not by the edge (D-F1-40). */}
        <th scope="col" className="dist-more dist-fill dist-files">
          Files
        </th>
        <th scope="col" className="dist-more dist-fill dist-dests">
          Destinations
        </th>
      </tr>
    </thead>
  );
}

/**
 * The distributions, newest first, one row each: short id, when it was sent, who sent it, how many files and
 * destinations, and its status. A row opens the side panel. The list is paged on scroll (D-F1-7).
 */
export function DistributionList({ meId, filtered = false, onClearFilters, jobs, error, hasMore, loadingMore, moreFailed, onMore, onRetry, selectedId, onOpen, notify, live, freshId = null, flashId = null }: Props) {
  if (jobs === null && error === '') {
    // The real header row, and in each row grey bars the shape of what will come: the ID with the sender under it, the
    // status chip, the date, and (when there is room) sender, files and folders (D-F1-22).
    return (
      <div className="card dist" role="status" aria-busy="true" aria-label="Loading distributions">
        <table className="dist-table" aria-hidden="true">
          <ListHead />
          <tbody>
            {Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <tr key={i} className="sk-row">
                <td>
                  <span className="sk sk-id" />
                  <span className="sk sk-sender" />
                </td>
                <td>
                  <span className="sk sk-chip" />
                </td>
                <td>
                  <span className="sk sk-date" />
                </td>
                <td className="dist-more dist-fill dist-files">
                  <span className="sk sk-name" />
                </td>
                <td className="dist-more dist-fill dist-dests">
                  <span className="sk sk-name" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (jobs === null) {
    return (
      <div className="card state" role="alert">
        <strong>The list could not be loaded</strong>
        <span>{error}</span>
        <button className="btn2" type="button" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }
  if (jobs.length === 0) {
    return (
      <div className="card state">
        <strong>{filtered ? 'No distribution matches these filters' : 'No distributions yet'}</strong>
        {filtered ? (
          <button className="btn2" type="button" onClick={onClearFilters}>
            Clear filters
          </button>
        ) : (
          <span>Distributions you send, and those sent to your teams, appear here.</span>
        )}
      </div>
    );
  }

  return <LoadedList meId={meId} jobs={jobs} error={error} hasMore={hasMore} loadingMore={loadingMore} moreFailed={moreFailed} onMore={onMore} selectedId={selectedId} onOpen={onOpen} notify={notify} live={live} freshId={freshId} flashId={flashId} />;
}

type LoadedProps = Pick<Props, 'meId' | 'error' | 'hasMore' | 'loadingMore' | 'moreFailed' | 'onMore' | 'selectedId' | 'onOpen' | 'notify' | 'live' | 'freshId' | 'flashId'> & { jobs: JobSummary[] };

/**
 * The list with its rows. From 1024 px up the page does not scroll and this card fills the height that is left: the table
 * scrolls inside it under a sticky header row, and the next page loads when the scroll area nears its end (`ListFoot`, D-F1-29, D-F1-49).
 * Up and Down move between the rows and keep the focused row in view; only one row is a Tab stop (a roving tab stop), so
 * Tab goes filters, list, panel. Opening or closing a distribution does not touch the scroll position: the selected row
 * is only scrolled into view when it is not.
 */
function LoadedList({ meId, jobs, error, hasMore, loadingMore, moreFailed, onMore, selectedId, onOpen, notify, live, freshId = null, flashId = null }: LoadedProps) {
  // The rows the list held on its first draw do not animate; a row that comes later fades in (D-F1-47).
  const seen = useRef<Set<string> | null>(null);
  const firstDraw = seen.current === null;
  if (seen.current === null) seen.current = new Set(jobs.map((j) => j.jobId));
  const arrivals = new Set(firstDraw ? [] : jobs.filter((j) => !(seen.current as Set<string>).has(j.jobId)).map((j) => j.jobId));
  useEffect(() => {
    for (const j of jobs) seen.current?.add(j.jobId);
  }, [jobs]);
  const scroller = useRef<HTMLDivElement>(null);
  // More rows below the visible part of the scroll area: a fade and a thin shadow at its bottom edge, like the deliveries (D-F1-33).
  const [moreBelow, setMoreBelow] = useState(false);
  const measure = (): void => {
    const el = scroller.current;
    if (el) setMoreBelow(el.scrollHeight - el.clientHeight - el.scrollTop > 2);
  };
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const watcher = new ResizeObserver(measure);
    watcher.observe(el);
    if (el.firstElementChild) watcher.observe(el.firstElementChild); // the table: it grows when more rows are added
    return () => watcher.disconnect();
  }, [jobs.length]);
  // The one row that is a Tab stop: the one last focused, else the open one, else the first.
  const [active, setActive] = useState<string | null>(null);
  const stop = jobs.some((j) => j.jobId === active) ? active : jobs.some((j) => j.jobId === selectedId) ? selectedId : (jobs[0]?.jobId ?? null);

  // Open by ID on the distribution that is already open: its row is brought into view (the highlight is the `fresh` class below).
  useEffect(() => {
    if (flashId) scroller.current?.querySelector<HTMLElement>(`[data-job-id="${flashId}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [flashId]);

  useEffect(() => {
    if (!selectedId) return;
    scroller.current?.querySelector<HTMLElement>(`[data-job-id="${selectedId}"]`)?.scrollIntoView?.({ block: 'nearest' }); // (not in jsdom)
  }, [selectedId]);

  const onKeyDown = (event: KeyboardEvent<HTMLTableSectionElement>): void => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const target = event.target as HTMLElement;
    if (!target.matches('[data-job-id]')) return; // only from a row's ID button, not from its copy icon
    const ids = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-job-id]')];
    const at = ids.indexOf(target);
    const next = event.key === 'ArrowDown' ? ids[at + 1] : event.key === 'ArrowUp' ? ids[at - 1] : event.key === 'Home' ? ids[0] : ids[ids.length - 1];
    event.preventDefault();
    next?.focus(); // the browser scrolls a focused row into view (the sticky header is kept clear by scroll-padding)
    // Down (or End) on the last row asks for the next page too, for a person who is not scrolling (D-F1-49).
    if ((event.key === 'ArrowDown' || event.key === 'End') && at === ids.length - 1 && hasMore && !loadingMore && !moreFailed) onMore();
  };

  return (
    <div className="card dist">
      {error && !(hasMore && moreFailed) && (
        <div className="alert dist-error" role="alert">
          {error}
        </div>
      )}
      <div className={`dist-fade fadewrap ${moreBelow ? 'more-below' : ''}`}>
      <div className="dist-scroll" ref={scroller} onScroll={measure}>
        <table className="dist-table" aria-label="Distributions">
          <ListHead />
          <tbody onKeyDown={onKeyDown} onFocus={(e) => setActive((e.target as HTMLElement).closest('tr')?.querySelector('[data-job-id]')?.getAttribute('data-job-id') ?? null)}>
            {jobs.map((job) => {
              const following = live && live.jobId === job.jobId ? live.counts : null;
              return <Row key={job.jobId} job={job} counts={following} meId={meId} selected={selectedId === job.jobId} tabStop={stop === job.jobId} onOpen={onOpen} notify={notify} arrive={arrivals.has(job.jobId)} fresh={freshId === job.jobId || flashId === job.jobId} />;
            })}
          </tbody>
        </table>
        <ListFoot hasMore={hasMore} busy={loadingMore} failed={moreFailed} onMore={onMore} />
      </div>
      </div>
    </div>
  );
}
