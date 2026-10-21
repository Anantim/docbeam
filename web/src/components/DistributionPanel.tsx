import { useCallback, useEffect, useRef, useState } from 'react';
import { useThrottled } from './useThrottled.js';
import { useWide } from './useWide.js';
import { ApiFailure } from '../auth/session.js';
import { formatSize } from '../distribute/files.js';
import { JOB_STATUS_MEANING } from '../explain.js';
import type { LiveClient } from '../live/socket.js';
import { trackingApi, type Counts, type JobDetail, type TaskKind, type TaskRow } from '../tracking/api.js';
import { statusFromCounts } from '../tracking/apply.js';
import { formatWhen, jobChip, plural, shortId, taskLook } from '../tracking/format.js';
import { bannerText, isLive } from '../tracking/links.js';
import { useFileLink } from '../tracking/useFileLink.js';
import { useJob } from '../tracking/useJob.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { CopyLinkButton } from './CopyLinkButton.js';
import { CloseIcon } from './Icons.js';
import { JobBar } from './JobBar.js';
import { FILTER_AFTER, ListFilter } from './ListFilter.js';
import { PanelFrame } from './PanelFrame.js';
import { Preview } from './Preview.js';
import { StatusChip } from './StatusChip.js';
import { TeamList } from './TeamList.js';
import { ROW_HEIGHT, TaskTable } from './TaskTable.js';
import { Tooltip } from './Tooltip.js';

interface Props {
  jobId: string;
  live: LiveClient;
  notify: (text: string, kind?: 'ok' | 'error') => void;
  onClose: () => void;
  /** Called after a cancel or a retry, so the list can show the change at once. */
  onChanged: () => void;
  /** Called with the live counts whenever they change, so this distribution's row in the list follows them. */
  onCounts?: (jobId: string, counts: Counts) => void;
  /** Changes after a sign-in from the 12-hour dialog: the distribution and its deliveries are read again. */
  signedInAgain?: number;
  /** Move the focus to the heading when the panel opens (after a send). */
  focusHeading?: boolean;
  /** The viewer's teams, by name, in their own order: for the note a team member sees (D-F1-52). */
  teamNames?: readonly string[];
}

/** "Showing deliveries to your team:" or "… your teams:" (D-F1-52); with no names read yet, "Showing deliveries to your teams" and the full stop after it. */
export function teamNoteLabel(count: number): string {
  if (count === 0) return 'Showing deliveries to your teams';
  return `Showing deliveries to your ${count === 1 ? 'team' : 'teams'}:`;
}

const FILTERS: Array<{ id: TaskKind | 'all'; label: string; key: keyof Counts | 'total' }> = [
  { id: 'all', label: 'All', key: 'total' },
  { id: 'completed', label: 'Completed', key: 'completed' },
  { id: 'failed', label: 'Failed', key: 'failed' },
  { id: 'in_progress', label: 'In progress', key: 'in_progress' },
  { id: 'pending', label: 'Pending', key: 'pending' },
  { id: 'cancelled', label: 'Cancelled', key: 'cancelled' },
];

/**
 * The height the deliveries box is taken to have until the page has laid it out: 10 rows. The box then takes the room
 * the panel has left (the panel is at most as tall as the viewport under the top bar) and the rows scroll inside it,
 * with a fade at the bottom edge (D-F1-26). A distribution of 6 shows all 6 where there is room (D-F1-15).
 */
const TASKS_VIEWPORT = 640;

/**
 * One distribution, in the side panel of the Status view (D-F1-7, D-F1-15): its status, Cancel and Retry for the
 * sender, and the deliveries with their statuses. The progress bar and the filter numbers are the only counts; the
 * numbers move live. There is no history of audit events: the web app shows job history only (D-F1-13).
 */
