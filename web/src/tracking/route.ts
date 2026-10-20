// Where the page is, kept in the URL hash, so a reload mid-run opens the same screen and job, and a link to a
// distribution can be shared (flow 3, "Open a job"). The hash is read by App; nothing here touches the window.

export type View = 'distribute' | 'status';

export interface Route {
  view: View;
  /** The distribution open in the side panel of Status. */
  jobId: string | null;
  /** The panel shows the upload events (files refused), which belong to no distribution. */
  uploads: boolean;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** The first job id in a pasted id or link, lower-cased, or null. */
export function extractJobId(text: string): string | null {
  const found = UUID.exec(text);
  return found ? found[0].toLowerCase() : null;
}

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  // The old Audit trail address opens Status: its events are in the panels now (D-F1-7).
  if (path === 'audit') return { view: 'status', jobId: null, uploads: false };
  if (path === 'status/uploads') return { view: 'status', jobId: null, uploads: true };
  if (path === 'status' || path.startsWith('status/')) {
    return { view: 'status', jobId: extractJobId(path.slice('status'.length)), uploads: false };
  }
  return { view: 'distribute', jobId: null, uploads: false };
}

export function hashFor(route: Route): string {
  if (route.view === 'status') {
    if (route.uploads) return '#/status/uploads';
    return route.jobId ? `#/status/${route.jobId}` : '#/status';
  }
  return '#/';
}
