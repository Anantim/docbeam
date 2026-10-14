import type { ReactNode } from 'react';
import { logout } from '../auth/session.js';
import { initials, type Claims } from '../auth/token.js';
import { Logo } from './Logo.js';

/** The app shell of the mockup. Status and Audit trail arrive in M3 (D-G16 leaves out the demo extras). */
export function Shell({ claims, teams, children }: { claims: Claims; teams: string[]; children: ReactNode }) {
  return (
    <>
      <header className="top">
        <div className="brand">
          <Logo />
          <span>DocBeam</span>
        </div>
        <nav aria-label="Main">
          <button className="tab" type="button" aria-current="page">
            Distribute
          </button>
          <button className="tab" type="button" disabled title="Coming in a later release">
            Status
          </button>
          <button className="tab" type="button" disabled title="Coming in a later release">
            Audit trail
          </button>
        </nav>
        <div className="spacer" />
        <div className="who">
          <span className="avatar">{initials(claims.name)}</span>
          <div>
            <div className="nm">{claims.name}</div>
            <div className="tm">{teams.join(', ')}</div>
          </div>
          <button className="icon" type="button" aria-label="Sign out" title="Sign out" onClick={() => void logout()}>
            <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M7 3H4v12h3M11 6l3 3-3 3M14 9H7" />
            </svg>
          </button>
        </div>
      </header>
      {children}
    </>
  );
}
