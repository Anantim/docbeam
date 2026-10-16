import { apiFetch } from '../auth/session.js';
import type { Counts } from '../live/socket.js';

export type { Counts } from '../live/socket.js';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';
export type JobStatus = 'pending' | 'in_progress' | 'completed' | 'completed_with_errors' | 'cancelled';

export interface JobSummary {
  jobId: string;
  submittedBy: { userId: string; name: string };
  createdAt: string;
  taskCount: number;
  counts: Counts;
  status: JobStatus;
}

export interface JobDetail extends JobSummary {
  isSender: boolean;
  /** The server's clock when these counts were read. Pushes older than this are ignored. */
  asOf: string;
  /** The folders the caller may see in this distribution, as full paths. */
  destinations: string[];
  completedAt: string | null;
  cancelledAt: string | null;
  /** Sender only. */
  fileCount?: number;
  retry?: { open: boolean; retryable: number; reason?: 'JOB_CANCELLED' | 'RETRY_WINDOW_CLOSED' | 'NOTHING_TO_RETRY' };
  cancel?: { open: boolean; waiting: number };
}

export interface TaskRow {
  taskId: string;
  fileId: string;
  fileName: string;
  destinationPath: string;
  teamId: string;
  status: TaskStatus;
  attemptCount: number;
  failureCode: string | null;
  failureReason: string | null;
  updatedAt: string;
  /** The staged file is past its 33 days, so a download would fail (M4). */
  fileExpired: boolean;
}

export interface TaskPage {
  page: number;
  limit: number;
  total: number;
  tasks: TaskRow[];
}

export interface AuditEvent {
  id: number;
  occurredAt: string;
  action: string;
  actorId: string | null;
  jobId: string | null;
  taskId: string | null;
  teamId: string | null;
  detail: Record<string, unknown>;
}

export interface AuditPage {
  page: number;
  limit: number;
  hasMore: boolean;
  events: AuditEvent[];
}

export const TASK_PAGE = 100;

const post = <T>(path: string): Promise<T> => apiFetch<T>(path, { method: 'POST' });

export const trackingApi = {
  jobs: (scope: 'mine' | 'team', limit = 20): Promise<JobSummary[]> => apiFetch(`/jobs?scope=${scope}&limit=${limit}`),
  job: (jobId: string): Promise<JobDetail> => apiFetch(`/jobs/${jobId}`),
  tasks: (jobId: string, page: number, status?: TaskStatus): Promise<TaskPage> =>
    apiFetch(`/jobs/${jobId}/tasks?page=${page}&limit=${TASK_PAGE}${status ? `&status=${status}` : ''}`),
  cancel: (jobId: string): Promise<{ cancelled: number }> => post(`/jobs/${jobId}/cancel`),
  retry: (jobId: string): Promise<{ retried: number }> => post(`/jobs/${jobId}/retry`),
  audit: (query: { jobId?: string; actions?: string[]; page?: number; limit?: number }): Promise<AuditPage> => {
    const params = new URLSearchParams();
    if (query.jobId) params.set('jobId', query.jobId);
    if (query.actions?.length) params.set('action', query.actions.join(','));
    params.set('page', String(query.page ?? 1));
    params.set('limit', String(query.limit ?? 50));
    return apiFetch(`/audit?${params.toString()}`);
  },
};
