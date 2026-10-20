import { useCallback, useEffect, useRef, useState } from 'react';
import { liveClient } from '../live/instance.js';
import type { LiveClient } from '../live/socket.js';
import type { Counts } from '../tracking/api.js';
import { isUnfiltered, type Filters } from '../tracking/filters.js';
import { useFilterChoices } from '../tracking/useFilterChoices.js';
import { usePagedJobs } from '../tracking/usePagedJobs.js';
import { DistributionList } from './DistributionList.js';
import { DistributionPanel } from './DistributionPanel.js';
import { FilterBar } from './FilterBar.js';
import { OpenById } from './OpenById.js';

type Jobs = ReturnType<typeof usePagedJobs>;

interface Props {
  /** The signed-in person's id. */
  meId: string;
  jobId: string | null;
  /** The filters of the list, from the address. */
  filters: Filters;
  /** Sets the filters (and so the address). */
  onFilters: (filters: Filters) => void;
  /** Opens a distribution in the panel, or closes the panel with null. */
  onOpen: (jobId: string | null) => void;
  /** Everything I can see, unfiltered, loaded by the app (it also feeds the badge on the Status tab). */
  all: Jobs;
  /** Told the live counts of the open distribution, so the badge on the tab follows them. */
  onLive?: (jobId: string, counts: Counts) => void;
  notify: (text: string, kind?: 'ok' | 'error') => void;
  live?: LiveClient;
  /** Counts the sign-ins made from the 12-hour dialog. When it changes, the lists and the open distribution read again. */
  signedInAgain?: number;
  /** The distribution that was just sent: its panel takes the focus when it opens (D-F1-31). */
  focusJobId?: string | null;
}

/**
 * Status: every distribution the person can see, newest first (D-F1-7, D-F1-15, D-F1-21), with one row of filters above.
 * When one is open its panel takes about 60 % of the width and the list narrows to a compact column (id, sender, status,
 * when). Esc or Close brings the full list back. The address keeps the open distribution and the filters. The web app
 * shows job history only: no audit trail (D-F1-13).
 */
export function StatusPage({ meId, jobId, filters, onFilters, onOpen, all, onLive, notify, live = liveClient, signedInAgain = 0, focusJobId = null }: Props) {
  const [liveCounts, setLiveCounts] = useState<{ jobId: string; counts: Counts } | null>(null);
  // The app already loads the unfiltered list (it feeds the badge on the tab): use it while nothing is filtered.
  const unfiltered = isUnfiltered(filters);
  const other = usePagedJobs(filters, !unfiltered, undefined, signedInAgain);
  const list = unfiltered ? all : other;
  const choices = useFilterChoices(true, signedInAgain);

  // Opening Status reads the list again: the app's list is polled only while something runs, so a distribution that
  // someone sent to my team since it was last read is shown now and not at the next poll (D-F1-25).
  const refreshAll = useRef(all.refresh);
  refreshAll.current = all.refresh;
  useEffect(() => {
    void refreshAll.current();
  }, []);

  const onLiveRef = useRef(onLive);
  onLiveRef.current = onLive;
  const followCounts = useCallback((id: string, counts: Counts) => {
    setLiveCounts({ jobId: id, counts });
    onLiveRef.current?.(id, counts);
  }, []);

  // When the open distribution finishes, its row and the badge on the tab are read again at once, not at the next
  // refresh 30 seconds later (D-F1-15).
  const finished = liveCounts !== null && liveCounts.counts.pending + liveCounts.counts.in_progress === 0;
  const refreshRef = useRef({ all: all.refresh, other: other.refresh, unfiltered });
  refreshRef.current = { all: all.refresh, other: other.refresh, unfiltered };
  useEffect(() => {
    if (!finished) return;
    void refreshRef.current.all();
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
    // From 1024 px up the page itself does not scroll (D-F1-29); the list and the panel scroll in their own areas.
    <div className="page page-fixed">
      <div className="page-head">
        <h1>Distributions</h1>
        <OpenById onOpen={open} meId={meId} />
      </div>
      <FilterBar filters={filters} onChange={onFilters} meId={meId} members={choices.members} teams={choices.teams} />

      <div className={`status-layout ${jobId ? 'open' : ''}`}>
        <DistributionList
          meId={meId}
          filtered={!unfiltered}
          onClearFilters={() => onFilters({})}
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
            focusHeading={focusJobId === jobId}
            onChanged={() => {
              void all.refresh();
              if (!unfiltered) void other.refresh();
            }}
          />
        )}
      </div>
    </div>
  );
}
