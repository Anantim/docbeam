import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiFailure } from '../auth/session.js';
import { trackingApi, type JobSummary } from './api.js';

export const LIST_REFRESH_MS = 30_000;
export const LIST_PAGE = 20;

interface State {
  jobs: JobSummary[] | null;
  error: string;
  /** A full last page means another may follow. */
  hasMore: boolean;
  loadingMore: boolean;
}

const first: State = { jobs: null, error: '', hasMore: false, loadingMore: false };

/** The rows of `more` that `rows` does not hold yet: a new distribution shifts the pages, so a row can come twice. */
const unseen = (rows: JobSummary[], more: JobSummary[]): JobSummary[] => {
  const have = new Set(rows.map((j) => j.jobId));
  return more.filter((j) => !have.has(j.jobId));
};

/**
 * A list of distributions, newest first, 20 at a time (F1 part C, D-F1-7). It loads the first page when it is
 * switched on and `loadMore` adds the next. It reloads the pages already shown every 30 seconds, but only while
 * a listed distribution is pending or in progress (TDD Step 3.4: live pushes are for the open one only); a failed
 * load keeps trying too. It also loads again when the person comes back to the tab, signs in again, or calls
 * `refresh` (the app does that after a send). A hidden tab waits.
 */
export function usePagedJobs(scope: 'mine' | 'team', enabled = true, intervalMs = LIST_REFRESH_MS, signedInAgain = 0) {
  const [state, setState] = useState<State>(first);
  const pages = useRef(1);
  // Only the newest answer counts, so a slow old reply cannot bring back an older list.
  const latest = useRef(0);
  // One next-page request at a time, even when the end of the list asks twice before the first answer.
  const moreInFlight = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    const ticket = ++latest.current;
    try {
      let jobs: JobSummary[] = [];
      let lastLength = 0;
      for (let page = 1; page <= pages.current; page += 1) {
        const rows = await trackingApi.jobs(scope, page, LIST_PAGE);
        if (ticket !== latest.current) return;
        jobs = [...jobs, ...unseen(jobs, rows)];
        lastLength = rows.length;
        if (rows.length < LIST_PAGE) break;
      }
      setState((s) => ({ ...s, jobs, error: '', hasMore: lastLength === LIST_PAGE, loadingMore: false }));
    } catch (e) {
      if (ticket === latest.current) setState((s) => ({ ...s, error: e instanceof ApiFailure ? e.message : 'The list could not be loaded.', loadingMore: false }));
    }
  }, [scope]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (state.jobs === null || !state.hasMore || state.loadingMore || moreInFlight.current) return;
    moreInFlight.current = true;
    const ticket = ++latest.current;
    setState((s) => ({ ...s, loadingMore: true, error: '' }));
    try {
      const rows = await trackingApi.jobs(scope, pages.current + 1, LIST_PAGE);
      if (ticket !== latest.current) return;
      pages.current += 1;
      setState((s) => ({ ...s, jobs: [...(s.jobs ?? []), ...unseen(s.jobs ?? [], rows)], hasMore: rows.length === LIST_PAGE, loadingMore: false }));
    } catch (e) {
      if (ticket === latest.current) setState((s) => ({ ...s, error: e instanceof ApiFailure ? e.message : 'The list could not be loaded.', loadingMore: false }));
    } finally {
      moreInFlight.current = false;
    }
  }, [scope, state.jobs, state.hasMore, state.loadingMore]);

  useEffect(() => {
    if (!enabled) return;
    pages.current = 1;
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

  return { ...state, refresh, loadMore };
}

/** How many of my distributions are still running, for the badge on the Status tab. */
export function runningCount(jobs: JobSummary[] | null): number {
  return (jobs ?? []).filter((j) => j.status === 'pending' || j.status === 'in_progress').length;
}
