import type { Counts } from '../tracking/api.js';

const pct = (n: number, total: number): number => (total > 0 ? (n / total) * 100 : 0);

/** The progress of a distribution as one bar: completed, failed, in progress and cancelled, in the status colours. */
export function JobBar({ counts, total, thin = false }: { counts: Counts; total: number; thin?: boolean }) {
  return (
    <div className={`jbar ${thin ? 'thin' : ''}`} aria-hidden="true">
      <div data-tone="ok" style={{ width: `${pct(counts.completed, total)}%` }} />
      <div data-tone="bad" style={{ width: `${pct(counts.failed, total)}%` }} />
      <div data-tone="busy" style={{ width: `${pct(counts.in_progress, total)}%` }} />
      <div data-tone="idle" style={{ width: `${pct(counts.cancelled, total)}%` }} />
    </div>
  );
}
