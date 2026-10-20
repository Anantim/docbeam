import { useRef, useState, type FormEvent } from 'react';
import { AuthError, login, logout } from '../auth/session.js';
import { PauseNote } from './PauseNote.js';
import { useFocusTrap } from './useFocusTrap.js';

/** Opens when the 12 hours are up. It sits over the page, so nothing on the page is lost (flow 1). */
export function SessionDialog({ email, onSignedIn }: { email: string; onSignedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLFormElement>(null);
  useFocusTrap(box);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
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
        <h2>Your sign-in has ended</h2>
        <p>
          You have been signed in for 12 hours, so DocBeam needs your password again. Nothing on this page is lost:
          uploads, your mapping and open distributions stay as they are.
        </p>
        {error && (
          <div role="alert" className="alert">
            {error}
            <PauseNote />
          </div>
        )}
        <div>
          <label htmlFor="again">
            Password for {email}
          </label>
          <input
            id="again"
            className="field"
            type="password"
            aria-label="Password"
            autoComplete="current-password"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
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
