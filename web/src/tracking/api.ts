import { apiFetch } from '../auth/session.js';
import type { Counts } from '../live/socket.js';
import { jobsQuery, type Filters } from './filters.js';

export type { Counts } from '../live/socket.js';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';
/** What a delivery is shown as: a cancelled one is stored as failed with the code CANCELLED (D-M3-17). */
export type TaskKind = TaskStatus | 'cancelled';
export type JobStatus = 'pending' | 'in_progress' | 'completed' | 'completed_with_errors' | 'cancelled';

export interface JobSummary {
  jobId: string;
  submittedBy: { userId: string; name: string };
  createdAt: string;
  taskCount: number;
  /** Files and folders the caller may see in the distribution (all of them for the sender). */
  fileCount: number;
  destinationCount: number;
  counts: Counts;
  status: JobStatus;
}

export interface JobsPage {
  items: JobSummary[];
  /** Null at the end of the list. */
  nextCursor: string | null;
}

export interface Member {
  userId: string;
  name: string;
}

export interface TeamChoice {
  id: string;
  name: string;
}

export interface JobDetail extends Omit<JobSummary, 'fileCount' | 'destinationCount'> {
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

export interface FileLink {
  url: string;
  expiresAt: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

export const TASK_PAGE = 100;

const post = <T>(path: string): Promise<T> => apiFetch<T>(path, { method: 'POST' });

export const trackingApi = {
  /** One page of everything the person can see, newest first, after `cursor` (D-F1-21). */
  jobs: (filters: Filters, cursor: string | null, limit = 20): Promise<JobsPage> =>
    apiFetch(`/jobs?${jobsQuery(filters)}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  /** How many distributions the person can see are pending or in progress, over the whole list (D-F1-34). */
  running: async (): Promise<number> => (await apiFetch<{ running: number }>('/jobs/running')).running,
  /** The distributions the person can see whose id starts with these 8 characters, at most 5 (D-F1-32). */
  byIdPrefix: async (prefix: string): Promise<JobSummary[]> => (await apiFetch<JobsPage>(`/jobs?scope=all&idPrefix=${encodeURIComponent(prefix)}`)).items,
  /** The people in the person's teams, for the Sender filter. */
  members: async (): Promise<Member[]> => (await apiFetch<{ items: Member[] }>('/teams/members')).items,
  /** The person's teams, for the Team filter. */
  teams: async (): Promise<TeamChoice[]> => (await apiFetch<{ items: TeamChoice[]; nextCursor: string | null }>('/teams?limit=100')).items,
  job: (jobId: string): Promise<JobDetail> => apiFetch(`/jobs/${jobId}`),
  tasks: (jobId: string, page: number, status?: TaskKind): Promise<TaskPage> =>
    apiFetch(`/jobs/${jobId}/tasks?page=${page}&limit=${TASK_PAGE}${status ? `&status=${status}` : ''}`),
  /** A new 2-minute link on every call (D-M4-1). 404 and 410 arrive as an ApiFailure. */
  download: (fileId: string, mode: 'download' | 'preview'): Promise<FileLink> =>
    apiFetch(`/files/${fileId}/downloads`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) }),
  cancel: (jobId: string): Promise<{ cancelled: number }> => post(`/jobs/${jobId}/cancel`),
  retry: (jobId: string): Promise<{ retried: number }> => post(`/jobs/${jobId}/retry`),
};
