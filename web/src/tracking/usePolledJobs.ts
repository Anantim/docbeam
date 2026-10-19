import { useCallback, useEffect, useState } from 'react';
import { ApiFailure } from '../auth/session.js';
import { trackingApi, type JobSummary } from './api.js';

export const LIST_REFRESH_MS = 30_000;

/**
 * A list of jobs that loads when it is switched on. It then reloads every 30 seconds, but only while at least
 * one listed job is pending or in progress (TDD Step 3.4: live pushes are for the open job only). When nothing is
 * running it stops asking. It loads once more when the person comes back to the tab, signs in again, or calls
 * `refresh` (the app does that after a send). A hidden tab waits.
 */
export function usePolledJobs(scope: 'mine' | 'team', enabled = true, intervalMs = LIST_REFRESH_MS, signedInAgain = 0) {
  const [state, setState] = useState<{ jobs: JobSummary[] | null; error: string }>({ jobs: null, error: '' });

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setState({ jobs: await trackingApi.jobs(scope), error: '' });
    } catch (e) {
      setState((s) => ({ ...s, error: e instanceof ApiFailure ? e.message : 'The list could not be loaded.' }));
    }
  }, [scope]);

  useEffect(() => {
    if (!enabled) return;
    setState({ jobs: null, error: '' });
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

  const running = runningCount(state.jobs) > 0;
  useEffect(() => {
    if (!enabled || !running) return;
    const id = setInterval(() => {
      if (document.visibilityState !== 'hidden') void refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [enabled, running, refresh, intervalMs]);

  return { ...state, refresh };
}

/** How many of my distributions are still running, for the badge on the Status tab. */
export function runningCount(jobs: JobSummary[] | null): number {
  return (jobs ?? []).filter((j) => j.status === 'pending' || j.status === 'in_progress').length;
}
