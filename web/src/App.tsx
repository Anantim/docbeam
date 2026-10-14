import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { sessionStore } from './auth/session.js';
import { AuthCard } from './components/AuthCard.js';
import { Destinations } from './components/Destinations.js';
import { SessionDialog } from './components/SessionDialog.js';
import { Shell } from './components/Shell.js';
import { Toasts, type Toast } from './components/Toasts.js';
import { MAX_DESTINATIONS, toggle, type Destination } from './destinations/selection.js';
import type { Claims } from './auth/token.js';

function Distribute({ claims, onTeams, teams, notify }: { claims: Claims; teams: string[]; onTeams: (n: string[]) => void; notify: (text: string, kind?: Toast['kind']) => void }) {
  const [selected, setSelected] = useState<Destination[]>([]);

  const current = useRef(selected);
  current.current = selected;

  const onToggle = useCallback(
    (destination: Destination) => {
      const next = toggle(current.current, destination);
      if (next.refused) notify(`A distribution can have at most ${MAX_DESTINATIONS} destinations.`, 'error');
      else setSelected(next.selected);
    },
    [notify],
  );

  return (
    <Shell claims={claims} teams={teams}>
      <div className="page">
        <div>
          <h1>New distribution</h1>
          <div className="lead">Upload each file once, then send it to every folder that needs it.</div>
        </div>
        <div className="cols">
          <section className="card summary" aria-label="This distribution">
            <h2>This distribution</h2>
            <div className="count">{selected.length}</div>
            <div className="lead">destinations</div>
            <ul>
              {selected.map((d) => (
                <li key={`${d.binderId}:${d.folderId ?? ''}`}>
                  <span>{d.path}</span>
                  <button className="link" type="button" aria-label={`Remove ${d.path}`} onClick={() => onToggle(d)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <Destinations selected={selected} onToggle={onToggle} onTeams={onTeams} />
        </div>
      </div>
    </Shell>
  );
}

export function App() {
  const session = useSyncExternalStore(sessionStore.subscribe, sessionStore.getSnapshot);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const next = useRef(1);
  // The last signed-in view stays on screen under the dialog, so nothing on the page is lost.
  const lastClaims = useRef<Claims | null>(null);
  if (session.status === 'signedIn') lastClaims.current = session.claims;

  const notify = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = next.current++;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  if (session.status === 'booting') return null;
  if (session.status === 'signedOut') {
    lastClaims.current = null;
    return <AuthCard />;
  }
  const claims = lastClaims.current;
  if (!claims) return <AuthCard />;

  return (
    <>
      <Distribute claims={claims} teams={teams} onTeams={setTeams} notify={notify} />
      {session.status === 'ended' && <SessionDialog email={session.email} onSignedIn={() => notify('Signed in again.')} />}
      <Toasts toasts={toasts} />
    </>
  );
}
