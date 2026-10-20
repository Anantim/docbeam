// Where the page is, kept in the URL hash, so a reload mid-run opens the same screen and job, and a link to a
// distribution can be shared (flow 3, "Open a job"). The hash is read by App; nothing here touches the window.

export type View = 'distribute' | 'status';

export interface Route {
  view: View;
  /** The distribution open in the side panel of Status. */
  jobId: string | null;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** The first job id in a pasted id or link, lower-cased, or null. */
export function extractJobId(text: string): string | null {
  const found = UUID.exec(text);
  return found ? found[0].toLowerCase() : null;
}

/** The web app has no audit view (D-F1-13), so `#/audit` and `#/status/uploads` are not special: they open Status or Distribute. */
export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  if (path === 'status' || path.startsWith('status/')) return { view: 'status', jobId: extractJobId(path.slice('status'.length)) };
  return { view: 'distribute', jobId: null };
}

export function hashFor(route: Route): string {
  if (route.view === 'status') return route.jobId ? `#/status/${route.jobId}` : '#/status';
  return '#/';
}
