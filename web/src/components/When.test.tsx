// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tooltipOf } from '../testing/tooltip.js';
import { formatFull } from '../tracking/format.js';
import { When } from './When.js';

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: false }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('a time on the page (D-F1-59)', () => {
  it('is a <time> element with the ISO value, the short text, and the full time in the shared tooltip', () => {
    vi.setSystemTime(new Date(2026, 9, 21, 12, 0));
    const iso = new Date(2026, 9, 21, 4, 34, 12).toISOString();
    render(<When iso={iso} />);
    const time = screen.getByText('Today, 04:34');
    expect(time.tagName).toBe('TIME');
    expect(time.getAttribute('datetime')).toBe(iso);
    expect(time.tabIndex).toBe(0); // the keyboard can reach it, which shows the tooltip
    expect(tooltipOf(time)).toBe(formatFull(iso));
    expect(tooltipOf(time)).toMatch(/^21 Oct 2026, 04:34:12/);
  });

  it('is not a tab stop when it sits inside a button', () => {
    vi.setSystemTime(new Date(2026, 9, 21, 12, 0));
    render(<When iso={new Date(2026, 9, 21, 4, 34).toISOString()} focusable={false} />);
    expect(screen.getByText('Today, 04:34').hasAttribute('tabindex')).toBe(false);
  });

  it('changes from "Today" to "Yesterday" when midnight passes, with no reload', async () => {
    vi.setSystemTime(new Date(2026, 9, 21, 23, 58));
    render(<When iso={new Date(2026, 9, 21, 18, 10).toISOString()} />);
    expect(screen.getByText('Today, 18:10')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 60_000); // 00:01 the next day
    });
    expect(screen.getByText('Yesterday, 18:10')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(24 * 3600_000); // and a day later it is a date
    });
    expect(screen.getByText('21 Oct, 18:10')).toBeTruthy();
  });

  it('stops its clock when the last time leaves the page', () => {
    vi.setSystemTime(new Date(2026, 9, 21, 12, 0));
    const { unmount } = render(<When iso={new Date(2026, 9, 21, 4, 34).toISOString()} />);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
