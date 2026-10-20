import { useCallback, useEffect, useRef, useState } from 'react';
import { liveClient } from '../live/instance.js';
import type { LiveClient } from '../live/socket.js';
import type { Counts, JobScope, JobStatus } from '../tracking/api.js';
import { jobChip } from '../tracking/format.js';
import { usePagedJobs } from '../tracking/usePagedJobs.js';
import { DistributionList } from './DistributionList.js';
import { DistributionPanel } from './DistributionPanel.js';
import { OpenById } from './OpenById.js';

type Jobs = ReturnType<typeof usePagedJobs>;

const STATUS_OPTIONS: JobStatus[] = ['pending', 'in_progress', 'completed', 'completed_with_errors', 'cancelled'];

interface Props {
  /** The signed-in person's id. */
  meId: string;
  jobId: string | null;
  /** Opens a distribution in the panel, or closes the panel with null. */
  onOpen: (jobId: string | null) => void;
  /** My distributions, loaded by the app (it also feeds the badge on the Status tab). */
  mine: Jobs;
  /** Told the live counts of the open distribution, so the badge on the tab follows them. */
  onLive?: (jobId: string, counts: Counts) => void;
  notify: (text: string, kind?: 'ok' | 'error') => void;
  live?: LiveClient;
  /** Counts the sign-ins made from the 12-hour dialog. When it changes, the lists and the open distribution read again. */
  signedInAgain?: number;
}

/**
 * Status: the distributions, newest first (D-F1-7, D-F1-15). When one is open its panel takes about 60 % of the width
 * and the list narrows to a compact column (id, status, when). Esc or Close brings the full list back. The address
 * keeps the open distribution. The web app shows job history only: no audit trail (D-F1-13).
 */
export function StatusPage({ meId, jobId, onOpen, mine, onLive, notify, live = liveClient, signedInAgain = 0 }: Props) {
  const [scope, setScope] = useState<JobScope>('mine');
  const [status, setStatus] = useState<JobStatus | ''>('');
  const [liveCounts, setLiveCounts] = useState<{ jobId: string; counts: Counts } | null>(null);
  // The app already loads my own list (it feeds the badge on the tab): use it while nothing is filtered.
  const unfiltered = scope === 'mine' && status === '';
  const other = usePagedJobs(scope, !unfiltered, undefined, signedInAgain, status === '' ? undefined : status);
  const list = unfiltered ? mine : other;

  const onLiveRef = useRef(onLive);
  onLiveRef.current = onLive;
  const followCounts = useCallback((id: string, counts: Counts) => {
    setLiveCounts({ jobId: id, counts });
    onLiveRef.current?.(id, counts);
  }, []);

  // When the open distribution finishes, its row and the badge on the tab are read again at once, not at the next
  // refresh 30 seconds later (D-F1-15).
  const finished = liveCounts !== null && liveCounts.counts.pending + liveCounts.counts.in_progress === 0;
  const refreshRef = useRef({ mine: mine.refresh, other: other.refresh, unfiltered });
  refreshRef.current = { mine: mine.refresh, other: other.refresh, unfiltered };
  useEffect(() => {
    if (!finished) return;
    void refreshRef.current.mine();
    if (!refreshRef.current.unfiltered) void refreshRef.current.other();
  }, [finished, liveCounts?.jobId]);

  // Stable, so the rows of the list (memoised) are not drawn again whenever this page is.
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const open = useCallback((id: string): void => {
    setLiveCounts(null); // counts followed from an earlier look at a distribution are not this one's
    onOpenRef.current(id);
  }, []);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Distributions</h1>
        <OpenById onOpen={open} />
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

      <div className={`status-layout ${jobId ? 'open' : ''}`}>
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
          notify={notify}
          live={jobId ? liveCounts : null}
        />
        {jobId && (
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
        )}
      </div>
    </div>
  );
}
