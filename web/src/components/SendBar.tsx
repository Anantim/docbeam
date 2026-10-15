import type { Check } from '../distribute/mapping.js';

interface Props {
  checks: Check[];
  deliveries: number;
  ready: boolean;
  sending: boolean;
  error: string | null;
  canClear: boolean;
  onClear: () => void;
  onSend: () => void;
}

/** The sticky bar: the three checks, Clear and Send. */
export function SendBar({ checks,deliveries, ready, sending, error, canClear, onClear, onSend }: Props) {
  return (
    <div className="sendbar">
      {error && (
        <div className="alert send-error" role="alert">
          {error}
        </div>
      )}
      <div className="sendbar-row">
        <div className="checks">
          {checks.map((c) => (
            <span className={`check ${c.ok ? 'ok' : ''}`} key={c.label}>
              <span aria-hidden="true">{c.ok ? '✓ ' : '○ '}</span>
              <span>{c.label}</span>
            </span>
          ))}
        </div>
        <div className="grow" />
        <button className="btn2" type="button" disabled={!canClear} onClick={onClear}>
          Clear
        </button>
        <button className="btn" type="button" disabled={!ready || sending} onClick={onSend}>
          {sending ? 'Sending...' : `Send ${deliveries} ${deliveries === 1 ? 'delivery' : 'deliveries'}`}
        </button>
      </div>
    </div>
  );
}
