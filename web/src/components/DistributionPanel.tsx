import { useCallback, useEffect, useRef, useState } from 'react';
import { num } from '../text.js';
import { useThrottled } from './useThrottled.js';
import { useWide } from './useWide.js';
import { ApiFailure } from '../auth/session.js';
import { formatSize } from '../distribute/files.js';
import { JOB_STATUS_MEANING, RETRY_ENDED } from '../explain.js';
import type { LiveClient } from '../live/socket.js';
import { describeDestination } from '../distribute/mapping.js';
import { trackingApi, type Counts, type JobDetail, type TaskRow } from '../tracking/api.js';
import { statusFromCounts } from '../tracking/apply.js';
import { jobChip, plural, shortId, taskLook } from '../tracking/format.js';
import { TAB_LABEL, tabCount, tabsFor, total, type TabId } from '../tracking/panelTabs.js';
import { When } from './When.js';
import { bannerParts, isLive } from '../tracking/links.js';
import { useFileLink } from '../tracking/useFileLink.js';
import { useJob } from '../tracking/useJob.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { CopyLinkButton } from './CopyLinkButton.js';
import { CloseIcon, RetryIcon, StopIcon } from './Icons.js';
import { JobBar } from './JobBar.js';
import { ListFilter } from './ListFilter.js';
import { Notice } from './Notice.js';
import { PanelFrame } from './PanelFrame.js';
import { Preview } from './Preview.js';
import { StatusChip } from './StatusChip.js';
import { TeamChips } from './TeamChips.js';
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
  /** The status tab to start on, for a status that a link asks for. It is shown, selected, even when its count is 0 (D-F1-77). */
  initialTab?: TabId;
}

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
export function DistributionPanel({ jobId, live, notify, onClose, onChanged, onCounts, signedInAgain = 0, focusHeading = false, initialTab = 'all' }: Props) {
  const { state, counts, reloadKey, reloadAll, firstTasks } = useJob(jobId, live);
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
  const [picked, setPicked] = useState<TabId>(initialTab);
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
  const announcement = state.status === 'ready' ? `${jobChip(liveStatus ?? state.detail.status).label}. ${num((counts ?? state.detail.counts).completed)} of ${num(state.detail.taskCount)} completed.` : '';
  const announced = useThrottled(announcement, 5_000);

  const close = (
    <Tooltip text="Close">
      <button className="icon" type="button" aria-label="Close" onClick={onClose}>
        <CloseIcon />
      </button>
    </Tooltip>
  );

  // The header of every state without a distribution to show yet: the short ID as the heading, and Close (D-F1-78).
  const stateHeader = (
    <div className="panel-head">
      <div className="panel-top">
        <h2 className="mono" tabIndex={-1} ref={headingRef}>
          {shortId(jobId)}
        </h2>
        {close}
      </div>
    </div>
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
        {stateHeader}
        <Notice className="in-card" heading="Distribution not found." detail="You can see a distribution if you sent it, or if it has deliveries to a team you are in." />
      </PanelFrame>
    );
  }
  if (state.status === 'error') {
    return (
      <PanelFrame label={`Distribution ${shortId(jobId)}`} onClose={onClose}>
        {stateHeader}
        <Notice className="in-card" heading={state.message} onRetry={reloadAll} />
      </PanelFrame>
    );
  }

  const detail: JobDetail = state.detail;
  const c: Counts = counts ?? detail.counts;
  const all = total(c);
  const status = statusFromCounts(c, detail.cancelledAt !== null);
  const chip = jobChip(status);
  // The tabs to show, and the one selected (D-F1-77). The deliveries box is for the selected tab's deliveries; it is off when there are none.
  const { tabs, selected: filter } = tabsFor(c, picked);
  const deliveriesShown = tabCount(c, filter);
  // The teams of the viewer that this distribution reaches: the folders it lists are only the ones they may see (no new API).
  const teams = detail.destinations.map((p) => describeDestination(p).team);

  // Cancel is for a distribution that is still running: hidden once it has finished or was cancelled (D-M3-10). Retry is for
  // the sender, and only when there is a failed delivery that can be tried again.
  const running = status === 'pending' || status === 'in_progress';
  const showCancel = detail.isSender && running;
  const canCancel = showCancel && !!detail.cancel?.open && c.pending > 0;
  const canRetry = detail.isSender && !!detail.retry?.open;
  const retryNote = detail.isSender && c.failed > 0 && detail.retry && !detail.retry.open ? RETRY_ENDED[detail.retry.reason ?? ''] : undefined;

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
          {/* The sender's two actions are icons just left of Close, then a thin divider; with neither, only Close (D-F1-77). Each
              one's full name is its tooltip and its accessible name. */}
          <div className="panel-tools">
            {showCancel && (
              <Tooltip text={canCancel ? 'Cancel distribution' : cancelReason(detail, c)}>
                <button className="icon" type="button" aria-label="Cancel distribution" disabled={!canCancel || busy} onClick={() => setConfirmCancel(true)}>
                  <StopIcon />
                </button>
              </Tooltip>
            )}
            {canRetry && (
              <Tooltip text="Retry failed deliveries">
                <button className="icon" type="button" aria-label="Retry failed deliveries" disabled={busy} onClick={() => void act('retry')}>
                  <RetryIcon />
                </button>
              </Tooltip>
            )}
            {(showCancel || canRetry) && <span className="panel-divider" aria-hidden="true" />}
            {close}
          </div>
        </div>
        <div className="panel-sub">
          <span className="panel-lead">
            <span className="sentby">Sent by</span> <span className="sender-name">{detail.submittedBy.name}{detail.isSender ? ' (you)' : ''}</span>
            {' · '}
            <When iso={detail.createdAt} />
          </span>
          {/* Never for the sender, who sees every delivery; a team member is told whose deliveries these are, on the same line (D-F1-77). */}
          {!detail.isSender && <TeamChips teams={teams} />}
        </div>
        <JobBar counts={c} total={all} focusable />
      </div>

      {/* For the sender, when deliveries failed and Retry can no longer help: say so and what to do (D-F1-81). The API already says why. */}
      {retryNote && <Notice tone="info" className="in-card" heading={retryNote} />}

      <div className="panel-body">
        <div className="sr" role="status" aria-live="polite">
          {announced}
        </div>

        <section className="panel-section" aria-label="Deliveries">
          {/* One row, no title above it (the table's header says "Deliveries", D-F1-50): the status tabs on the left and the
              "Filter…" box on the right. The box is always there; it is off while the selected tab has no deliveries (D-F1-77). */}
          <div className="panel-section-head">
            <div className="tfilters" role="group" aria-label="Filter deliveries by status">
              {tabs.map((id) => {
                const n = tabCount(c, id);
                return (
                  <button
                    key={id}
                    type="button"
                    className={`tfilter ${filter === id ? 'on' : ''}`}
                    aria-pressed={filter === id}
                    aria-label={`${TAB_LABEL[id]}, ${plural(n, 'delivery', 'deliveries')}`}
                    onClick={() => setPicked(id)}
                  >
                    {id !== 'all' && <span className="tdot" data-tone={taskLook(id).tone} />}
                    {TAB_LABEL[id]}
                    <span className="num">{num(n)}</span>
                  </button>
                );
              })}
            </div>
            <ListFilter ref={queryBox} value={query} onChange={setQuery} label="Filter deliveries" className="deliveries-filter" disabled={deliveriesShown === 0 && query === ''} />
          </div>
          {files.banner && <Notice tone={isLive(files.banner, files.now) ? 'info' : 'error'} {...bannerParts(files.banner, files.now)} onClose={files.dismiss} />}
          <TaskTable
            jobId={jobId}
            status={filter}
            query={query}
            onClearFilter={() => {
              setQuery('');
              queryBox.current?.focus();
            }}
            reloadKey={reloadKey}
            first={firstTasks}
            firstCovers={all > 0 && c.completed === all}
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
          <p>The deliveries still waiting will stop. Deliveries already running finish. This can't be undone.</p>
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
