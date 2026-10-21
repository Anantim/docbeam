import { useId } from 'react';
import { Notice } from './Notice.js';
import { Tooltip } from './Tooltip.js';

interface Props {
  ready: boolean;
  /** Why Send is off, in a few words. Null when there is nothing to say (an empty page: the drop area says it). */
  reason?: string | null;
  sending: boolean;
  error: string | null;
  canClear: boolean;
  onClear: () => void;
  onSend: () => void;
}

/**
 * The sticky bar (D-F1-20): Clear (a text button) and Send, the only filled button of the screen. When Send is off the
 * reason is small muted text right beside them, tied to Send with `aria-describedby`; no tooltip carries it. The full
 * summary of the batch is in the question that Send asks.
 */
export function SendBar({ ready, reason, sending, error, canClear, onClear, onSend }: Props) {
  const reasonId = useId();
  const why = ready || !reason ? null : reason;
  return (
    <div className="sendbar">
      <div className="sendbar-inner">
        {error && <Notice heading={error} />}
        <div className="sendbar-row">
          <div className="send-reason" id={reasonId} role="status">
            {why}
          </div>
          <Tooltip text="Remove all files and folder ticks">
            <button className="link plain-action" type="button" disabled={!canClear} onClick={onClear}>
              Clear
            </button>
          </Tooltip>
          <button className="btn" type="button" disabled={!ready || sending} aria-describedby={why ? reasonId : undefined} onClick={onSend}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
