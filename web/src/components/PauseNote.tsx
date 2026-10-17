/**
 * The one fixed line under every failed sign-in (D-M3-13). It is the same for a wrong password, an unknown email
 * and a paused account, so the page shows neither which accounts exist nor which are paused (D-M1-7 stays).
 */
export const PAUSE_NOTE = 'After 5 wrong passwords in a row, sign-in pauses for 15 minutes. Wait, then try again.';

export function PauseNote() {
  return (
    <p className="pause-note" data-testid="pause-note">
      {PAUSE_NOTE}
    </p>
  );
}
