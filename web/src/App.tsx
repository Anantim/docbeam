import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { sessionStore } from './auth/session.js';
import { AuthCard } from './components/AuthCard.js';
import { Distribute } from './components/Distribute.js';
import { SessionDialog } from './components/SessionDialog.js';
import { Shell } from './components/Shell.js';
import { StatusPage } from './components/StatusPage.js';
import { Toasts, type Toast } from './components/Toasts.js';
import type { Claims } from './auth/token.js';
import { liveClient } from './live/instance.js';
import type { Counts } from './tracking/api.js';
import { hashFor, parseHash, type Route, type View } from './tracking/route.js';
import { runningCount, usePagedJobs } from './tracking/usePagedJobs.js';
import { uploadManager } from './upload/instance.js';

/** The page position lives in the URL hash, so a reload (or a shared link) opens the same screen and distribution. */
function useRoute(): [Route, (next: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = (): void => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const go = useCallback((next: Route): void => {
    const hash = hashFor(next);
    if (window.location.hash === hash) setRoute(next);
    else window.location.hash = hash;
  }, []);
  return [route, go];
}

export function App() {
  const session = useSyncExternalStore(sessionStore.subscribe, sessionStore.getSnapshot);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [route, go] = useRoute();
  // Counts the sign-ins made from the 12-hour dialog. Every list and the open distribution read again when it changes.
  const [signedInAgain, setSignedInAgain] = useState(0);
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

  // Signing out also leaves the distribution that was open: the next person in this tab starts on a clean page,
  // not on someone else's distribution ("not found"). A link opened while signed out is kept (it was never signed in).
  const wasSignedIn = useRef(false);
  useEffect(() => {
    if (session.status === 'signedIn') wasSignedIn.current = true;
    else if (session.status === 'signedOut' && wasSignedIn.current) {
      wasSignedIn.current = false;
      window.location.hash = hashFor({ view: 'distribute', jobId: null });
    }
  }, [session.status]);

  // One live connection while someone is signed in. Every token refresh gives a new token and so a new
  // connection, which is how the server checks the person's teams again (TDD Step 3.3).
  const token = session.status === 'signedIn' ? session.token : null;
  useEffect(() => {
    liveClient.setToken(token);
  }, [token]);

  // My distributions, refreshed every 30 seconds. Also the badge on the Status tab.
  const mine = usePagedJobs('mine', token !== null, undefined, signedInAgain);

  // The open distribution's live counts: the badge on the Status tab follows them (D-F1-15).
  const [liveJob, setLiveJob] = useState<{ jobId: string; counts: Counts } | null>(null);
  const onLive = useCallback((jobId: string, counts: Counts) => setLiveJob({ jobId, counts }), []);

  const openJob = useCallback((jobId: string | null): void => go({ view: 'status', jobId }), [go]);

  if (session.status === 'booting') return null;
  if (session.status === 'signedOut') {
    lastClaims.current = null;
    return <AuthCard />;
  }
  const claims = lastClaims.current;
  if (!claims) return <AuthCard />;

  const view: View = route.view;

  return (
    <>
      <Shell claims={claims} teams={teams} view={view} onView={(v) => go({ view: v, jobId: v === 'status' ? route.jobId : null })} running={runningCount(mine.jobs, liveJob)}>
        {/* Distribute stays mounted while another screen shows, so a prepared batch survives a look at Status. */}
        <div className="view" hidden={view !== 'distribute'}>
          <Distribute
            onTeams={setTeams}
            notify={notify}
            onSent={(jobId) => {
              void mine.refresh();
              openJob(jobId);
            }}
          />
        </div>
        {view === 'status' && (
          <StatusPage
            meId={claims.sub}
            jobId={route.jobId}
            onOpen={openJob}
            mine={mine}
            onLive={onLive}
            notify={notify}
            signedInAgain={signedInAgain}
          />
        )}
      </Shell>
      {session.status === 'ended' && (
        <SessionDialog
          email={session.email}
          onSignedIn={() => {
            setSignedInAgain((n) => n + 1);
            notify('Signed in again.');
          }}
        />
      )}
      <Toasts toasts={toasts} />
    </>
  );
}
