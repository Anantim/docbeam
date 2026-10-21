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
  fileNames: ['a.pdf', 'b.pdf'],
  destinations: ['Cardio / Regulatory / IRB approvals'],
  counts: { pending: 10 - completed, in_progress: 0, completed, failed: 0, cancelled: 0 },
  status,
});
const many = (from: number, n: number): JobSummary[] => Array.from({ length: n }, (_, i) => job(`job-${from + i}`, 'completed', 10));
const page = (items: JobSummary[], nextCursor: string | null = null) => ({ items, nextCursor });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('usePagedJobs (cursor, D-F1-21)', () => {
  it('loads the first page, then refreshes the counts every 30 seconds while something runs', async () => {
    api.jobs.mockResolvedValueOnce(page([job('a', 'in_progress', 2)])).mockResolvedValueOnce(page([job('a', 'in_progress', 6)]));
    const { result } = renderHook(() => usePagedJobs());
    await act(async () => undefined);
    expect(api.jobs).toHaveBeenCalledTimes(1);
    expect(api.jobs).toHaveBeenCalledWith({}, null, LIST_PAGE);
    expect(result.current.jobs?.[0]?.counts.completed).toBe(2);
    expect(result.current.hasMore).toBe(false); // no cursor: this was the last page

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
    api.jobs.mockResolvedValueOnce(page([job('a', 'in_progress', 2)])).mockResolvedValueOnce(page([job('a', 'completed', 10)]));
    const { result } = renderHook(() => usePagedJobs());
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

  it('loadUntil reads pages until the job is in the list and stops there (D-F1-74)', async () => {
    api.jobs
      .mockResolvedValueOnce(page(many(0, 20), 'c1'))
      .mockResolvedValueOnce(page(many(20, 20), 'c2'))
      .mockResolvedValueOnce(page(many(40, 20), 'c3'));
    const { result } = renderHook(() => usePagedJobs());
    await act(async () => undefined);
    let found = false;
    await act(async () => {
      found = await result.current.loadUntil('job-45', 5);
    });
    expect(found).toBe(true);
    expect(api.jobs).toHaveBeenCalledTimes(3); // the first page and two more: not the fourth
    expect(result.current.jobs).toHaveLength(60);
    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      found = await result.current.loadUntil('job-3', 5);
    });
    expect(found).toBe(true); // already there: no page is read
    expect(api.jobs).toHaveBeenCalledTimes(3);
  });

  it('loadUntil gives up after the page limit, and at the end of the list', async () => {
    api.jobs
      .mockResolvedValueOnce(page(many(0, 20), 'c1'))
      .mockResolvedValueOnce(page(many(20, 20), 'c2'))
      .mockResolvedValueOnce(page(many(40, 20), 'c3'))
      .mockResolvedValueOnce(page(many(60, 20)));
    const { result } = renderHook(() => usePagedJobs());
    await act(async () => undefined);
    let found = true;
    await act(async () => {
      found = await result.current.loadUntil('job-999', 2);
    });
    expect(found).toBe(false);
    expect(api.jobs).toHaveBeenCalledTimes(3); // the first page and the 2 it was allowed
    await act(async () => {
      found = await result.current.loadUntil('job-999', 5);
    });
    expect(found).toBe(false); // the end of the list: the 4th page has no cursor
    expect(api.jobs).toHaveBeenCalledTimes(4);
    expect(result.current.hasMore).toBe(false);
  });

  it('adds the next page on loadMore by the cursor the server gave, only while there is one, and never twice at once', async () => {
    api.jobs.mockResolvedValueOnce(page(many(0, LIST_PAGE), 'c1')).mockResolvedValueOnce(page(many(LIST_PAGE, 5)));
    const { result } = renderHook(() => usePagedJobs());
    await act(async () => undefined);
    expect(result.current.hasMore).toBe(true);
    await act(async () => {
      void result.current.loadMore();
      void result.current.loadMore();
    });
    expect(api.jobs).toHaveBeenCalledTimes(2);
    expect(api.jobs).toHaveBeenLastCalledWith({}, 'c1', LIST_PAGE);
    expect(result.current.jobs).toHaveLength(LIST_PAGE + 5);
    expect(result.current.hasMore).toBe(false);
    await act(async () => result.current.loadMore());
    expect(api.jobs).toHaveBeenCalledTimes(2); // the end: nothing more is asked
  });

  it('does not show a row twice if a refresh overlaps a page', async () => {
    const first = many(0, LIST_PAGE);
    api.jobs.mockResolvedValueOnce(page(first, 'c1')).mockResolvedValueOnce(page([first[LIST_PAGE - 1] as JobSummary, job('tail', 'completed', 10)]));
    const { result } = renderHook(() => usePagedJobs());
    await act(async () => undefined);
    await act(async () => result.current.loadMore());
    const ids = (result.current.jobs ?? []).map((j) => j.jobId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.at(-1)).toBe('tail');
  });

  it('merges by id: a refresh in which a new row pushed one onto the next page shows every id once and none missing (D-F1-40)', async () => {
    const rows = many(0, LIST_PAGE + 5);
    api.jobs.mockResolvedValueOnce(page(rows.slice(0, LIST_PAGE), 'c1')).mockResolvedValueOnce(page(rows.slice(LIST_PAGE)));
    const { result } = renderHook(() => usePagedJobs());
    await act(async () => undefined);
    await act(async () => result.current.loadMore());
    // A new distribution lands on top: page 1 now ends one row later, so the last row of the old page 1 comes again at the top of page 2.
    const fresh = job('fresh', 'pending');
    const all = [fresh, ...rows];
    api.jobs.mockResolvedValueOnce(page(all.slice(0, LIST_PAGE), 'd1')).mockResolvedValueOnce(page(all.slice(LIST_PAGE - 1, LIST_PAGE + 5)));
    await act(async () => result.current.refresh());
    const ids = (result.current.jobs ?? []).map((j) => j.jobId);
    expect(new Set(ids).size).toBe(ids.length); // none twice
    expect(ids).toEqual(['fresh', ...rows.slice(0, LIST_PAGE - 1).map((j) => j.jobId), ...rows.slice(LIST_PAGE - 1, LIST_PAGE + 4).map((j) => j.jobId)].filter((id, i, a) => a.indexOf(id) === i));
  });

  it('a refresh reads again every page that is shown, following the cursors from the top', async () => {
    api.jobs.mockResolvedValueOnce(page(many(0, LIST_PAGE), 'c1')).mockResolvedValueOnce(page(many(LIST_PAGE, 3)));
    const { result } = renderHook(() => usePagedJobs());
    await act(async () => undefined);
    await act(async () => result.current.loadMore());
    api.jobs.mockClear();
    api.jobs.mockResolvedValueOnce(page(many(0, LIST_PAGE), 'c9')).mockResolvedValueOnce(page(many(LIST_PAGE, 3)));
    await act(async () => result.current.refresh());
    expect(api.jobs.mock.calls).toEqual([[{}, null, LIST_PAGE], [{}, 'c9', LIST_PAGE]]);
    expect(result.current.jobs).toHaveLength(LIST_PAGE + 3);
  });

  it('keeps the rows and shows the error when a later page fails, and keeps polling after a failed first load', async () => {
    api.jobs.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(page([job('a', 'completed', 10)]));
    const { result } = renderHook(() => usePagedJobs());
    await act(async () => undefined);
    expect(result.current.error).toBe('The list could not be loaded.');
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current.error).toBe('');
    expect(result.current.jobs).toHaveLength(1);
  });

  it('asks with the filters, starts again when a choice changes, and does not for an equal object', async () => {
    api.jobs.mockResolvedValue(page([job('a', 'completed', 10)]));
    const { rerender } = renderHook(({ f }) => usePagedJobs(f), { initialProps: { f: { sender: 'me' } as { sender?: string; status?: 'completed' } } });
    await act(async () => undefined);
    expect(api.jobs).toHaveBeenLastCalledWith({ sender: 'me' }, null, LIST_PAGE);
    rerender({ f: { sender: 'me' } }); // a new object with the same choices
    await act(async () => undefined);
    expect(api.jobs).toHaveBeenCalledTimes(1);
    rerender({ f: { sender: 'me', status: 'completed' } });
    await act(async () => undefined);
    expect(api.jobs).toHaveBeenCalledTimes(2);
    expect(api.jobs).toHaveBeenLastCalledWith({ sender: 'me', status: 'completed' }, null, LIST_PAGE);
  });

  it('counts only the pending and in-progress ones for the badge, and none when all are done', () => {
    expect(runningCount(null)).toBe(0);
    expect(runningCount([job('a', 'pending'), job('b', 'in_progress'), job('c', 'completed'), job('d', 'cancelled')])).toBe(2);
    expect(runningCount([job('a', 'completed'), job('b', 'completed_with_errors'), job('c', 'cancelled')])).toBe(0);
  });

  it('the badge follows the open distribution\'s live counts: it drops when that one finishes, before the list is read again', () => {
    const jobs = [job('a', 'in_progress', 2), job('b', 'pending')];
    expect(runningCount(jobs)).toBe(2);
    // The list still says "in progress", but the live counts say every delivery of "a" is done.
    expect(runningCount(jobs, { jobId: 'a', counts: { pending: 0, in_progress: 0, completed: 10, failed: 0, cancelled: 0 } })).toBe(1);
    // Live counts of a distribution that is not in the list change nothing; a still-running one stays counted.
    expect(runningCount(jobs, { jobId: 'zzz', counts: { pending: 0, in_progress: 0, completed: 10, failed: 0, cancelled: 0 } })).toBe(2);
    expect(runningCount(jobs, { jobId: 'a', counts: { pending: 3, in_progress: 1, completed: 6, failed: 0, cancelled: 0 } })).toBe(2);
  });
});
