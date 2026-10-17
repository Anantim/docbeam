import type { ReactNode } from 'react';
import { logout } from '../auth/session.js';
import { initials, type Claims } from '../auth/token.js';
import type { View } from '../tracking/route.js';
import { Logo } from './Logo.js';

const TABS: Array<[View, string]> = [
  ['distribute', 'Distribute'],
  ['status', 'Status'],
  ['audit', 'Audit trail'],
];

interface Props {
  claims: Claims;
  teams: string[];
  view: View;
  onView: (view: View) => void;
  /** My distributions that are still running, shown as a badge on Status. */
  running?: number;
  children: ReactNode;
}

/** The app shell of the mockup: the three tabs, the person, and sign out. */
export function Shell({ claims, teams, view, onView, running = 0, children }: Props) {
  return (
    <>
      <header className="top">
        <div className="brand">
          <Logo />
          <span>DocBeam</span>
        </div>
        <nav aria-label="Main">
          {TABS.map(([id, label]) => (
            <button key={id} className="tab" type="button" aria-current={view === id ? 'page' : undefined} onClick={() => onView(id)}>
              {label}
              {id === 'status' && running > 0 && (
                <span className="tab-badge" aria-label={`${running} running`}>
                  {running}
                </span>
              )}
            </button>
          ))}
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
