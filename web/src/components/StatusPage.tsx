import { useCallback, useRef, useState, type FormEvent } from 'react';
import { liveClient } from '../live/instance.js';
import type { LiveClient } from '../live/socket.js';
import type { Counts, JobScope, JobStatus } from '../tracking/api.js';
import { jobChip } from '../tracking/format.js';
import { extractJobId } from '../tracking/route.js';
import { usePagedJobs } from '../tracking/usePagedJobs.js';
import { useAudit } from '../tracking/useAudit.js';
import { AuditList } from './AuditList.js';
import { CloseIcon } from './Icons.js';
import { DistributionList } from './DistributionList.js';
import { DistributionPanel } from './DistributionPanel.js';
import { PanelFrame } from './PanelFrame.js';

type Jobs = ReturnType<typeof usePagedJobs>;

const STATUS_OPTIONS: JobStatus[] = ['pending', 'in_progress', 'completed', 'completed_with_errors', 'cancelled'];

interface Props {
  /** The signed-in person's id. */
  meId: string;
  jobId: string | null;
  /** The panel shows the upload events instead of a distribution. */
  uploads?: boolean;
  /** Opens a distribution in the panel, or closes the panel with null. */
  onOpen: (jobId: string | null) => void;
  onOpenUploads: () => void;
  /** My distributions, loaded by the app (it also feeds the badge on the Status tab). */
  mine: Jobs;
  notify: (text: string, kind?: 'ok' | 'error') => void;
  live?: LiveClient;
  /** Counts the sign-ins made from the 12-hour dialog. When it changes, the lists and the open distribution read again. */
  signedInAgain?: number;
}

/**
 * Status and audit in one view (D-F1-7): the distributions, newest first, and a side panel on the same page for
 * the one that is open: its deliveries with Retry and Cancel, then its history of events. The address keeps the
 * open distribution.
 */
export function StatusPage({ meId, jobId, uploads = false, onOpen, onOpenUploads, mine, notify, live = liveClient, signedInAgain = 0 }: Props) {
  const [scope, setScope] = useState<JobScope>('mine');
  const [status, setStatus] = useState<JobStatus | ''>('');
  const [typed, setTyped] = useState('');
  const [typedError, setTypedError] = useState('');
  const [liveCounts, setLiveCounts] = useState<{ jobId: string; counts: Counts } | null>(null);
  const followCounts = useCallback((id: string, counts: Counts) => setLiveCounts({ jobId: id, counts }), []);
  // The app already loads my own list (it feeds the badge on the tab): use it while nothing is filtered.
  const unfiltered = scope === 'mine' && status === '';
  const other = usePagedJobs(scope, !unfiltered, undefined, signedInAgain, status === '' ? undefined : status);
  const list = unfiltered ? mine : other;

  // Any new attempt to open something starts with a clean note.
  // Stable, so the rows of the list (memoised) are not drawn again whenever this page is.
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const open = useCallback((id: string): void => {
    setTypedError('');
    setLiveCounts(null); // counts followed from an earlier look at a distribution are not this one's
    onOpenRef.current(id);
  }, []);

  const openTyped = (event: FormEvent): void => {
    event.preventDefault();
    setTypedError('');
    if (typed.trim() === '') return;
    const id = extractJobId(typed);
    if (!id) {
      setTypedError('Paste the full distribution id or a link to it. The short 8-character id is not enough.');
      return;
    }
    setTyped('');
    open(id);
  };

  const empty = typed.trim() === '';
  const panel = jobId !== null || uploads;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Distributions</h1>
        <div className="toolbar">
          <form className="openid" onSubmit={openTyped}>
            <label className="sr" htmlFor="job-id">
              Open by ID
            </label>
            <input
              id="job-id"
              className="field mono"
              value={typed}
              placeholder="Paste a distribution id or link"
              onChange={(e) => {
                setTyped(e.target.value);
                setTypedError('');
              }}
            />
            <button className="btn2" type="submit" disabled={empty} title={empty ? 'Paste a distribution id or link first' : undefined}>
              Open
            </button>
          </form>
          <button className="btn2" type="button" onClick={onOpenUploads}>
            Upload events
          </button>
        </div>
      </div>
      <div className="filters">
        <div className="seg-group" role="group" aria-label="Whose distributions">
          {(
            [
              ['mine', 'Mine'],
              ['team', 'My teams'],
              ['all', 'All I can see'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" className={`seg ${scope === id ? 'on' : ''}`} aria-pressed={scope === id} onClick={() => setScope(id)}>
              {label}
            </button>
          ))}
        </div>
        <label className="sr" htmlFor="status-filter">
          Status
        </label>
        <select id="status-filter" className="field status-pick" value={status} onChange={(e) => setStatus(e.target.value as JobStatus | '')}>
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((id) => (
            <option key={id} value={id}>
              {jobChip(id).label}
            </option>
          ))}
        </select>
      </div>
      {typedError && (
        <div role="alert" className="alert">
          {typedError}
        </div>
      )}

      <div className={`status-layout ${panel ? 'open' : ''}`}>
        <DistributionList
          meId={meId}
          scope={scope}
          filtered={status !== ''}
          jobs={list.jobs}
          error={list.error}
          hasMore={list.hasMore}
          loadingMore={list.loadingMore}
          moreFailed={list.moreFailed}
          onMore={() => void list.loadMore()}
          onRetry={() => void list.refresh()}
          selectedId={jobId}
          onOpen={open}
          live={jobId ? liveCounts : null}
        />
        {jobId ? (
          <DistributionPanel
            key={jobId}
            jobId={jobId}
            live={live}
            notify={notify}
            onClose={() => {
              onOpen(null);
              // Focus goes back to the row that opened the panel, not to the page.
              requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-job-id="${jobId}"]`)?.focus());
            }}
            onCounts={followCounts}
            signedInAgain={signedInAgain}
            onChanged={() => {
              void mine.refresh();
              if (!unfiltered) void other.refresh();
            }}
          />
        ) : uploads ? (
          <UploadEvents onClose={() => onOpen(null)} signedInAgain={signedInAgain} />
        ) : null}
      </div>
    </div>
  );
}

/** Events that belong to no distribution: a file refused by the malware scan. Only its owner sees them. */
function UploadEvents({ onClose, signedInAgain }: { onClose: () => void; signedInAgain: number }) {
  const history = useAudit({ actions: ['file.refused'], reloadKey: signedInAgain });
  return (
    <PanelFrame label="Upload events" onClose={onClose}>
      <div className="panel-head">
        <h2>Upload events</h2>
        <button className="icon" type="button" aria-label="Close" title="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <div className="panel-body">
        <AuditList {...history} onLoadMore={() => void history.loadMore()} empty="No upload events." />
      </div>
    </PanelFrame>
  );
}
