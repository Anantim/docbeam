import type { Counts } from '../tracking/api.js';
import { plural } from '../text.js';
import { Tooltip } from './Tooltip.js';

const pct = (n: number, total: number): number => (total > 0 ? (n / total) * 100 : 0);

/**
 * The bar's words (D-F1-72): "4 deliveries: 1 failed, 1 in progress, 1 cancelled, 1 completed", only the kinds that are not zero,
 * in that order, and pending last (a delivery that has not started is part of the total and would otherwise be unaccounted for).
 */
export function barText(counts: Counts, total: number): string {
  const parts: Array<[number, string]> = [
    [counts.failed, 'failed'],
    [counts.in_progress, 'in progress'],
    [counts.cancelled, 'cancelled'],
    [counts.completed, 'completed'],
    [counts.pending, 'pending'],
  ];
  const said = parts.filter(([n]) => n > 0).map(([n, word]) => `${n} ${word}`);
  return said.length > 0 ? `${plural(total, 'delivery', 'deliveries')}: ${said.join(', ')}` : plural(total, 'delivery', 'deliveries');
}

/**
 * The progress of a distribution as one bar: completed, failed, in progress and cancelled, in the status colours. Its tooltip and
 * its accessible name are the same counts in words. Where it can take the focus (the panel) the keyboard shows the tooltip too;
 * in the list it is hover only, so the list keeps its one Tab stop.
 */
export function JobBar({ counts, total, thin = false, focusable = false }: { counts: Counts; total: number; thin?: boolean; focusable?: boolean }) {
  const text = barText(counts, total);
  return (
    <Tooltip text={text} block>
      <div className={`jbar ${thin ? 'thin' : ''}`} role="img" aria-label={text} tabIndex={focusable ? 0 : undefined}>
        <div data-tone="ok" style={{ width: `${pct(counts.completed, total)}%` }} />
        <div data-tone="bad" style={{ width: `${pct(counts.failed, total)}%` }} />
        <div data-tone="busy" style={{ width: `${pct(counts.in_progress, total)}%` }} />
        <div data-tone="idle" style={{ width: `${pct(counts.cancelled, total)}%` }} />
      </div>
    </Tooltip>
  );
}
