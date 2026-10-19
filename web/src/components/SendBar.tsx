interface Props {
  deliveries: number;
  ready: boolean;
  /** Why Send is off, in a few words. Shown beside the button. */
  reason?: string | null;
  sending: boolean;
  error: string | null;
  canClear: boolean;
  onClear: () => void;
  onSend: () => void;
}

/** The sticky bar: why Send is off (if it is), Clear and Send. Send is the one main action of the screen. */
export function SendBar({ deliveries, ready, reason, sending, error, canClear, onClear, onSend }: Props) {
  return (
    <div className="sendbar">
      <div className="sendbar-inner">
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        <div className="sendbar-row">
          <div className="send-reason" role="status">
            {ready ? null : reason}
          </div>
          <button className="btn2" type="button" disabled={!canClear} title={canClear ? undefined : 'Nothing to clear'} onClick={onClear}>
            Clear
          </button>
          <button className="btn" type="button" disabled={!ready || sending} title={ready || sending ? undefined : (reason ?? undefined)} onClick={onSend}>
            {sending ? 'Sending...' : `Send ${deliveries} ${deliveries === 1 ? 'delivery' : 'deliveries'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
