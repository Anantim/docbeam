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
import { NO_FILTERS, type Filters } from './tracking/filters.js';
import { hashFor, parseHash, type Route, type View } from './tracking/route.js';
import { usePagedJobs } from './tracking/usePagedJobs.js';
import { useRunningCount } from './tracking/useRunningCount.js';
import { clearBatch } from './distribute/batch-store.js';
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
  // The distribution that was just sent: its panel takes the focus when it opens (and only for that one).
  const [sentId, setSentId] = useState<string | null>(null);
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
    if (signedOut) {
      uploadManager.clear();
      clearBatch(); // the next person in this tab does not get this batch back (D-F1-66)
    }
  }, [signedOut]);

  // Signing out also leaves the distribution that was open: the next person in this tab starts on a clean page,
  // not on someone else's distribution ("not found"). A link opened while signed out is kept (it was never signed in).
  const wasSignedIn = useRef(false);
  useEffect(() => {
    if (session.status === 'signedIn') wasSignedIn.current = true;
    else if (session.status === 'signedOut' && wasSignedIn.current) {
      wasSignedIn.current = false;
      window.location.hash = hashFor({ view: 'distribute', jobId: null, filters: NO_FILTERS });
    }
  }, [session.status]);

  // One live connection while someone is signed in. Every token refresh gives a new token and so a new
  // connection, which is how the server checks the person's teams again (TDD Step 3.3).
  const token = session.status === 'signedIn' ? session.token : null;
  useEffect(() => {
    liveClient.setToken(token);
  }, [token]);

  // Everything I can see, unfiltered, refreshed every 30 seconds while something runs. It is the list of the Status page
  // while no filter is set, and the badge on the Status tab (pending and in progress), which no filter changes (D-F1-21).
  const all = usePagedJobs(NO_FILTERS, token !== null, undefined, signedInAgain);

  // The open distribution's live counts: the badge on the Status tab follows them (D-F1-15).
  const [liveJob, setLiveJob] = useState<{ jobId: string; counts: Counts } | null>(null);
  const onLive = useCallback((jobId: string, counts: Counts) => setLiveJob({ jobId, counts }), []);
  // The badge is the server's count over the whole list (D-F1-34). It is read again whenever the list is read, and the
  // moment the open distribution finishes (its live counts), without waiting for the next poll.
  const liveFinished = liveJob !== null && liveJob.counts.pending + liveJob.counts.in_progress === 0 ? liveJob.jobId : null;
  const running = useRunningCount(token !== null, all.jobs, liveFinished, signedInAgain);

  // Opening or closing a distribution keeps the filters; changing the filters keeps the open distribution.
  const routeRef = useRef(route);
  routeRef.current = route;
  // The heading takes the focus only when the panel of the sent distribution opens: leaving it (another distribution, or
  // another tab) ends that, so coming back to it later does not move the focus again.
  const sentWasOpen = useRef(false);
  useEffect(() => {
    if (sentId !== null && route.view === 'status' && route.jobId === sentId) sentWasOpen.current = true;
    else if (sentWasOpen.current) {
      sentWasOpen.current = false;
      setSentId(null);
    }
  }, [route.view, route.jobId, sentId]);

  const openJob = useCallback((jobId: string | null): void => go({ view: 'status', jobId, filters: routeRef.current.filters }), [go]);
  const setFilters = useCallback((filters: Filters): void => go({ view: 'status', jobId: routeRef.current.jobId, filters }), [go]);

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
      <Shell
        claims={claims}
        teams={teams}
        view={view}
        onView={(v) => go({ view: v, jobId: v === 'status' ? route.jobId : null, filters: v === 'status' ? route.filters : NO_FILTERS })}
        running={running}
        manager={uploadManager}
      >
        {/* Distribute stays mounted while another screen shows, so a prepared batch survives a look at Status. */}
        <div className="view" hidden={view !== 'distribute'}>
          <Distribute
            onTeams={setTeams}
            notify={notify}
            onSent={(jobId) => {
              void all.refresh();
              setSentId(jobId);
              go({ view: 'status', jobId, filters: NO_FILTERS }); // a new distribution is shown in the full list, whatever was filtered before
            }}
          />
        </div>
        {view === 'status' && (
          <StatusPage
            meId={claims.sub}
            jobId={route.jobId}
            filters={route.filters}
            onFilters={setFilters}
            onOpen={openJob}
            all={all}
            onLive={onLive}
            notify={notify}
            signedInAgain={signedInAgain}
            focusJobId={sentId}
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
