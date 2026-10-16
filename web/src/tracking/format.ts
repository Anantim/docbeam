// Words, colours and times for the Status and Audit screens. Colours follow the mockup.
import type { AuditEvent, JobStatus, TaskStatus } from './api.js';

export interface Chip {
  label: string;
  bg: string;
  fg: string;
}

const JOB_CHIPS: Record<JobStatus, Chip> = {
  pending: { label: 'Pending', bg: '#F2F4F7', fg: '#344054' },
  in_progress: { label: 'In progress', bg: '#EEF3FF', fg: '#1F45A0' },
  completed: { label: 'Completed', bg: '#ECFDF3', fg: '#067647' },
  completed_with_errors: { label: 'Completed with errors', bg: '#FEF3F2', fg: '#B42318' },
  cancelled: { label: 'Cancelled', bg: '#F2F4F7', fg: '#344054' },
};
export const jobChip = (status: JobStatus): Chip => JOB_CHIPS[status];

export interface TaskLook extends Chip {
  dot: string;
}
const TASK_LOOKS: Record<TaskStatus, TaskLook> = {
  completed: { label: 'Delivered', bg: '#ECFDF3', fg: '#067647', dot: '#12B76A' },
  failed: { label: 'Failed', bg: '#FEF3F2', fg: '#B42318', dot: '#F04438' },
  in_progress: { label: 'In progress', bg: '#EEF3FF', fg: '#1F45A0', dot: '#2B59C3' },
  pending: { label: 'Waiting', bg: '#F2F4F7', fg: '#344054', dot: '#98A2B3' },
};
export const taskLook = (status: TaskStatus): TaskLook => TASK_LOOKS[status];

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

/** "Today", "Yesterday" or "12 Oct 2026", for the day headings of the Audit trail. */
export function dayHeading(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const startOf = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export interface AuditKind {
  id: string;
  label: string;
  actions: string[];
}

/** The Event filter of the Audit trail. "Deliveries" is two actions. */
export const AUDIT_KINDS: AuditKind[] = [
  { id: 'all', label: 'All', actions: [] },
  { id: 'sent', label: 'Sent', actions: ['job.submitted'] },
  { id: 'delivery', label: 'Deliveries', actions: ['task.completed', 'task.failed'] },
  { id: 'retry', label: 'Retries', actions: ['job.retried'] },
  { id: 'cancel', label: 'Cancels', actions: ['job.cancelled'] },
  { id: 'download', label: 'Downloads', actions: ['download.issued'] },
  { id: 'files', label: 'Uploads', actions: ['file.refused'] },
];

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
