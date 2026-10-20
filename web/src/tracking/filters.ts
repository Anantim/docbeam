// The filters of the Status list (D-F1-21). They live in the URL hash, so a link or a reload keeps them, and they
// become the query of GET /jobs. Nothing here touches the window or the network.
import type { JobStatus } from './api.js';

export const STATUSES: readonly JobStatus[] = ['pending', 'in_progress', 'completed', 'completed_with_errors', 'cancelled'];

/** How far back "Sent" reaches. Today starts at midnight on the person's own clock. */
export type SentPreset = 'today' | '7d' | '30d';
export const SENT_PRESETS: readonly SentPreset[] = ['today', '7d', '30d'];
export const SENT_LABEL: Record<SentPreset, string> = { today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days' };

export interface Filters {
  status?: JobStatus;
  /** `me` or a user id. */
  sender?: string;
  sent?: SentPreset;
  /** A team id. */
  team?: string;
}

export const NO_FILTERS: Filters = {};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUnfiltered = (f: Filters): boolean => f.status === undefined && f.sender === undefined && f.sent === undefined && f.team === undefined;

/** The same filters, so a list is not read again for a new object that holds the same choices. */
export const sameFilters = (a: Filters, b: Filters): boolean => a.status === b.status && a.sender === b.sender && a.sent === b.sent && a.team === b.team;

/** The filters in a query string of the hash. A value that is not one of the choices is dropped, so a bad link opens the full list. */
export function filtersFromParams(params: URLSearchParams): Filters {
  const out: Filters = {};
  const status = params.get('status');
  if (status && (STATUSES as readonly string[]).includes(status)) out.status = status as JobStatus;
  const sender = params.get('sender');
  if (sender && (sender === 'me' || UUID.test(sender))) out.sender = sender.toLowerCase();
  const sent = params.get('sent');
  if (sent && (SENT_PRESETS as readonly string[]).includes(sent)) out.sent = sent as SentPreset;
  const team = params.get('team');
  if (team && UUID.test(team)) out.team = team.toLowerCase();
  return out;
}

/** In a fixed order, so the same choices are always the same address. Empty for no filters. */
export function filtersToQuery(f: Filters): string {
  const params = new URLSearchParams();
  if (f.status) params.set('status', f.status);
  if (f.sender) params.set('sender', f.sender);
  if (f.sent) params.set('sent', f.sent);
  if (f.team) params.set('team', f.team);
  return params.toString();
}

/** The date a "Sent" choice reaches back to, as the ISO time GET /jobs takes in `sentSince`. */
export function sentSince(preset: SentPreset, now: Date = new Date()): string {
  const start = new Date(now);
  if (preset === 'today') start.setHours(0, 0, 0, 0);
  else start.setTime(now.getTime() - (preset === '7d' ? 7 : 30) * 24 * 3_600_000);
  return start.toISOString();
}

/** The query of GET /jobs for these filters (always everything the person can see: `scope=all`). */
export function jobsQuery(f: Filters, now: Date = new Date()): string {
  const params = new URLSearchParams({ scope: 'all' });
  if (f.status) params.set('status', f.status);
  if (f.sender) params.set('sender', f.sender);
  if (f.sent) params.set('sentSince', sentSince(f.sent, now));
  if (f.team) params.set('team', f.team);
  return params.toString();
}