export function DistributionPanel({ jobId, live, notify, onClose, onChanged, onCounts, signedInAgain = 0, focusHeading = false, teamNames = [] }: Props) {
  const { state, counts, reloadKey, reloadAll } = useJob(jobId, live);
  // Under 1024 px the page scrolls and the panel is under the list: the deliveries box is a fixed height there.
  const wide = useWide();
  // After a send the panel opens by itself: the focus moves to its heading, once (D-F1-31).
  const focused = useRef(false);
  const headingRef = useCallback(
    (el: HTMLHeadingElement | null) => {
      // The heading is drawn again when the panel goes from loading to ready: the focus follows it, unless the person has moved it.
      if (!el || !focusHeading || (focused.current && document.activeElement !== document.body)) return;
      focused.current = true;
      el.focus();
    },
    [focusHeading],
  );
  const seenSignIn = useRef(signedInAgain);
  useEffect(() => {
    if (seenSignIn.current === signedInAgain) return;
    seenSignIn.current = signedInAgain;
    reloadAll();
  }, [signedInAgain, reloadAll]);
  useEffect(() => {
    if (counts) onCounts?.(jobId, counts);
  }, [counts, jobId, onCounts]);
  const [filter, setFilter] = useState<TaskKind | 'all'>('all');
  // The "Filter…" box on the Deliveries row (D-F1-41, D-F1-46): it stays when the status choice changes, and goes with the distribution.
  const [query, setQuery] = useState('');
  const queryBox = useRef<HTMLInputElement>(null);
  useEffect(() => setQuery(''), [jobId]);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const files = useFileLink();
  const liveStatus = state.status === 'ready' ? statusFromCounts(counts ?? state.detail.counts, state.detail.cancelledAt !== null) : null;
  const { preview, download } = files;
  const onPreview = useCallback((t: TaskRow) => void preview(t.fileId, t.fileName), [preview]);
  const onDownload = useCallback((t: TaskRow) => void download(t.fileId, t.fileName), [download]);
  const announcement = state.status === 'ready' ? `${jobChip(liveStatus ?? state.detail.status).label}. ${(counts ?? state.detail.counts).completed} of ${state.detail.taskCount} completed.` : '';
  const announced = useThrottled(announcement, 5_000);

  const close = (
    <Tooltip text="Close">
      <button className="icon" type="button" aria-label="Close" onClick={onClose}>
        <CloseIcon />
      </button>
    </Tooltip>
  );

  if (state.status === 'loading') {
    return (
      <PanelFrame label={`Distribution ${shortId(jobId)}`} onClose={onClose}>
        <div className="panel-head">
          <div className="panel-top">
            <h2 className="mono" tabIndex={-1} ref={headingRef}>
              {shortId(jobId)}
            </h2>
            {close}
          </div>
          <div className="panel-sub">
            <span className="sk sk-lead" />
          </div>
        </div>
        {/* The shape of the panel: the header with its sent-by line, and the deliveries under their real header (D-F1-22, D-F1-46). */}
        <div className="panel-body" role="status" aria-busy="true" aria-label="Loading the distribution">
          <div className="ttable" aria-hidden="true">
            <div className="trow thead">
              <div>Deliveries</div>
              <div>Status</div>
              <div>Details</div>
            </div>
            {Array.from({ length: 4 }, (_, i) => (
              <div className="trow" key={i} style={{ height: ROW_HEIGHT }}>
                <div>
                  <span className="sk sk-file" />
                  <span className="sk sk-path" />
                </div>
                <div>
                  <span className="sk sk-chip" />
                </div>
                <div>
                  <span className="sk sk-date" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </PanelFrame>
    );
  }
  if (state.status === 'notFound') {
    return (
      <PanelFrame label={`Distribution ${shortId(jobId)}`} onClose={onClose}>
        <div className="panel-head">
          <h2>Distribution not found</h2>
          {close}
        </div>
        <div className="state">
          <span>You can see a distribution if you sent it, or if it has deliveries to a team you are in.</span>
        </div>
      </PanelFrame>
    );
  }
  if (state.status === 'error') {
    return (
      <PanelFrame label={`Distribution ${shortId(jobId)}`} onClose={onClose}>
        <div className="panel-head">
          <h2 className="mono" tabIndex={-1} ref={headingRef}>
            {shortId(jobId)}
          </h2>
          {close}
        </div>
        <div role="alert" className="alert panel-alert">
          {state.message}
        </div>
      </PanelFrame>
    );
  }

  const detail: JobDetail = state.detail;
  const c: Counts = counts ?? detail.counts;
  const total = c.pending + c.in_progress + c.completed + c.failed + c.cancelled;
  const status = statusFromCounts(c, detail.cancelledAt !== null);
  const chip = jobChip(status);
  // How many deliveries the status choice shows: the box is there when there are more than 15 of them.
  const chosen = FILTERS.find((f) => f.id === filter);
  const deliveriesShown = chosen ? (chosen.key === 'total' ? total : c[chosen.key]) : total;

  // Cancel is for a distribution that is still running: hidden once it has finished or was cancelled (D-M3-10).
  const running = status === 'pending' || status === 'in_progress';
  const showCancel = detail.isSender && running;
  const canCancel = showCancel && !!detail.cancel?.open && c.pending > 0;
  const canRetry = detail.isSender && !!detail.retry?.open;

  async function act(kind: 'cancel' | 'retry'): Promise<void> {
    setBusy(true);
    try {
      if (kind === 'cancel') {
        const out = await trackingApi.cancel(jobId);
        notify(`${shortId(jobId)}: ${plural(out.cancelled, 'delivery', 'deliveries')} cancelled.`);
      } else {
        const out = await trackingApi.retry(jobId);
        notify(`${shortId(jobId)}: ${plural(out.retried, 'delivery', 'deliveries')} queued again.`);
      }
      onChanged();
    } catch (e) {
      notify(e instanceof ApiFailure ? e.message : 'That did not work. Try again.', 'error');
    } finally {
      setBusy(false);
      setConfirmCancel(false);
      reloadAll();
    }
  }


  return (
    <PanelFrame label={`Distribution ${shortId(jobId)}`} onClose={onClose}>
      {/* The header is dense (D-F1-46): the id, the copy icon, the status and Close on one line; who sent it and when (and, for a
          team member, the note) in one small line under it; then the progress as a 3 px line. The folders are not repeated here:
          the deliveries table shows every one. */}
      <div className="panel-head">
        <div className="panel-top">
          <div className="panel-title">
            <Tooltip text={jobId}>
              <h2 className="mono" tabIndex={-1} ref={headingRef}>
                {shortId(jobId)}
              </h2>
            </Tooltip>
            <CopyLinkButton jobId={jobId} notify={notify} show="always" />
            <StatusChip tone={chip.tone} label={chip.label} meaning={JOB_STATUS_MEANING[status]} big />
          </div>
          {close}
        </div>
        <div className="panel-sub">
          <span className="panel-lead">
            <span className="sentby">Sent by</span> <span className="sender-name">{detail.submittedBy.name}{detail.isSender ? ' (you)' : ''}</span>
            {' · '}
            {formatWhen(detail.createdAt)}
          </span>
          {/* Never for the sender, who sees every delivery; a team member is told whose deliveries these are, after a " · ". It
              stays on this one line: the team names that do not fit are "+N", with every team in the shared popover (D-F1-52, D-F1-53). */}
          {!detail.isSender && (
            <span className="panel-note">
              <span className="panel-sep">{' · '}</span>
              <span className="panel-note-label">{teamNoteLabel(teamNames.length) + (teamNames.length > 0 ? ' ' : '')}</span>
              {teamNames.length > 0 ? <TeamList names={teamNames} panelLabel="Your teams" end="." /> : '.'}
            </span>
          )}
        </div>
        <JobBar counts={c} total={total} />
      </div>

      <div className="panel-body">
        <div className="sr" role="status" aria-live="polite">
          {announced}
        </div>

        {/* The sender always sees the buttons; one that is off says why in its tooltip (D-M3-10, D-F1-47). */}
        {detail.isSender && (showCancel || canRetry || c.failed > 0) && (
          <div className="panel-actions">
            {showCancel && (
              <Tooltip text={canCancel ? undefined : cancelReason(detail, c)}>
                <button className="btn2" type="button" disabled={!canCancel} onClick={() => setConfirmCancel(true)}>
                  Cancel distribution
                </button>
              </Tooltip>
            )}
            {(canRetry || c.failed > 0) && (
              <Tooltip text={canRetry ? undefined : retryReason(detail)}>
                <button className="btn" type="button" disabled={!canRetry || busy} onClick={() => void act('retry')}>
                  Retry failed
                </button>
              </Tooltip>
            )}
          </div>
        )}

        <section className="panel-section" aria-label="Deliveries">
          {/* One row, no title above it (the table's header says "Deliveries", D-F1-50): the status tabs on the left and, past 15
              deliveries, the "Filter…" box on the right, the same height as the tab strip. */}
          <div className="panel-section-head">
            <div className="tfilters" role="group" aria-label="Filter deliveries by status">
              {FILTERS.filter((f) => f.id !== 'cancelled' || c.cancelled > 0 || filter === 'cancelled').map((f) => {
                const n = f.key === 'total' ? total : c[f.key];
                return (
                  <button
                    key={f.id}
                    type="button"
                    className={`tfilter ${filter === f.id ? 'on' : ''}`}
                    aria-pressed={filter === f.id}
                    aria-label={`${f.label}, ${plural(n, 'delivery', 'deliveries')}`}
                    onClick={() => setFilter(f.id)}
                  >
                    {f.id !== 'all' && <span className="tdot" data-tone={taskLook(f.id).tone} />}
                    {f.label}
                    <span className="num">{n}</span>
                  </button>
                );
              })}
            </div>
            {(deliveriesShown > FILTER_AFTER.deliveries || query !== '') && (
              <ListFilter ref={queryBox} value={query} onChange={setQuery} label="Filter deliveries" size="sm" className="deliveries-filter" />
            )}
          </div>
          {files.banner && (
            <div role="status" className={`banner ${isLive(files.banner, files.now) ? '' : 'bad'}`}>
              <span>{bannerText(files.banner, files.now)}</span>
              <button className="btn2 btnsm" type="button" onClick={files.dismiss}>
                Dismiss
              </button>
            </div>
          )}
          <TaskTable
            jobId={jobId}
            status={filter}
            query={query}
            onClearFilter={() => {
              setQuery('');
              queryBox.current?.focus();
            }}
            reloadKey={reloadKey}
            live={live}
            viewportHeight={TASKS_VIEWPORT}
            fill={wide}
            onPreview={onPreview}
            onDownload={onDownload}
          />
        </section>
      </div>

      {files.viewing && (
        <Preview
          name={files.viewing.link.fileName}
          contentType={files.viewing.link.contentType}
          sizeBytes={files.viewing.link.sizeBytes}
          url={files.viewing.link.url}
          meta={formatSize(files.viewing.link.sizeBytes)}
          note="Opened with a 2-minute link for this one file. It is shown in your browser and not stored."
          onClose={files.closePreview}
        />
      )}

      {confirmCancel && (
        <ConfirmDialog
          heading="Cancel this distribution?"
          confirmLabel="Cancel distribution"
          cancelLabel="Keep it going"
          busy={busy}
          onConfirm={() => void act('cancel')}
          onCancel={() => setConfirmCancel(false)}
        >
          <p>
            The {plural(c.pending, 'delivery', 'deliveries')} still waiting will stop and show CANCELLED. Deliveries already running finish. This cannot be undone.
          </p>
        </ConfirmDialog>
      )}
    </PanelFrame>
  );
}

/** Why Cancel is off, for the button's title. */
function cancelReason(detail: JobDetail, c: Counts): string {
  if (detail.cancelledAt !== null) return 'This distribution was already cancelled';
  if (c.pending === 0) return 'Nothing is waiting to be delivered';
  return 'Cancel is not available right now';
}

/** Why Retry is off, for the button's title. */
function retryReason(detail: JobDetail): string {
  switch (detail.retry?.reason) {
    case 'JOB_CANCELLED':
      return 'A cancelled distribution cannot be retried';
    case 'RETRY_WINDOW_CLOSED':
      return 'The retry window closed: it lasts 24 hours after the distribution finished, and its files must be under 2 days old';
    case 'NOTHING_TO_RETRY':
      return 'No failed delivery can be retried. Only RETRIES_EXHAUSTED and FANOUT_FAILED can';
    default:
      return 'Retry is not available right now';
  }
}
