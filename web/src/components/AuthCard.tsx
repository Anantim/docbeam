import { useState, type FormEvent } from 'react';
import { AuthError, login, register } from '../auth/session.js';
import { Logo } from './Logo.js';
import { PauseNote } from './PauseNote.js';

/** Sign in, and the register card in the same style (D-G17). */
export function AuthCard() {
  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const registering = mode === 'register';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (registering) await register(name, email, password);
      else await login(email, password);
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
          <h1>One upload. Every binder that needs it.</h1>
          <p>Send trial documents to many team folders at once, and know exactly which deliveries succeeded and why any did not.</p>
        </div>
        <div className="foot">Clinical trial document distribution</div>
      </div>
      <div className="auth-form-wrap">
        <form className="auth-form" onSubmit={(e) => void submit(e)}>
          <div>
            <h2>{registering ? 'Create account' : 'Sign in'}</h2>
            <p className="sub">{registering ? 'Use your work email.' : 'Use your work account.'}</p>
          </div>
          {error && (
            <div role="alert" className="alert">
              {error}
              {!registering && <PauseNote />}
            </div>
          )}
          {registering && (
            <div>
              <label htmlFor="nm">Full name</label>
              <input id="nm" className="field" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          )}
          <div>
            <label htmlFor="em">Work email</label>
            <input id="em" className="field" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label htmlFor="pw">Password</label>
            <input
              id="pw"
              className="field"
              type="password"
              autoComplete={registering ? 'new-password' : 'current-password'}
              required
              minLength={registering ? 12 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {registering && <div className="hint">12 to 72 characters.</div>}
          </div>
          <button className="btn" type="submit" disabled={busy} style={{ minHeight: 44 }}>
            {registering ? 'Create account' : 'Sign in'}
          </button>
          <div className="auth-foot">
            <button
              className="link"
              type="button"
              onClick={() => {
                setMode(registering ? 'signin' : 'register');
                setError('');
              }}
            >
              {registering ? 'I already have an account' : 'Create an account'}
            </button>
            <span>You stay signed in for 12 hours</span>
          </div>
        </form>
      </div>
    </div>
  );
}
