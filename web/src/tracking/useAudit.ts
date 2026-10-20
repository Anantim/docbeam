import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiFailure } from '../auth/session.js';
import { trackingApi, type AuditEvent } from './api.js';

interface Query {
  jobId?: string;
  /** Empty for every action. */
  actions: readonly string[];
  /** Changes when the list must load again from the start. */
  reloadKey?: number;
  /** False keeps it from loading, for a section that is closed. */
  enabled?: boolean;
}

/** The audit trail, newest first, a page at a time. Changing the query or the reload key starts again. */
export function useAudit({ jobId, actions, reloadKey = 0, enabled = true }: Query) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');
  const page = useRef(1);
  const generation = useRef(0);
  const actionKey = actions.join(',');

  const fetchPage = useCallback(
    async (next: number, replace: boolean): Promise<void> => {
      const gen = generation.current;
      setLoading(true);
      try {
        const out = await trackingApi.audit({ ...(jobId ? { jobId } : {}), actions: actionKey ? actionKey.split(',') : [], page: next });
        if (gen !== generation.current) return;
        page.current = next;
        setEvents((prev) => (replace ? out.events : [...prev, ...out.events]));
        setHasMore(out.hasMore);
        setError('');
      } catch (e) {
        if (gen === generation.current) setError(e instanceof ApiFailure ? e.message : 'The history could not be loaded.');
      } finally {
        if (gen === generation.current) setLoading(false);
      }
    },
    [jobId, actionKey],
  );

  useEffect(() => {
    generation.current += 1;
    if (enabled) void fetchPage(1, true);
  }, [fetchPage, reloadKey, enabled]);

  const loadMore = useCallback(() => fetchPage(page.current + 1, false), [fetchPage]);
  return { events, hasMore, loading, error, loadMore };
}
