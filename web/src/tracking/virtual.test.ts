import { describe, expect, it } from 'vitest';
import { pagesFor, visibleRange } from './virtual.js';

describe('visibleRange', () => {
  it('draws only the rows in view and a few around them', () => {
    expect(visibleRange({ scrollTop: 0, viewport: 400, rowHeight: 40, total: 2_000, overscan: 2 })).toEqual({ start: 0, end: 12 });
    expect(visibleRange({ scrollTop: 4_000, viewport: 400, rowHeight: 40, total: 2_000, overscan: 2 })).toEqual({ start: 98, end: 112 });
  });

  it('never goes past the ends', () => {
    expect(visibleRange({ scrollTop: 79_900, viewport: 400, rowHeight: 40, total: 2_000, overscan: 5 }).end).toBe(2_000);
    expect(visibleRange({ scrollTop: -50, viewport: 400, rowHeight: 40, total: 3, overscan: 5 })).toEqual({ start: 0, end: 3 });
  });

  it('is empty with no rows', () => {
    expect(visibleRange({ scrollTop: 0, viewport: 400, rowHeight: 40, total: 0 })).toEqual({ start: 0, end: 0 });
  });

  it('draws a small fraction of 2,000 rows', () => {
    const r = visibleRange({ scrollTop: 20_000, viewport: 560, rowHeight: 44, total: 2_000 });
    expect(r.end - r.start).toBeLessThan(40);
  });
});

describe('pagesFor', () => {
  it('names the 1-based pages of 100 that hold the rows', () => {
    expect(pagesFor({ start: 0, end: 12 }, 100)).toEqual([1]);
    expect(pagesFor({ start: 95, end: 105 }, 100)).toEqual([1, 2]);
    expect(pagesFor({ start: 1_990, end: 2_000 }, 100)).toEqual([20]);
    expect(pagesFor({ start: 0, end: 0 }, 100)).toEqual([]);
  });
});
