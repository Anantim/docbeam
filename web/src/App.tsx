import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { sessionStore } from './auth/session.js';
import { AuthCard } from './components/AuthCard.js';
import { Distribute } from './components/Distribute.js';
import { SessionDialog } from './components/SessionDialog.js';
import { Toasts, type Toast } from './components/Toasts.js';
import type { Claims } from './auth/token.js';
import { uploadManager } from './upload/instance.js';

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

  // A signed-out page keeps nothing: files picked by the last user are dropped from the queue.
  const signedOut = session.status === 'signedOut';
  useEffect(() => {
    if (signedOut) uploadManager.clear();
  }, [signedOut]);

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
