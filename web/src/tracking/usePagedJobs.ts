import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiFailure } from '../auth/session.js';
import { trackingApi, type Counts, type JobSummary } from './api.js';
import { statusFromCounts } from './apply.js';
import { NO_FILTERS, sameFilters, type Filters } from './filters.js';

export const LIST_REFRESH_MS = 30_000;
export const LIST_PAGE = 20;

interface State {
  jobs: JobSummary[] | null;
  error: string;
  /** The server gave a cursor for a next page. */
  hasMore: boolean;
  loadingMore: boolean;
  /** The request for the next page failed (the rows already shown stay). */
  moreFailed: boolean;
}

const first: State = { jobs: null, error: '', hasMore: false, loadingMore: false, moreFailed: false };

/** The rows of `more` that `rows` does not hold yet. The cursor keeps pages from shifting; this guards a refresh that overlaps. */
const unseen = (rows: JobSummary[], more: JobSummary[]): JobSummary[] => {
  const have = new Set(rows.map((j) => j.jobId));
  return more.filter((j) => !have.has(j.jobId));
};

/**
 * Everything the person can see, newest first, 20 at a time, narrowed by the filters (F1, D-F1-21). It loads the first
 * page when it is switched on and `loadMore` adds the next one, by the cursor the server gave. It reloads the pages
 * already shown every 30 seconds, but only while a listed distribution is pending or in progress (TDD Step 3.4: live
 * pushes are for the open one only); a failed load keeps trying too. It also loads again when the person comes back
 * to the tab, signs in again, changes a filter, or calls `refresh` (the app does that after a send). A hidden tab waits.
 */
export function usePagedJobs(filters: Filters = NO_FILTERS, enabled = true, intervalMs = LIST_REFRESH_MS, signedInAgain = 0) {
  const [state, setState] = useState<State>(first);
  const pages = useRef(1);
  const next = useRef<string | null>(null);
  // Only the newest answer counts, so a slow old reply cannot bring back an older list.
  const latest = useRef(0);
  // One next-page request at a time, even when the button is pressed twice before the first answer.
  const moreInFlight = useRef(false);
  // The filters as a value that changes only when a choice does, so the list is not read again for an equal object.
  const held = useRef(filters);
  if (!sameFilters(held.current, filters)) held.current = filters;
  const chosen = held.current;

  const refresh = useCallback(async (): Promise<void> => {
    const ticket = ++latest.current;
    try {
      let jobs: JobSummary[] = [];
      let cursor: string | null = null;
      for (let page = 1; page <= pages.current; page += 1) {
        const got = await trackingApi.jobs(chosen, cursor, LIST_PAGE);
        if (ticket !== latest.current) return;
        jobs = [...jobs, ...unseen(jobs, got.items)];
        cursor = got.nextCursor;
        if (cursor === null) break;
      }
      next.current = cursor;
      setState((s) => ({ ...s, jobs, error: '', hasMore: cursor !== null, loadingMore: false, moreFailed: false }));
    } catch (e) {
      if (ticket === latest.current) setState((s) => ({ ...s, error: e instanceof ApiFailure ? e.message : 'The list could not be loaded.', loadingMore: false }));
    }
  }, [chosen]);

  // The rows now shown, for `loadUntil`, which reads them between two pages without waiting for a draw.
  const shown = useRef<JobSummary[] | null>(null);
  shown.current = state.jobs;

  /** Reads the next page and adds it. The rows it added, or null when nothing was read (no next page, or one is on its way). */
  const fetchNext = useCallback(async (): Promise<JobSummary[] | null> => {
    const cursor = next.current;
    if (shown.current === null || cursor === null || moreInFlight.current) return null;
    moreInFlight.current = true;
    const ticket = ++latest.current;
    setState((s) => ({ ...s, loadingMore: true, moreFailed: false, error: '' }));
    try {
      const got = await trackingApi.jobs(chosen, cursor, LIST_PAGE);
      if (ticket !== latest.current) return null;
      pages.current += 1;
      next.current = got.nextCursor;
      const added = unseen(shown.current ?? [], got.items);
      shown.current = [...(shown.current ?? []), ...added];
      setState((s) => ({ ...s, jobs: [...(s.jobs ?? []), ...unseen(s.jobs ?? [], got.items)], hasMore: got.nextCursor !== null, loadingMore: false, moreFailed: false }));
      return added;
    } catch (e) {
      if (ticket === latest.current) setState((s) => ({ ...s, error: e instanceof ApiFailure ? e.message : 'The list could not be loaded.', loadingMore: false, moreFailed: true }));
      return null;
    } finally {
      moreInFlight.current = false;
    }
  }, [chosen]);

  const loadMore = useCallback(async (): Promise<void> => {
    await fetchNext();
  }, [fetchNext]);

  /**
   * Reads pages until the list holds the distribution, but not more than `maxPages`. True when it is in the list, false when
   * it is not (the end of the list, a failed page, or too far: the page then shows it on its own, D-F1-74).
   */
  const loadUntil = useCallback(
    async (jobId: string, maxPages: number): Promise<boolean> => {
      if (shown.current?.some((j) => j.jobId === jobId)) return true;
      for (let page = 0; page < maxPages; page += 1) {
        const added = await fetchNext();
        if (added === null) return false;
        if (added.some((j) => j.jobId === jobId)) return true;
      }
      return false;
    },
    [fetchNext],
  );

  useEffect(() => {
    if (!enabled) return;
    pages.current = 1;
    next.current = null;
    moreInFlight.current = false; // a next-page request of the old filters must not block the new ones; its answer is ignored by the ticket
    setState(first);
    void refresh();
    // `signedInAgain` changes after a sign-in from the 12-hour dialog: start clean, so an old "sign-in has ended" goes.
  }, [enabled, refresh, signedInAgain]);

  // Coming back to the tab loads the list once more, whether or not anything is running.
  useEffect(() => {
    if (!enabled) return;
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [enabled, refresh]);

  const running = runningCount(state.jobs) > 0 || state.error !== '';
  useEffect(() => {
    if (!enabled || !running) return;
    const id = setInterval(() => {
      if (document.visibilityState !== 'hidden') void refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [enabled, running, refresh, intervalMs]);

  return { ...state, refresh, loadMore, loadUntil };
}

/**
 * How many of the distributions in the list are pending or in progress, for the badge on the Status tab. The app counts
 * its own unfiltered list, so a filter never changes the badge. The distribution that is open follows its live counts,
 * so the badge drops the moment it finishes and does not wait for the next refresh.
 */
export function runningCount(jobs: JobSummary[] | null, live: { jobId: string; counts: Counts } | null = null): number {
  return (jobs ?? []).filter((j) => {
    const status = live && live.jobId === j.jobId ? statusFromCounts(live.counts, j.status === 'cancelled') : j.status;
    return status === 'pending' || status === 'in_progress';
  }).length;
}
