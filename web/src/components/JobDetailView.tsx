import { useEffect, useRef, useState } from 'react';
import { ApiFailure } from '../auth/session.js';
import type { LiveClient } from '../live/socket.js';
import { trackingApi, type Counts, type JobDetail, type TaskKind } from '../tracking/api.js';
import { JOB_STATUS_MEANING } from '../explain.js';
import { CANCELLED_GREY } from './JobList.js';
import { statusFromCounts } from '../tracking/apply.js';
import { formatWhen, jobChip, plural, shortId, taskLook } from '../tracking/format.js';
import { useAudit } from '../tracking/useAudit.js';
import { formatSize } from '../distribute/files.js';
import { bannerText, isLive } from '../tracking/links.js';
import { useFileLink } from '../tracking/useFileLink.js';
import { useJob } from '../tracking/useJob.js';
import { AuditList } from './AuditList.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { StatusChip, TONES } from './StatusChip.js';
import { DestinationChips } from './DestinationChips.js';
import { Preview } from './Preview.js';
import { TaskTable } from './TaskTable.js';

interface Props {
  jobId: string;
  live: LiveClient;
  notify: (text: string, kind?: 'ok' | 'error') => void;
  /** Called after a cancel or a retry, so the list can show the change at once. */
  onChanged: () => void;
  /** Called with the live counts whenever they change, so this distribution's card in the list follows them. */
  onCounts?: (jobId: string, counts: Counts) => void;
  /** Changes after a sign-in from the 12-hour dialog: the distribution, its deliveries and its audit are read again. */
  signedInAgain?: number;
}

const FILTERS: Array<{ id: TaskKind | 'all'; label: string; key: keyof Counts | 'total' }> = [
  { id: 'all', label: 'All', key: 'total' },
  { id: 'completed', label: 'Delivered', key: 'completed' },
  { id: 'failed', label: 'Failed', key: 'failed' },
  { id: 'in_progress', label: 'In progress', key: 'in_progress' },
  { id: 'pending', label: 'Waiting', key: 'pending' },
  { id: 'cancelled', label: 'Cancelled', key: 'cancelled' },
];

