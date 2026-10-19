export type Tone = 'idle' | 'busy' | 'ok' | 'warn' | 'bad';

/**
 * The one colour meaning for every status in the app (D-M3-12, D-F1-5): grey is waiting or nothing yet, blue is
 * working, green is done, amber is being checked, red is a problem. The colours are tokens in `styles.css`, set
 * by the `data-tone` attribute here and on every dot and bar. The same tone is used for a delivery, a
 * distribution and a file being uploaded, so "Verified" on Distribute and "Delivered" on Status read the same.
 */
interface Props {
  tone: Tone;
  label: string;
  /** The one-line meaning, from `web/src/explain.ts`. */
  title?: string | undefined;
  /** The larger chip in the header of a distribution. */
  big?: boolean;
  role?: 'status';
}

/** The text with a dot, tinted by its tone. Delivery states, distribution states and file states all use it. */
export function StatusChip({ tone, label, title, big = false, role }: Props) {
  return (
    <span className={`status-chip ${big ? 'big' : ''}`} data-tone={tone} title={title} role={role}>
      <span className="status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
