// Words, tones and times for the Status view. The colours themselves live in StatusChip (D-M3-12).
import type { Tone } from '../components/StatusChip.js';
import { plural } from '../text.js';
import type { JobStatus, TaskKind, TaskRow } from './api.js';

export interface Chip {
  label: string;
  tone: Tone;
}

const JOB_CHIPS: Record<JobStatus, Chip> = {
  pending: { label: 'Pending', tone: 'idle' },
  in_progress: { label: 'In progress', tone: 'busy' },
  completed: { label: 'Completed', tone: 'ok' },
  completed_with_errors: { label: 'Completed with errors', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'idle' },
};
export const jobChip = (status: JobStatus): Chip => JOB_CHIPS[status];

const TASK_LOOKS: Record<TaskKind, Chip> = {
  completed: { label: 'Completed', tone: 'ok' },
  failed: { label: 'Failed', tone: 'bad' },
  in_progress: { label: 'In progress', tone: 'busy' },
  pending: { label: 'Pending', tone: 'idle' },
  cancelled: { label: 'Cancelled', tone: 'idle' },
};
export const taskLook = (kind: TaskKind): Chip => TASK_LOOKS[kind];

/** A delivery the sender cancelled is stored as failed with the code CANCELLED, and shown as its own kind. */
export const taskKindOf = (task: Pick<TaskRow, 'status' | 'failureCode'>): TaskKind =>
  task.status === 'failed' && task.failureCode === 'CANCELLED' ? 'cancelled' : task.status;

/** The first 8 characters of the id, which is how a distribution is named on screen (D-G16). */
export const shortId = (jobId: string): string => jobId.slice(0, 8);

export { plural };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number): string => String(n).padStart(2, '0');

const hhmm = (d: Date): string => `${two(d.getHours())}:${two(d.getMinutes())}`;
/** The whole days from `d` to `now` by the calendar of the viewer's time zone (not 24-hour blocks: a clock change makes a day 23 or 25 hours). */
const daysAgo = (d: Date, now: Date): number =>
  Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);

/**
 * The one way every time is written (D-F1-59), 24-hour, in the viewer's time zone, always with a comma before the time:
 * "Today, 04:34", "Yesterday, 18:10", "21 Oct, 04:34" (this year), "3 Mar 2025, 14:02" (earlier years).
 */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const ago = daysAgo(d, now);
  if (ago === 0) return `Today, ${hhmm(d)}`;
  if (ago === 1) return `Yesterday, ${hhmm(d)}`;
  const day = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? `${day}, ${hhmm(d)}` : `${day} ${d.getFullYear()}, ${hhmm(d)}`;
}

/** The full time for a tooltip, with seconds and the time zone: "21 Oct 2026, 04:34:12 IST" (the browser's short name for the zone). */
export function formatFull(iso: string): string {
  const d = new Date(iso);
  const zone = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${hhmm(d)}:${two(d.getSeconds())}${zone ? ` ${zone}` : ''}`;
}
