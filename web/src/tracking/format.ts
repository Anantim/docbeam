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

/** "16 Oct 22:41", in the browser's time zone. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${two(d.getHours())}:${two(d.getMinutes())}`;
}
