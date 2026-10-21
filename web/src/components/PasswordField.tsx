import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EyeIcon, EyeOffIcon } from './Icons.js';
import { Tooltip } from './Tooltip.js';

interface Props {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Set when the field has no visible label of its own. */
  ariaLabel?: string;
  autoFocus?: boolean;
  /** The password goes back to hidden whenever this changes: a sign-in attempt (D-F1-61). */
  resetKey?: number;
}

/**
 * The one password input (D-F1-61), on the sign-in page and in the "Sign in again" dialog: an eye button inside the right end
 * of the field shows or hides the password. It is hidden when the field first appears (the page loads or the dialog opens)
 * and again after every sign-in attempt. The button comes right after the field in the Tab order, pressing it keeps the
 * focus where it was and the caret where it was, and pasting stays allowed. The browser's own reveal button is hidden in the
 * stylesheet, so Edge does not draw a second eye.
 */
export function PasswordField({ id, value, onChange, ariaLabel, autoFocus, resetKey = 0 }: Props) {
  const [shown, setShown] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<[number, number] | null>(null);

  useEffect(() => setShown(false), [resetKey]);

  // Changing the type can move the caret in some browsers: put it back, when the field had the focus.
  useLayoutEffect(() => {
    const field = input.current;
    const saved = caret.current;
    caret.current = null;
    if (field && saved && document.activeElement === field) field.setSelectionRange(saved[0], saved[1]);
  }, [shown]);

  const label = shown ? 'Hide password' : 'Show password';
  return (
    <div className="pwfield">
      <input
        id={id}
        ref={input}
        className="field"
        type={shown ? 'text' : 'password'}
        aria-label={ariaLabel}
        autoComplete="current-password"
        autoFocus={autoFocus}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="pw-toggle-slot">
        <Tooltip text={label}>
          <button
            type="button"
            className="icon small"
            aria-label={label}
            aria-pressed={shown}
            onMouseDown={(e) => e.preventDefault()} // a click does not take the focus (and the caret) out of the field
            onClick={() => {
              const field = input.current;
              if (field && document.activeElement === field) caret.current = [field.selectionStart ?? field.value.length, field.selectionEnd ?? field.value.length];
              setShown((was) => !was);
            }}
          >
            {shown ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </Tooltip>
      </span>
    </div>
  );
}
