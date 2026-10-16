import { useCallback, useEffect, useState } from 'react';
import { ApiFailure } from '../auth/session.js';
import { trackingApi, type JobSummary } from './api.js';

export const LIST_REFRESH_MS = 30_000;

/**
 * A list of jobs that loads when it is switched on and then every 30 seconds (TDD Step 3.4: live pushes are for
 * the open job only; the list refreshes its counts). A hidden tab waits.
 */
export function usePolledJobs(scope: 'mine' | 'team', enabled = true, intervalMs = LIST_REFRESH_MS) {
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
    const id = setInterval(() => {
      if (document.visibilityState !== 'hidden') void refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [enabled, refresh, intervalMs]);

  return { ...state, refresh };
}

/** How many of my distributions are still running, for the badge on the Status tab. */
export function runningCount(jobs: JobSummary[] | null): number {
  return (jobs ?? []).filter((j) => j.status === 'pending' || j.status === 'in_progress').length;
}
