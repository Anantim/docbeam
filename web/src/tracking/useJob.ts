import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiFailure } from '../auth/session.js';
import type { LiveClient } from '../live/socket.js';
import { trackingApi, type JobDetail, type TaskPage } from './api.js';
import { applyCounts, countsFromFetch, type CountsState } from './apply.js';

export type JobState = { status: 'loading' } | { status: 'ready'; detail: JobDetail } | { status: 'notFound' } | { status: 'error'; message: string };

/** After a push, the detail (the Retry and Cancel rules, the chip) is read again within this time. */
const DETAIL_REFRESH_MS = 1_500;

/**
 * Opens one distribution the way the design says (TDD Step 3.3): subscribe over the live connection first, and
 * only then fetch. After every reconnect it subscribes again and loads everything once more, so nothing is missed.
 *  - `counts` follow the live pushes and ignore a push older than what is shown.
 *  - `reloadKey` changes when the task table must load again (reconnect, a cancel, a retry, a job update).
 */
export function useJob(jobId: string, live: LiveClient) {
  const [state, setState] = useState<JobState>({ status: 'loading' });
  const [counts, setCounts] = useState<CountsState | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const current = useRef(jobId);
  current.current = jobId;

  /** The first page of deliveries, asked for as the distribution opens and handed to the table, so the two reads run together (D-F1-81). */
  const firstTasks = useRef<Promise<TaskPage> | null>(null);

  const loadDetail = useCallback(async (): Promise<JobDetail | null> => {
    const id = jobId;
    try {
      const detail = await trackingApi.job(id);
      if (current.current !== id) return null;
      setState({ status: 'ready', detail });
      setCounts((prev) => {
        const fresh = countsFromFetch(detail.counts, detail.asOf);
        // A push that arrived while this answer was on its way may be newer than the fetch. Keep the newer one.
        return prev && prev.at > fresh.at ? prev : fresh;
      });
      return detail;
    } catch (e) {
      if (current.current !== id) return null;
      if (e instanceof ApiFailure && e.status === 404) setState({ status: 'notFound' });
      else setState({ status: 'error', message: e instanceof ApiFailure ? e.message : "The distribution couldn't be loaded." });
      return null;
    }
  }, [jobId]);

  const reloadAll = useCallback((): void => {
    void loadDetail();
    setReloadKey((k) => k + 1);
  }, [loadDetail]);

  // Open (D-F1-81): the subscribe, the detail and the first page of deliveries go out together, so the deliveries show after one
  // round trip and not after three. Nothing is missed: a push only comes after the server has recorded the subscribe, and a read that
  // went out before that could be older than a later push. So when the answer to the subscribe is in and the distribution had work
  // still to do (pending or in progress) the detail and the deliveries are read once more, after it. A finished distribution has
  // nothing left to change, so its first read is final; a job_update that arrives reloads it as before. If the live connection is
  // down the page fetches anyway and catches up when it comes back.
  useEffect(() => {
    let stale = false;
    setState({ status: 'loading' });
    setCounts(null);
    setReloadKey(0);
    firstTasks.current = trackingApi.tasks(jobId, 1);
    firstTasks.current.catch(() => undefined); // the table says what went wrong; with no table (not found) nobody waits for it
    void (async () => {
      const [, detail] = await Promise.all([live.watch(jobId), loadDetail()]);
      if (!stale && detail && detail.counts.pending + detail.counts.in_progress > 0) reloadAll();
    })();
    return () => {
      stale = true;
      live.unwatch();
    };
  }, [jobId, live, loadDetail, reloadAll]);

  // Live pushes: counts at once, the detail a moment later, a job update reloads the tasks too.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = live.onMessage((message) => {
      if (message.jobId !== jobId) return;
      setCounts((prev) => (prev ? applyCounts(prev, message) : prev));
      if (message.type === 'job_update') reloadAll();
      else {
        // At most one read per pause: a run that never goes quiet still refreshes the detail every 1.5 seconds.
        timer ??= setTimeout(() => {
          timer = undefined;
          void loadDetail();
        }, DETAIL_REFRESH_MS);
      }
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [live, jobId, loadDetail, reloadAll]);

  // A reconnect has subscribed again: fetch once.
  useEffect(() => live.onResync((id) => id === jobId && reloadAll()), [live, jobId, reloadAll]);

  return { state, counts: counts?.counts ?? null, reloadKey, reloadAll, firstTasks };
}
