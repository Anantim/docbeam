import type { ReactNode } from 'react';
import { logout } from '../auth/session.js';
import { initials, type Claims } from '../auth/token.js';
import type { View } from '../tracking/route.js';
import { LogoutIcon } from './Icons.js';
import { Logo } from './Logo.js';
import { TeamList } from './TeamList.js';
import { Tooltip } from './Tooltip.js';

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

/** "1 distribution still running", "3 distributions still running": the badge's tooltip and its accessible name (D-F1-72). */
export const runningText = (n: number): string => `${n} ${n === 1 ? 'distribution' : 'distributions'} still running`;

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
                <Tooltip text={runningText(running)}>
                  <span className="tab-badge" role="img" aria-label={runningText(running)}>
                    {running}
                  </span>
                </Tooltip>
              )}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <div className="who">
          <span className="avatar">{initials(claims.name)}</span>
          <div className="who-text">
            {/* A very long name ends in an ellipsis and shows in full on hover; the teams stay on one line, at most about 220 px
                wide, and the ones that do not fit are "+N" with every team in a popover (D-F1-53). */}
            <Tooltip text={claims.name} block>
              <div className="nm ellipsis">{claims.name}</div>
            </Tooltip>
            <div className="tm">
              <TeamList names={teams} panelLabel="Your teams" align="end" room="max-width" />
            </div>
          </div>
          <Tooltip text="Sign out">
            <button className="icon" type="button" aria-label="Sign out" onClick={() => void logout()}>
              <LogoutIcon />
            </button>
          </Tooltip>
        </div>
      </header>
      {children}
    </>
  );
}
