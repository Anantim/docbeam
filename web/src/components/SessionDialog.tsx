import { useRef, useState, type FormEvent } from 'react';
import { AuthError, login, logout } from '../auth/session.js';
import { PasswordField } from './PasswordField.js';
import { Notice } from './Notice.js';
import { PauseNote } from './PauseNote.js';
import { useFocusTrap } from './useFocusTrap.js';

/** Opens when the 12 hours are up. It sits over the page, so nothing on the page is lost (flow 1). */
export function SessionDialog({ email, onSignedIn }: { email: string; onSignedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const box = useRef<HTMLFormElement>(null);
  useFocusTrap(box);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setAttempts((n) => n + 1); // the password goes back to hidden
    try {
      await login(email, password);
      onSignedIn();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  return (
    <>
      <div className="overlay" />
      <form ref={box} className="dialog" role="dialog" aria-modal="true" aria-label="Sign in again" onSubmit={(e) => void submit(e)}>
        <div className="dialog-body">
          <h2>Your sign-in has ended</h2>
          <p>Enter your password to carry on. Nothing on this page is lost.</p>
        </div>
        {error && <Notice heading={error} detail={<PauseNote />} />}
        <div className="dialog-field">
          <label htmlFor="again">Password for {email}</label>
          <PasswordField id="again" ariaLabel="Password" autoFocus value={password} onChange={setPassword} resetKey={attempts} />
        </div>
        <div className="actions">
          <button className="btn2" type="button" onClick={() => void logout()}>
            Sign out
          </button>
          <button className="btn" type="submit" disabled={busy}>
            Sign in again
          </button>
        </div>
      </form>
    </>
  );
}
