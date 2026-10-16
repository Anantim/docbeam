// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from './api.js';
import type { JobSummary } from './api.js';
import { runningCount, usePolledJobs } from './usePolledJobs.js';

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
  counts: { pending: 10 - completed, in_progress: 0, completed, failed: 0 },
  status,
});

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('usePolledJobs', () => {
  it('loads once, then refreshes the counts every 30 seconds', async () => {
    api.jobs.mockResolvedValueOnce([job('a', 'in_progress', 2)]).mockResolvedValueOnce([job('a', 'in_progress', 6)]);
    const { result } = renderHook(() => usePolledJobs('mine'));
    await act(async () => undefined);
    expect(api.jobs).toHaveBeenCalledTimes(1);
    expect(api.jobs).toHaveBeenCalledWith('mine');
    expect(result.current.jobs?.[0]?.counts.completed).toBe(2);

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

  it('waits while the tab is hidden', async () => {
    api.jobs.mockResolvedValue([]);
    renderHook(() => usePolledJobs('mine'));
    await act(async () => undefined);
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => {
      vi.advanceTimersByTime(90_000);
    });
    expect(api.jobs).toHaveBeenCalledTimes(1);
    spy.mockReturnValue('visible');
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(api.jobs).toHaveBeenCalledTimes(2);
  });

  it('does not load while switched off, and starts when switched on', async () => {
    api.jobs.mockResolvedValue([]);
    const { rerender } = renderHook(({ on }) => usePolledJobs('team', on), { initialProps: { on: false } });
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(api.jobs).not.toHaveBeenCalled();
    rerender({ on: true });
    await act(async () => undefined);
    expect(api.jobs).toHaveBeenCalledWith('team');
  });

  it('keeps the last list and reports an error when a refresh fails', async () => {
    api.jobs.mockResolvedValueOnce([job('a', 'completed', 10)]).mockImplementationOnce(() => Promise.reject(new Error('down')));
    const { result } = renderHook(() => usePolledJobs('mine'));
    await act(async () => undefined);
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current.jobs).toHaveLength(1);
    expect(result.current.error).toBe('The list could not be loaded.');
  });
});

describe('runningCount', () => {
  it('counts pending and in-progress distributions only', () => {
    expect(runningCount([job('a', 'pending'), job('b', 'in_progress'), job('c', 'completed'), job('d', 'cancelled')])).toBe(2);
    expect(runningCount(null)).toBe(0);
  });
});
