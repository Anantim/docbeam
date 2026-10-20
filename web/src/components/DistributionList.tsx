import { memo, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { JOB_STATUS_MEANING } from '../explain.js';
import { statusFromCounts } from '../tracking/apply.js';
import type { Counts, JobSummary } from '../tracking/api.js';
import { formatWhen, jobChip, shortId } from '../tracking/format.js';
import { CopyLinkButton, type Notify } from './CopyLinkButton.js';
import { JobBar } from './JobBar.js';
import { MoreRow } from './MoreRow.js';
import { StatusChip } from './StatusChip.js';

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
}

/** Two rows are the same when what they show is the same, so a refresh that changes nothing redraws no row. */
const sameRow = (a: RowProps, b: RowProps): boolean =>
  a.selected === b.selected &&
  a.meId === b.meId &&
  a.onOpen === b.onOpen &&
  a.notify === b.notify &&
  a.tabStop === b.tabStop &&
  a.counts === b.counts &&
  a.job.jobId === b.job.jobId &&
  a.job.status === b.job.status &&
  a.job.createdAt === b.job.createdAt &&
  a.job.taskCount === b.job.taskCount &&
  a.job.fileCount === b.job.fileCount &&
  a.job.destinationCount === b.job.destinationCount &&
  a.job.submittedBy.userId === b.job.submittedBy.userId &&
  a.job.submittedBy.name === b.job.submittedBy.name &&
  (Object.keys(a.job.counts) as Array<keyof Counts>).every((k) => a.job.counts[k] === b.job.counts[k]);

const Row = memo(function Row({ job, counts, meId, selected, tabStop, onOpen, notify }: RowProps) {
  const status = counts ? statusFromCounts(counts, job.status === 'cancelled') : job.status;
  const chip = jobChip(status);
  const sender = job.submittedBy.userId === meId ? 'You' : job.submittedBy.name;
  return (
    <tr className={selected ? 'on' : ''} onClick={() => onOpen(job.jobId)}>
      <td>
        <span className="dist-id-cell">
          <button
            type="button"
            className="link mono dist-id"
            title={job.jobId}
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
          <CopyLinkButton jobId={job.jobId} notify={notify} show="reveal" tabbable={tabStop} />
        </span>
        {/* The sender is under the ID in every state: "You" or the name, small and muted (D-F1-33). */}
        <span className="dist-sender" title={job.submittedBy.name}>
          {sender}
        </span>
      </td>
      <td>
        <StatusChip tone={chip.tone} label={chip.label} title={JOB_STATUS_MEANING[status]} />
        {(status === 'pending' || status === 'in_progress') && <JobBar counts={counts ?? job.counts} total={job.taskCount} thin />}
      </td>
      <td>{formatWhen(job.createdAt)}</td>
      <td className="num-col dist-more">{job.fileCount}</td>
      <td className="num-col dist-more">{job.destinationCount}</td>
      <td className="dist-more dist-spacer" aria-hidden="true" />
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
        <th scope="col" className="num-col dist-more">
          Files
        </th>
        <th scope="col" className="num-col dist-more">
          Folders
        </th>
        {/* Spare width goes here, at the end of the row, and not between Sender and Files (D-F1-28). */}
        <th className="dist-more dist-spacer" aria-hidden="true" />
      </tr>
    </thead>
  );
}

/**
 * The distributions, newest first, one row each: short id, when it was sent, who sent it, how many files and
 * destinations, and its status. A row opens the side panel. The list is paged on scroll (D-F1-7).
 */
export function DistributionList({ meId, filtered = false, onClearFilters, jobs, error, hasMore, loadingMore, moreFailed, onMore, onRetry, selectedId, onOpen, notify, live }: Props) {
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
                <td className="num-col dist-more">
                  <span className="sk sk-num" />
                </td>
                <td className="num-col dist-more">
                  <span className="sk sk-num" />
                </td>
                <td className="dist-more dist-spacer" aria-hidden="true" />
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

  return <LoadedList meId={meId} jobs={jobs} error={error} hasMore={hasMore} loadingMore={loadingMore} moreFailed={moreFailed} onMore={onMore} selectedId={selectedId} onOpen={onOpen} notify={notify} live={live} />;
}

type LoadedProps = Pick<Props, 'meId' | 'error' | 'hasMore' | 'loadingMore' | 'moreFailed' | 'onMore' | 'selectedId' | 'onOpen' | 'notify' | 'live'> & { jobs: JobSummary[] };

/**
 * The list with its rows. From 1024 px up the page does not scroll and this card fills the height that is left: the table
 * scrolls inside it under a sticky header row, and "Showing N · Show more" is at the end of that scroll area (D-F1-29).
 * Up and Down move between the rows and keep the focused row in view; only one row is a Tab stop (a roving tab stop), so
 * Tab goes filters, list, panel. Opening or closing a distribution does not touch the scroll position: the selected row
 * is only scrolled into view when it is not.
 */
function LoadedList({ meId, jobs, error, hasMore, loadingMore, moreFailed, onMore, selectedId, onOpen, notify, live }: LoadedProps) {
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
              return <Row key={job.jobId} job={job} counts={following} meId={meId} selected={selectedId === job.jobId} tabStop={stop === job.jobId} onOpen={onOpen} notify={notify} />;
            })}
          </tbody>
        </table>
        {hasMore ? (
          <MoreRow className="state small list-foot" busy={loadingMore} failed={moreFailed} onMore={onMore} auto={false} shown={jobs.length} />
        ) : (
          <div className="state small list-foot">
            <span className="shown">Showing {jobs.length}</span>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
