// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JobSummary } from '../tracking/api.js';

// Render counting (F1 follow-up, vercel-react-best-practices): each row draws one StatusChip.
const renders = vi.hoisted(() => ({ chips: 0 }));
vi.mock('./StatusChip.js', () => ({
  StatusChip: () => {
    renders.chips += 1;
    return <span />;
  },
}));
const { DistributionList } = await import('./DistributionList.js');

afterEach(cleanup);

const job = (n: number, completed = 0): JobSummary => ({
  jobId: `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`,
  submittedBy: { userId: 'u', name: 'Priya Shah' },
  createdAt: '2026-10-16T10:00:00Z',
  taskCount: 10,
  fileCount: 2,
  destinationCount: 1,
  counts: { pending: 10 - completed, in_progress: 0, completed, failed: 0, cancelled: 0 },
  status: completed === 10 ? 'completed' : 'in_progress',
});
const many = (completed: number): JobSummary[] => Array.from({ length: 40 }, (_, i) => job(i, i === 3 ? completed : 10));

const props = { meId: 'u', onClearFilters: vi.fn(), error: '', hasMore: false, loadingMore: false, moreFailed: false, onMore: vi.fn(), onRetry: vi.fn(), selectedId: null, onOpen: vi.fn(), notify: vi.fn() };

describe('the list of distributions redraws only the rows that changed', () => {
  it('a refresh with new objects and the same content draws no row; one changed row draws one', () => {
    const { rerender } = render(<DistributionList {...props} jobs={many(2)} />);
    expect(renders.chips).toBe(40);
    renders.chips = 0;
    rerender(<DistributionList {...props} jobs={many(2)} />); // the 30-second refresh, nothing changed
    expect(renders.chips).toBe(0); // before the fix: 40
    rerender(<DistributionList {...props} jobs={many(6)} />); // one distribution moved on
    expect(renders.chips).toBe(1); // before the fix: 40
  });
});
