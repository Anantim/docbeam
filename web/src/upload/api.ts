import { apiFetch } from '../auth/session.js';
import type { JobAccepted, JobRequest, UploadApi } from './api-types.js';

export type * from './api-types.js';

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** The DocBeam API calls of Step 2.6. Every one goes through `apiFetch` (one refresh, then the dialog). */
export const uploadApi: UploadApi = {
  async requestUploads(files) {
    return (await apiFetch<{ uploads: Awaited<ReturnType<UploadApi['requestUploads']>> }>('/uploads', json({ files }))).uploads;
  },
  startMultipart: (fileId, parts) => apiFetch(`/files/${fileId}/multipart-uploads`, json({ parts })),
  async resignParts(fileId, uploadId, parts) {
    return (await apiFetch<{ parts: Awaited<ReturnType<UploadApi['resignParts']>> }>(`/files/${fileId}/multipart-uploads/${uploadId}/parts`, json({ parts }))).parts;
  },
  async completeMultipart(fileId, uploadId, parts) {
    await apiFetch(`/files/${fileId}/multipart-uploads/${uploadId}/complete`, json({ parts }));
  },
  fileStates: (ids) => apiFetch(`/files?ids=${ids.join(',')}`),
};

export function submitJob(request: JobRequest, idempotencyKey: string): Promise<JobAccepted> {
  return apiFetch<JobAccepted>('/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
    body: JSON.stringify(request),
  });
}
