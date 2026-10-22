import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { logout } from '../auth/session.js';
import { initials, type Claims } from '../auth/token.js';
import { num, plural } from '../text.js';
import type { View } from '../tracking/route.js';
import type { PageFile, UploadManager } from '../upload/manager.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { LogoutIcon } from './Icons.js';
import { Logo } from './Logo.js';
import { Notice } from './Notice.js';
import { useOnline } from './useOnline.js';
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
  /** The upload queue, to know whether signing out would lose a file. With none, signing out never asks. */
  manager?: Pick<UploadManager, 'subscribe' | 'getSnapshot'>;
  children: ReactNode;
}

/** "1 distribution still running", "3 distributions still running": the badge's tooltip and its accessible name (D-F1-72). */
export const runningText = (n: number): string => `${plural(n, 'distribution', 'distributions')} still running`;

const NO_FILES: readonly PageFile[] = [];
const NO_UPLOADS = { subscribe: () => () => undefined, getSnapshot: () => NO_FILES };

/**
 * The app shell: the two tabs, the person, and sign out. Signing out while a file is still being read or uploaded (the files the
 * leave warning protects) asks first, because the files would be lost (D-F1-78).
 */
export function Shell({ claims, teams, view, onView, running = 0, manager = NO_UPLOADS, children }: Props) {
  const files = useSyncExternalStore(manager.subscribe, manager.getSnapshot);
  const atRisk = files.filter((f) => !(f.status === 'checking' || f.status === 'verified')).length;
  const [asking, setAsking] = useState(false);
  const online = useOnline();
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
                    {num(running)}
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
            <button className="icon" type="button" aria-label="Sign out" onClick={() => (atRisk > 0 ? setAsking(true) : void logout())}>
              <LogoutIcon />
            </button>
          </Tooltip>
        </div>
      </header>
      {!online && (
        // One quiet note under the header while the browser is offline; it goes by itself when the browser is back (D-F1-81).
        <div className="offline-note">
          <Notice tone="info" heading="You're offline. Uploads and live updates carry on when you're back." />
        </div>
      )}
      {children}
      {asking && atRisk > 0 && (
        <ConfirmDialog
          heading={`Sign out and stop ${plural(atRisk, 'upload', 'uploads')}?`}
          confirmLabel="Sign out"
          cancelLabel="Stay"
          onConfirm={() => void logout()}
          onCancel={() => setAsking(false)}
        >
          <p>Files that are still being read or uploaded are lost when you sign out.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
