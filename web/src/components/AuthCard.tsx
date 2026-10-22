import { useState, type FormEvent } from 'react';
import { AuthError, login } from '../auth/session.js';
import { Logo } from './Logo.js';
import { PasswordField } from './PasswordField.js';
import { Notice } from './Notice.js';
import { PauseNote } from './PauseNote.js';

/**
 * Sign in. There is no self-registration in the web app (D-F1-17): the study administrator sets accounts up with the
 * seed script, and the Auth Service's register route stays, switched off by public_registration_enabled.
 */
export function AuthCard() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState(0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    setAttempts((n) => n + 1); // the password goes back to hidden
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-brand">
        <div className="name">
          <Logo />
          DocBeam
        </div>
        <div>
          <h1>One upload, every binder that needs it.</h1>
          <p>Clinical trial document distribution for study teams</p>
        </div>
      </div>
      <div className="auth-form-wrap">
        <form className="auth-form" onSubmit={(e) => void submit(e)}>
          <h2>Sign in</h2>
          {error && <Notice heading={error} detail={<PauseNote />} />}
          <div className="dialog-field">
            <label htmlFor="em">Work email</label>
            <input id="em" className="field" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="dialog-field">
            <label htmlFor="pw">Password</label>
            <PasswordField id="pw" value={password} onChange={setPassword} resetKey={attempts} />
          </div>
          <button className="btn" type="submit" disabled={busy}>
            Sign in
          </button>
          <p className="auth-foot">Accounts are set up by your study administrator.</p>
        </form>
      </div>
    </div>
  );
}
