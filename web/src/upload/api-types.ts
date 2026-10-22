// The shapes of the DocBeam API calls of Step 2.6. No browser or session code here, so the upload queue can run
// in Node (the integration test) with its own implementation of `UploadApi`.

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
  /** When the file's row was made, which is what the 24 hours of POST /jobs count from (ISO time). */
  createdAt?: string;
}

export interface JobRequest {
  files: { fileId: string; sha256: string }[];
  mappings: { fileId: string; destinations: { binderId: string; folderId?: string }[] }[];
}

export interface JobAccepted {
  jobId: string;
  taskCount: number;
}

export interface UploadApi {
  requestUploads(files: UploadRequest[]): Promise<UploadGrant[]>;
  startMultipart(fileId: string, parts: { partNumber: number; sha256: string }[]): Promise<MultipartStart>;
  resignParts(fileId: string, uploadId: string, parts: { partNumber: number; sha256: string }[]): Promise<PartLink[]>;
  completeMultipart(fileId: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void>;
  fileStates(ids: string[]): Promise<FileState[]>;
}
