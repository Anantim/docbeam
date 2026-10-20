interface Props {
  /** The batch in one line: "3 files to 5 folders: 15 deliveries". Empty when there is nothing yet. */
  summary: string;
  ready: boolean;
  /** Why Send is off, in a few words. Shown under the summary. */
  reason?: string | null;
  sending: boolean;
  error: string | null;
  canClear: boolean;
  onClear: () => void;
  onSend: () => void;
}

/**
 * The sticky bar (D-F1-8): one summary line, then Clear (a text button) and Send, the only filled button of the
 * screen. Send is off with a one-line reason until the batch is valid, and asks for confirmation when it is pressed.
 */
export function SendBar({ summary, ready, reason, sending, error, canClear, onClear, onSend }: Props) {
  return (
    <div className="sendbar">
      <div className="sendbar-inner">
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        <div className="sendbar-row">
          <div className="send-text">
            <div className="send-summary">{summary}</div>
            <div className="send-reason" role="status">
              {ready ? null : reason}
            </div>
          </div>
          <button className="link plain-action" type="button" disabled={!canClear} title={canClear ? undefined : 'Nothing to clear'} onClick={onClear}>
            Clear
          </button>
          <button className="btn" type="button" disabled={!ready || sending} title={ready || sending ? undefined : (reason ?? undefined)} onClick={onSend}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