const teamsOf = (paths: string[]): string[] => [...new Set(paths.map((p) => p.split(' / ')[0] ?? ''))].filter(Boolean);
const joinNames = (names: string[]): string => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** One distribution: counts that move, the deliveries, Retry and Cancel for the sender, and its Audit tab. */
export function JobDetailView({ jobId, live, notify, onChanged, onCounts, signedInAgain = 0 }: Props) {
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
  const [tab, setTab] = useState<'deliveries' | 'audit'>('deliveries');
  const [filter, setFilter] = useState<TaskKind | 'all'>('all');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const files = useFileLink();
  // Both only grow, so the sum changes whenever either does: a reload of the deliveries, or a new link event.
  const audit = useAudit({ jobId, actions: [], reloadKey: reloadKey + files.issued });

  if (state.status === 'loading') return <div className="card jempty" aria-busy="true">Loading the distribution…</div>;
  if (state.status === 'notFound') {
    return (
      <div className="card notfound">
        <span className="notfound-icon" aria-hidden="true">⌕</span>
        <h2>Distribution not found</h2>
        <p>It does not exist, or you do not have access to it. You can see a distribution if you sent it or share a team with the person who did.</p>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div role="alert" className="alert">
        {state.message}
      </div>
    );
  }

  const detail: JobDetail = state.detail;
  const c: Counts = counts ?? detail.counts;
  const total = c.pending + c.in_progress + c.completed + c.failed + c.cancelled;
  const status = statusFromCounts(c, detail.cancelledAt !== null);
  const chip = jobChip(status);
  const teams = teamsOf(detail.destinations);
  const bar = (n: number): number => (total > 0 ? (n / total) * 100 : 0);

  // Cancel is for a distribution that is still running: hidden once it has finished or was cancelled (D-M3-10).
  const running = status === 'pending' || status === 'in_progress';
  const showCancel = detail.isSender && running;
  const canCancel = showCancel && !!detail.cancel?.open && c.pending > 0;
  const canRetry = detail.isSender && !!detail.retry?.open;
  const retryable = detail.retry?.retryable ?? 0;
  // Real failures only: a cancelled delivery is not a failure and has nothing to retry (D-M3-17). A cancelled
  // distribution still tells its sender why Retry is off.
  const retryNote = !canRetry && (c.failed > 0 || (detail.isSender && detail.cancelledAt !== null)) ? retryNoteFor(detail) : '';

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
    <>
      <div className="card jhead">
        <div className="jhead-top">
          <div className="grow">
            <div className="jtitle">
              <h2 className="mono" title={jobId}>
                {shortId(jobId)}
              </h2>
              <StatusChip tone={chip.tone} label={chip.label} title={JOB_STATUS_MEANING[status]} big role="status" />
              <button className="link" type="button" onClick={copyLink}>
                Copy link
              </button>
            </div>
            <div className="lead jmeta">
              {detail.isSender
                ? `Sent by you, ${formatWhen(detail.createdAt)}. ${plural(detail.fileCount ?? 0, 'file', 'files')} to ${plural(detail.destinations.length, 'destination', 'destinations')}, ${plural(total, 'delivery', 'deliveries')}.`
                : `Sent by ${detail.submittedBy.name}, ${formatWhen(detail.createdAt)}. You see ${plural(total, 'delivery', 'deliveries')}, the ones to ${joinNames(teams)}.`}
            </div>
            {!detail.isSender && (
              <div className="jshared">
                You can see this because it has deliveries to {joinNames(teams)}, a team you are in. Deliveries to other teams are hidden from you, and so are their files.
              </div>
            )}
            <div className="chips jdest">
              <span className="plabel">Sent to</span>
              <DestinationChips paths={detail.destinations} visible={3} />
            </div>
          </div>
          {/* The sender always sees the buttons; one that is off says why in its title (D-M3-10). */}
          {showCancel && (
            <button
              className="btn2"
              type="button"
              disabled={!canCancel}
              title={canCancel ? undefined : cancelReason(detail, c)}
              onClick={() => setConfirmCancel(true)}
            >
              Cancel distribution
            </button>
          )}
          {detail.isSender && (canRetry || c.failed > 0) && (
            <button
              className="btn"
              type="button"
              disabled={!canRetry || busy}
              title={canRetry ? undefined : retryReason(detail)}
              onClick={() => void act('retry')}
            >
              Retry failed deliveries
            </button>
          )}
        </div>
        {canRetry && (
          <div className="jwarn">
            {plural(retryable, 'delivery', 'deliveries')} failed for a reason a retry can fix (RETRIES_EXHAUSTED or FANOUT_FAILED).
            {c.failed > retryable ? ` ${c.failed - retryable} failed for a reason a retry cannot fix and will stay failed.` : ''} Retry is open for 24 hours after the distribution first finishes, while its files are less than 2 days old.
          </div>
        )}
        {canCancel && (
          <div className="jnote">
            Cancel distribution stops the {plural(c.pending, 'delivery', 'deliveries')} still waiting. Deliveries already running finish.
          </div>
        )}
        {retryNote && <div className="jnote">{retryNote}</div>}

        <div className="jcounts" aria-label="Counts">
          <div>
            <div className="lead">Delivered</div>
            <div className="n" style={{ color: '#067647' }}>{c.completed}</div>
          </div>
          <div>
            <div className="lead">Failed</div>
            <div className="n" style={{ color: '#B42318' }}>{c.failed}</div>
          </div>
          <div>
            <div className="lead">In progress</div>
            <div className="n" style={{ color: '#2B59C3' }}>{c.in_progress}</div>
          </div>
          <div>
            <div className="lead">Waiting</div>
            <div className="n" style={{ color: '#344054' }}>{c.pending}</div>
          </div>
          {c.cancelled > 0 && (
            <div>
              <div className="lead">Cancelled</div>
              <div className="n" style={{ color: '#667085' }}>{c.cancelled}</div>
            </div>
          )}
        </div>
        <div className="jbar thick" aria-hidden="true">
          <div style={{ width: `${bar(c.completed)}%`, background: '#12B76A' }} />
          <div style={{ width: `${bar(c.failed)}%`, background: '#F04438' }} />
          <div style={{ width: `${bar(c.in_progress)}%`, background: '#2B59C3' }} />
          <div style={{ width: `${bar(c.cancelled)}%`, background: CANCELLED_GREY }} />
        </div>
      </div>

      <div className="card jbody">
        <div className="jtabs-row">
          <div className="jtabs" role="tablist" aria-label="Distribution detail">
            {(
              [
                ['deliveries', 'Deliveries', total],
                ['audit', 'Audit', null],
              ] as const
            ).map(([id, label, n]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={`jtab ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>
                {label}
                {n !== null && <span className="count-pill">{n}</span>}
              </button>
            ))}
          </div>
          {tab === 'deliveries' && (
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
                    {f.id !== 'all' && <span className="tdot" style={{ background: TONES[taskLook(f.id).tone].dot }} />}
                    {f.label}
                    <span className="num">{n}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {files.banner && (
          <div role="status" className="banner link-banner" style={{ background: isLive(files.banner, files.now) ? '#EEF3FF' : '#FEF3F2' }}>
            <span>{bannerText(files.banner, files.now)}</span>
            <button className="btn2" type="button" onClick={files.dismiss}>
              Dismiss
            </button>
          </div>
        )}
        {tab === 'deliveries' ? (
          <div className="table-scroll">
            <TaskTable
              jobId={jobId}
              status={filter}
              reloadKey={reloadKey}
              live={live}
              onPreview={(t) => void files.preview(t.fileId, t.fileName)}
              onDownload={(t) => void files.download(t.fileId, t.fileName)}
            />
          </div>
        ) : (
          <AuditList {...audit} onLoadMore={() => void audit.loadMore()} empty="No events recorded for this distribution yet." />
        )}
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
    </>
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

function retryNoteFor(detail: JobDetail): string {
  if (!detail.isSender) return `Only ${detail.submittedBy.name}, who sent this distribution, can retry its failed deliveries.`;
  const reason = detail.retry?.reason;
  if (reason === 'JOB_CANCELLED') return 'This distribution was cancelled, so Retry is off. To try again, send these files as a new distribution.';
  if (reason === 'RETRY_WINDOW_CLOSED') return 'The 24-hour retry window has passed. To try again, send these files as a new distribution.';
  return '';
}
