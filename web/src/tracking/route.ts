// Where the page is, kept in the URL hash, so a reload mid-run opens the same screen, job and filters, and a link to a
// distribution can be shared (flow 3, "Open a job"). The hash is read by App; nothing here touches the window.
import { filtersFromParams, filtersToQuery, NO_FILTERS, type Filters } from './filters.js';

export type View = 'distribute' | 'status';

export interface Route {
  view: View;
  /** The distribution open in the side panel of Status. */
  jobId: string | null;
  /** The filters of the Status list (D-F1-21). */
  filters: Filters;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** The first job id in a pasted id or link, lower-cased, or null. */
export function extractJobId(text: string): string | null {
  const found = UUID.exec(text);
  return found ? found[0].toLowerCase() : null;
}

/**
 * The web app has no audit view (D-F1-13), so `#/audit` and `#/status/uploads` are not special. The list is always
 * everything the person can see (D-F1-21): an old address with a scope in it (`#/status?scope=team`) opens the full
 * list, because only the filters the list knows are read.
 */
export function parseHash(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?', 2);
  if (path === 'status' || path.startsWith('status/')) {
    return { view: 'status', jobId: extractJobId(path.slice('status'.length)), filters: filtersFromParams(new URLSearchParams(query)) };
  }
  return { view: 'distribute', jobId: null, filters: NO_FILTERS };
}

export function hashFor(route: Route): string {
  if (route.view !== 'status') return '#/';
  const query = filtersToQuery(route.filters);
  return `${route.jobId ? `#/status/${route.jobId}` : '#/status'}${query ? `?${query}` : ''}`;
}
