import { Tooltip } from './Tooltip.js';

export type Tone = 'idle' | 'busy' | 'ok' | 'warn' | 'bad';

/**
 * The one colour meaning for every status in the app (D-M3-12, D-F1-5): grey is waiting or nothing yet, blue is
 * working, green is done, amber is being checked, red is a problem. The colours are tokens in `styles.css`, set
 * by the `data-tone` attribute here and on every dot and bar. The same tone is used for a delivery, a
 * distribution and a file being uploaded, so "Ready" on Distribute and "Completed" on Status read the same.
 * A live change of status is a 200 ms colour cross-fade (D-F1-47).
 */
interface Props {
  tone: Tone;
  label: string;
  /** The one-line meaning, from `web/src/explain.ts`, shown as the chip's tooltip. */
  meaning?: string | undefined;
  /** The larger chip in the header of a distribution. */
  big?: boolean;
  /** What a screen reader says for the chip when the tooltip's sentence is more useful than the word (D-F1-38). */
  ariaLabel?: string | undefined;
  /** A chip whose tooltip carries a reason is a Tab stop, and a click shows the tooltip too (D-F1-60). */
  focusable?: boolean;
}

/** The text with a dot, tinted by its tone. Delivery states, distribution states and file states all use it. */
export function StatusChip({ tone, label, meaning, big = false, ariaLabel, focusable = false }: Props) {
  return (
    <Tooltip text={meaning} openOnClick={focusable}>
      <span className={`status-chip ${big ? 'big' : ''}`} data-tone={tone} role={ariaLabel ? 'img' : undefined} aria-label={ariaLabel} tabIndex={focusable ? 0 : undefined}>
        <span className="status-dot" aria-hidden="true" />
        {label}
      </span>
    </Tooltip>
  );
}
