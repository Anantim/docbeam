import { useCallback, useEffect, useRef, useState } from 'react';
import { trackingApi } from './api.js';

export const RUNNING_REFRESH_MS = 30_000;

/**
 * The number on the Status tab: how many distributions the person can see are pending or in progress, counted by the
 * server over the whole list, so it equals the rows under the Pending and In progress filters together (D-F1-34). Before
 * this the badge counted the rows the list had loaded, and missed a running distribution beyond the first 20.
 *
 * It reads again whenever `listRead` changes (the app's list is a new array each time it is read: after a send, a cancel, a
 * retry, a poll, a return to Status), when the open distribution finishes (`finished`), after a sign-in again, when the tab comes back, and every 30 seconds while something is running. A failed read keeps the last number.
 */
export function useRunningCount(enabled: boolean, listRead: unknown, finished: unknown, signedInAgain: unknown): number {
  const [running, setRunning] = useState(0);
  const latest = useRef(0);

  const read = useCallback(async (): Promise<void> => {
    const ticket = ++latest.current;
    try {
      const n = await trackingApi.running();
      if (ticket === latest.current) setRunning(n);
    } catch {
      // keep the last number
    }
  }, []);

  useEffect(() => {
    if (enabled) void read();
    else setRunning(0);
  }, [enabled, read, listRead, finished, signedInAgain]);

  useEffect(() => {
    if (!enabled) return;
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void read();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [enabled, read]);

  useEffect(() => {
    if (!enabled || running === 0) return;
    const id = setInterval(() => {
      if (document.visibilityState !== 'hidden') void read();
    }, RUNNING_REFRESH_MS);
    return () => clearInterval(id);
  }, [enabled, running, read]);

  return running;
}
