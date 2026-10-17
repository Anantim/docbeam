export type Tone = 'idle' | 'busy' | 'ok' | 'warn' | 'bad';

/**
 * The one colour meaning for every status in the app (D-M3-12): grey is waiting or nothing yet, blue is working,
 * green is done, amber is being checked, red is a problem. The same tone is used for a delivery, a distribution
 * and a file being uploaded, so "Verified" on Distribute and "Delivered" on Status read the same.
 */
export const TONES: Record<Tone, { bg: string; fg: string; dot: string }> = {
  idle: { bg: '#F2F4F7', fg: '#344054', dot: '#98A2B3' },
  busy: { bg: '#EEF3FF', fg: '#1F45A0', dot: '#2B59C3' },
  ok: { bg: '#ECFDF3', fg: '#067647', dot: '#12B76A' },
  warn: { bg: '#FFFAEB', fg: '#93370D', dot: '#F79009' },
  bad: { bg: '#FEF3F2', fg: '#B42318', dot: '#F04438' },
};

interface Props {
  tone: Tone;
  label: string;
  /** The one-line meaning, from `web/src/explain.ts`. */
  title?: string | undefined;
  /** The larger chip in the header of a distribution. */
  big?: boolean;
  role?: 'status';
}

/** The coloured box with a dot. Delivery states, distribution states and file states all use it. */
export function StatusChip({ tone, label, title, big = false, role }: Props) {
  const t = TONES[tone];
  return (
    <span className={`status-chip ${big ? 'big' : ''}`} data-tone={tone} style={{ background: t.bg, color: t.fg }} title={title} role={role}>
      <span className="status-dot" style={{ background: t.dot }} aria-hidden="true" />
      {label}
    </span>
  );
}
