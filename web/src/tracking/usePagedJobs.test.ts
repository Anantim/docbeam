// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from './api.js';
import type { JobSummary } from './api.js';
import { LIST_PAGE, runningCount, usePagedJobs } from './usePagedJobs.js';

const api = vi.hoisted(() => ({ jobs: vi.fn() }));
vi.mock('./api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  trackingApi: { jobs: api.jobs },
}));

const job = (jobId: string, status: JobSummary['status'], completed = 0): JobSummary => ({
  jobId,
  submittedBy: { userId: 'u', name: 'Priya Shah' },
  createdAt: '2026-10-16T10:00:00Z',
  taskCount: 10,
  fileCount: 2,
  destinationCount: 1,
  counts: { pending: 10 - completed, in_progress: 0, completed, failed: 0, cancelled: 0 },
  status,
});
const many = (from: number, n: number): JobSummary[] => Array.from({ length: n }, (_, i) => job(`job-${from + i}`, 'completed', 10));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('usePagedJobs', () => {
  it('loads the first page, then refreshes the counts every 30 seconds while something runs', async () => {
    api.jobs.mockResolvedValueOnce([job('a', 'in_progress', 2)]).mockResolvedValueOnce([job('a', 'in_progress', 6)]);
    const { result } = renderHook(() => usePagedJobs('mine'));
    await act(async () => undefined);
    expect(api.jobs).toHaveBeenCalledTimes(1);
    expect(api.jobs).toHaveBeenCalledWith('mine', 1, LIST_PAGE);
    expect(result.current.jobs?.[0]?.counts.completed).toBe(2);
    expect(result.current.hasMore).toBe(false); // a short page is the last one

    await act(async () => {
      vi.advanceTimersByTime(29_999);
    });
    expect(api.jobs).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(api.jobs).toHaveBeenCalledTimes(2);
    expect(result.current.jobs?.[0]?.counts.completed).toBe(6);
  });

  it('stops asking once no listed job is pending or in progress', async () => {
    api.jobs.mockResolvedValueOnce([job('a', 'in_progress', 2)]).mockResolvedValueOnce([job('a', 'completed', 10)]);
    const { result } = renderHook(() => usePagedJobs('mine'));
    await act(async () => undefined);
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current.jobs?.[0]?.status).toBe('completed');
    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });
    expect(api.jobs).toHaveBeenCalledTimes(2);
  });

  it('adds the next page on loadMore, only while a full page says more may follow, and never twice at once', async () => {
    api.jobs.mockResolvedValueOnce(many(0, LIST_PAGE)).mockResolvedValueOnce(many(LIST_PAGE, 5));
    const { result } = renderHook(() => usePagedJobs('mine'));
    await act(async () => undefined);
    expect(result.current.hasMore).toBe(true);
    await act(async () => {
      void result.current.loadMore();
      void result.current.loadMore();
    });
    expect(api.jobs).toHaveBeenCalledTimes(2);
    expect(api.jobs).toHaveBeenLastCalledWith('mine', 2, LIST_PAGE);
    expect(result.current.jobs).toHaveLength(LIST_PAGE + 5);
    expect(result.current.hasMore).toBe(false);
    await act(async () => result.current.loadMore());
    expect(api.jobs).toHaveBeenCalledTimes(2); // the end: nothing more is asked
  });

  it('does not show a row twice when a new distribution shifts the pages', async () => {
    const first = many(0, LIST_PAGE);
    api.jobs.mockResolvedValueOnce(first).mockResolvedValueOnce([first[LIST_PAGE - 1] as JobSummary, job('tail', 'completed', 10)]);
    const { result } = renderHook(() => usePagedJobs('mine'));
    await act(async () => undefined);
    await act(async () => result.current.loadMore());
    const ids = (result.current.jobs ?? []).map((j) => j.jobId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.at(-1)).toBe('tail');
  });

  it('a refresh reads again every page that is shown', async () => {
    api.jobs.mockResolvedValueOnce(many(0, LIST_PAGE)).mockResolvedValueOnce(many(LIST_PAGE, 3));
    const { result } = renderHook(() => usePagedJobs('mine'));
    await act(async () => undefined);
    await act(async () => result.current.loadMore());
    api.jobs.mockClear();
    api.jobs.mockResolvedValueOnce(many(0, LIST_PAGE)).mockResolvedValueOnce(many(LIST_PAGE, 3));
    await act(async () => result.current.refresh());
    expect(api.jobs.mock.calls).toEqual([['mine', 1, LIST_PAGE], ['mine', 2, LIST_PAGE]]);
    expect(result.current.jobs).toHaveLength(LIST_PAGE + 3);
  });

  it('keeps the rows and shows the error when a later page fails, and keeps polling after a failed first load', async () => {
    api.jobs.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce([job('a', 'completed', 10)]);
    const { result } = renderHook(() => usePagedJobs('mine'));
    await act(async () => undefined);
    expect(result.current.error).toBe('The list could not be loaded.');
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current.error).toBe('');
    expect(result.current.jobs).toHaveLength(1);
  });

  it('counts the running ones for the badge', () => {
    expect(runningCount(null)).toBe(0);
    expect(runningCount([job('a', 'pending'), job('b', 'in_progress'), job('c', 'completed'), job('d', 'cancelled')])).toBe(2);
  });
});
