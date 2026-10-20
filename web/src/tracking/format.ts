// Words, tones and times for the Status view and its history. The colours themselves live in StatusChip (D-M3-12).
import type { Tone } from '../components/StatusChip.js';
import type { AuditEvent, JobStatus, TaskKind, TaskRow } from './api.js';

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
  completed: { label: 'Delivered', tone: 'ok' },
  failed: { label: 'Failed', tone: 'bad' },
  in_progress: { label: 'In progress', tone: 'busy' },
  pending: { label: 'Waiting', tone: 'idle' },
  cancelled: { label: 'Cancelled', tone: 'idle' },
};
export const taskLook = (kind: TaskKind): Chip => TASK_LOOKS[kind];

/** A delivery the sender cancelled is stored as failed with the code CANCELLED, and shown as its own kind. */
export const taskKindOf = (task: Pick<TaskRow, 'status' | 'failureCode'>): TaskKind =>
  task.status === 'failed' && task.failureCode === 'CANCELLED' ? 'cancelled' : task.status;

/** The first 8 characters of the id, which is how a distribution is named on screen (D-G16). */
export const shortId = (jobId: string): string => jobId.slice(0, 8);

export const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number): string => String(n).padStart(2, '0');

/** "16 Oct 22:41", in the browser's time zone. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

export const formatTime = (iso: string): string => {
  const d = new Date(iso);
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
};

export interface AuditLine {
  title: string;
  who: string;
  detail: string;
  /** Glyph and colours of the tile. */
  glyph: string;
  bad: boolean;
  tone: 'sent' | 'delivery' | 'retry' | 'cancel' | 'download' | 'files';
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

/** How one audit event reads on screen. Job-wide events of other people's distributions carry only a name. */
export function describeAudit(e: Pick<AuditEvent, 'action' | 'detail' | 'actorId'>): AuditLine {
  const d = e.detail;
  const who = text(d.actorName) || (e.actorId ? 'A team member' : 'System');
  const place = [text(d.fileName), text(d.destinationPath)].filter(Boolean);
  const where = place.length === 2 ? `${place[0]} to ${place[1]}` : place[0] ?? '';
  switch (e.action) {
    case 'job.submitted': {
      const files = num(d.fileCount);
      const tasks = num(d.taskCount);
      return {
        title: 'Distribution sent',
        who,
        detail: tasks ? `${plural(files, 'file', 'files')} to ${plural(num(d.destinationCount), 'destination', 'destinations')}, ${plural(tasks, 'delivery', 'deliveries')}.` : 'Distribution sent.',
        glyph: 'S',
        bad: false,
        tone: 'sent',
      };
    }
    case 'task.completed':
      return { title: 'Delivered', who, detail: where ? `${where}.` : 'A delivery completed.', glyph: 'D', bad: false, tone: 'delivery' };
    case 'task.failed': {
      const code = text(d.failureCode);
      return {
        title: code === 'CANCELLED' ? 'Delivery cancelled' : 'Delivery failed',
        who,
        detail: text(d.failureReason) || (where ? `${where}.` : 'A delivery failed.'),
        glyph: 'D',
        bad: code !== 'CANCELLED',
        tone: 'delivery',
      };
    }
    case 'job.retried': {
      const n = num(d.retried);
      return { title: 'Retry requested', who, detail: n ? `${plural(n, 'failed delivery', 'failed deliveries')} sent again.` : 'Failed deliveries were sent again.', glyph: 'R', bad: false, tone: 'retry' };
    }
    case 'job.cancelled': {
      const n = num(d.cancelled);
      return { title: 'Distribution cancelled', who, detail: n ? `${plural(n, 'waiting delivery', 'waiting deliveries')} cancelled.` : 'The sender cancelled the deliveries that had not started.', glyph: 'X', bad: false, tone: 'cancel' };
    }
    case 'download.issued':
      return {
        title: d.mode === 'preview' ? 'Preview link issued' : 'Download link issued',
        who,
        detail: where ? `${where}.` : 'A link was issued.',
        glyph: 'L',
        bad: false,
        tone: 'download',
      };
    case 'file.refused': {
      const reason = text(d.reason);
      const why = reason === 'MALWARE' ? 'malware found by the scan' : reason === 'MISMATCH' ? 'it did not match what was checked' : 'it could not be checked';
      return { title: 'File refused', who: who === 'System' ? 'System' : who, detail: `${text(d.fileName) || 'A file'}: ${why}.`, glyph: 'F', bad: true, tone: 'files' };
    }
    default:
      return { title: e.action, who, detail: '', glyph: '?', bad: false, tone: 'files' };
  }
}
