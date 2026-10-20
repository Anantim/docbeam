// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from './api.js';
import { RUNNING_REFRESH_MS, useRunningCount } from './useRunningCount.js';

const api = vi.hoisted(() => ({ running: vi.fn() }));
vi.mock('./api.js', async (importOriginal) => ({ ...(await importOriginal<typeof ApiModule>()), trackingApi: { running: api.running } }));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useRunningCount: the number on the Status tab (D-F1-34)', () => {
  it('is the server\'s count over the whole list, which the rows loaded on the first page may not show', async () => {
    api.running.mockResolvedValue(7);
    const { result } = renderHook(() => useRunningCount(true, null, null, 0));
    await act(async () => undefined);
    expect(result.current).toBe(7);
  });

  it('reads again when the list is read, when the open distribution finishes, and after a sign-in again', async () => {
    api.running.mockResolvedValueOnce(2).mockResolvedValueOnce(1).mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const { result, rerender } = renderHook(({ list, done, again }) => useRunningCount(true, list, done, again), { initialProps: { list: [] as unknown[], done: null as string | null, again: 0 } });
    await act(async () => undefined);
    expect(result.current).toBe(2);
    rerender({ list: [], done: null, again: 0 }); // a new array: the list was read
    await act(async () => undefined);
    expect(result.current).toBe(1);
    rerender({ list: [], done: 'job-1', again: 0 }); // the open distribution finished
    await act(async () => undefined);
    rerender({ list: [], done: 'job-1', again: 1 });
    await act(async () => undefined);
    expect(api.running).toHaveBeenCalledTimes(4);
    expect(result.current).toBe(0);
  });

  it('polls every 30 seconds only while something runs', async () => {
    api.running.mockResolvedValueOnce(1).mockResolvedValue(0);
    renderHook(() => useRunningCount(true, null, null, 0));
    await act(async () => undefined);
    expect(api.running).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(RUNNING_REFRESH_MS);
    });
    expect(api.running).toHaveBeenCalledTimes(2); // it was running: asked again, and now nothing is
    await act(async () => {
      vi.advanceTimersByTime(5 * RUNNING_REFRESH_MS);
    });
    expect(api.running).toHaveBeenCalledTimes(2); // nothing runs: no more asking
  });

  it('keeps the last number when a read fails, and is 0 while signed out', async () => {
    api.running.mockResolvedValueOnce(3).mockRejectedValueOnce(new Error('x'));
    const { result, rerender } = renderHook(({ on, list }) => useRunningCount(on, list, null, 0), { initialProps: { on: true, list: [] as unknown[] } });
    await act(async () => undefined);
    rerender({ on: true, list: [] });
    await act(async () => undefined);
    expect(result.current).toBe(3);
    rerender({ on: false, list: [] });
    expect(result.current).toBe(0);
  });
});
