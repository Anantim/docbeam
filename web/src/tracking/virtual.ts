// A fixed-height window over up to 2,000 rows (TDD Step 3.4): only the rows in view, plus a few around them,
// are drawn. No library.

export interface Range {
  start: number;
  /** Exclusive. */
  end: number;
}

export function visibleRange(input: {
  scrollTop: number;
  viewport: number;
  rowHeight: number;
  total: number;
  overscan?: number;
}): Range {
  const overscan = input.overscan ?? 6;
  if (input.total <= 0 || input.rowHeight <= 0) return { start: 0, end: 0 };
  const first = Math.floor(Math.max(0, input.scrollTop) / input.rowHeight);
  const last = Math.ceil((Math.max(0, input.scrollTop) + Math.max(0, input.viewport)) / input.rowHeight);
  return { start: Math.max(0, first - overscan), end: Math.min(input.total, last + overscan) };
}

/** The 1-based pages that hold the rows start..end-1. */
export function pagesFor(range: Range, pageSize: number): number[] {
  if (range.end <= range.start) return [];
  const first = Math.floor(range.start / pageSize) + 1;
  const last = Math.floor((range.end - 1) / pageSize) + 1;
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}
