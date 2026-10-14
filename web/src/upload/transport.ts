/** What the Object Store answered. A network failure throws `TransportError` instead. */
export interface TransportResult {
  status: number;
  body: string;
  etag?: string;
}

export class TransportError extends Error {}

export interface Transport {
  /** A presigned POST: the form fields first, the file last (S3 requires it). */
  post(args: { url: string; fields: Record<string, string>; file: Blob; onProgress: (fraction: number) => void; signal: AbortSignal }): Promise<TransportResult>;
  /** One part of a multipart upload. The checksum header is part of the signed link. */
  put(args: { url: string; body: Blob; sha256Base64: string; onProgress: (fraction: number) => void; signal: AbortSignal }): Promise<TransportResult>;
  abort(url: string): Promise<void>;
}
