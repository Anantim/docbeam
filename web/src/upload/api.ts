import { apiFetch, ApiFailure, whenSignedIn } from '../auth/session.js';

export interface UploadRequest {
  name: string;
  sizeBytes: number;
  contentType: string;
  sha256: string;
}

export type UploadGrant =
  | { fileId: string; post: { url: string; fields: Record<string, string> } }
  | { fileId: string; multipart: true; partSize: number; partCount: number };

export interface PartLink {
  partNumber: number;
  url: string;
}

export interface MultipartStart {
  uploadId: string;
  parts: PartLink[];
  abortUrl: string;
}

export interface FileState {
  fileId: string;
  uploaded: boolean;
  scanStatus: 'pending' | 'clean' | 'infected' | 'failed';
}

export interface JobRequest {
  files: { fileId: string; sha256: string }[];
  mappings: { fileId: string; destinations: { binderId: string; folderId?: string }[] }[];
}

export interface JobAccepted {
  jobId: string;
  taskCount: number;
}

/** The DocBeam API calls of Step 2.6, typed. Every one goes through `apiFetch` (one refresh, then the dialog). */
export interface UploadApi {
  requestUploads(files: UploadRequest[]): Promise<UploadGrant[]>;
  startMultipart(fileId: string, parts: { partNumber: number; sha256: string }[]): Promise<MultipartStart>;
  resignParts(fileId: string, uploadId: string, parts: { partNumber: number; sha256: string }[]): Promise<PartLink[]>;
  completeMultipart(fileId: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void>;
  fileStates(ids: string[]): Promise<FileState[]>;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const uploadApi: UploadApi = {
  async requestUploads(files) {
    return (await apiFetch<{ uploads: UploadGrant[] }>('/uploads', json({ files }))).uploads;
  },
  startMultipart: (fileId, parts) => apiFetch<MultipartStart>(`/files/${fileId}/multipart-uploads`, json({ parts })),
  async resignParts(fileId, uploadId, parts) {
    return (await apiFetch<{ parts: PartLink[] }>(`/files/${fileId}/multipart-uploads/${uploadId}/parts`, json({ parts }))).parts;
  },
  async completeMultipart(fileId, uploadId, parts) {
    await apiFetch(`/files/${fileId}/multipart-uploads/${uploadId}/complete`, json({ parts }));
  },
  fileStates: (ids) => apiFetch<FileState[]>(`/files?ids=${ids.join(',')}`),
};

export function submitJob(request: JobRequest, idempotencyKey: string): Promise<JobAccepted> {
  return apiFetch<JobAccepted>('/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
    body: JSON.stringify(request),
  });
}

/**
 * Runs an API call. When the session has ended (401 after the one refresh), it waits behind the sign-in dialog
 * and tries once more, so an upload in progress is not lost (Step 1.6).
 */
export async function withSignIn<T>(call: () => Promise<T>, waitForSession: () => Promise<void> = whenSignedIn): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 401) {
      await waitForSession();
      return call();
    }
    throw error;
  }
}
