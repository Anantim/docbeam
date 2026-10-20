import { useCallback, useEffect, useRef, useState } from 'react';
import { useThrottled } from './useThrottled.js';
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
import { DestinationChips } from './DestinationChips.js';
import { CloseIcon } from './Icons.js';
import { JobBar } from './JobBar.js';
import { PanelFrame } from './PanelFrame.js';
import { Preview } from './Preview.js';
import { StatusChip } from './StatusChip.js';
import { TaskTable } from './TaskTable.js';

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
 * How tall the deliveries table may grow before it scrolls inside the panel: 10 rows. A distribution of 6 deliveries
 * shows all 6; the 5-row box of 320 px that came before hid the sixth (D-F1-15).
 */
const TASKS_VIEWPORT = 640;

/**
 * One distribution, in the side panel of the Status view (D-F1-7, D-F1-15): its status, Cancel and Retry for the
 * sender, and the deliveries with their statuses. The progress bar and the filter numbers are the only counts; the
 * numbers move live. There is no history of audit events: the web app shows job history only (D-F1-13).
 */
export function DistributionPanel({ jobId, live, notify, onClose, onChanged, onCounts, signedInAgain = 0 }: Props) {
  const { state, counts, reloadKey, reloadAll } = useJob(jobId, live);
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
    <button className="icon" type="button" aria-label="Close" title="Close" onClick={onClose}>
      <CloseIcon />
    </button>
  );

  if (state.status === 'loading') {
    return (
      <PanelFrame label={`Distribution ${shortId(jobId)}`} onClose={onClose}>
        <div className="panel-head">
          <h2 className="mono">{shortId(jobId)}</h2>
          {close}
        </div>
        <div className="state small" role="status" aria-busy="true">
          Loading the distribution…
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
          <h2 className="mono">{shortId(jobId)}</h2>
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

  const copyLink = (): void => {
    void navigator.clipboard
      ?.writeText(`${window.location.origin}/#/status/${jobId}`)
      .then(() => notify('Link copied.'))
      .catch(() => notify('The link could not be copied.', 'error'));
  };

  return (
    <PanelFrame label={`Distribution ${shortId(jobId)}`} onClose={onClose}>
      <div className="panel-head">
        <div className="panel-title">
          <h2 className="mono" title={jobId}>
            {shortId(jobId)}
          </h2>
          <StatusChip tone={chip.tone} label={chip.label} title={JOB_STATUS_MEANING[status]} big />
        </div>
        <button className="link" type="button" onClick={copyLink}>
          Copy link
        </button>
        {close}
      </div>

      <div className="panel-body">
        <div className="sr" role="status" aria-live="polite">
          {announced}
        </div>
        <div className="lead">
          {detail.isSender ? 'You' : detail.submittedBy.name}, {formatWhen(detail.createdAt)}
          {detail.isSender ? '' : '. Only the deliveries to your teams are shown.'}
        </div>
        <div className="chips jdest">
          <DestinationChips paths={detail.destinations} visible={3} />
        </div>
        <JobBar counts={c} total={total} />

        {/* The sender always sees the buttons; one that is off says why in its title (D-M3-10). */}
        {detail.isSender && (showCancel || canRetry || c.failed > 0) && (
          <div className="panel-actions">
            {showCancel && (
              <button className="btn2" type="button" disabled={!canCancel} title={canCancel ? undefined : cancelReason(detail, c)} onClick={() => setConfirmCancel(true)}>
                Cancel distribution
              </button>
            )}
            {(canRetry || c.failed > 0) && (
              <button className="btn" type="button" disabled={!canRetry || busy} title={canRetry ? undefined : retryReason(detail)} onClick={() => void act('retry')}>
                Retry failed
              </button>
            )}
          </div>
        )}

        <section className="panel-section" aria-label="Deliveries">
          <div className="panel-section-head">
            <h3>Deliveries</h3>
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
            reloadKey={reloadKey}
            live={live}
            viewportHeight={TASKS_VIEWPORT}
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
          title="Cancel this distribution?"
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
