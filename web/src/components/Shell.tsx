import type { ReactNode } from 'react';
import { logout } from '../auth/session.js';
import { initials, type Claims } from '../auth/token.js';
import type { View } from '../tracking/route.js';
import { LogoutIcon } from './Icons.js';
import { Logo } from './Logo.js';

const TABS: Array<[View, string]> = [
  ['distribute', 'Distribute'],
  ['status', 'Status'],
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

/** The app shell: the two tabs, the person, and sign out. */
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
            <div className="tm ellipsis" title={teams.join(', ')}>
              {teams.length > 3 ? `${teams.slice(0, 3).join(', ')} and ${teams.length - 3} more` : teams.join(', ')}
            </div>
          </div>
          <button className="icon" type="button" aria-label="Sign out" title="Sign out" onClick={() => void logout()}>
            <LogoutIcon />
          </button>
        </div>
      </header>
      {children}
    </>
  );
}
