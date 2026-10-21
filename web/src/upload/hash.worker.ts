import { hashFile } from './hashing.js';

// Runs the hashing off the main thread, so the page stays responsive while a 1 GB file is read.
export interface HashRequest {
  id: number;
  file: Blob;
  multipart: boolean;
}

export type HashMessage =
  | { id: number; type: 'progress'; fraction: number }
  | { id: number; type: 'done'; sha256: string; parts: string[] }
  | { id: number; type: 'error'; message: string };

self.onmessage = (event: MessageEvent<HashRequest>) => {
  const { id, file, multipart } = event.data;
  hashFile(file, multipart, (fraction) => self.postMessage({ id, type: 'progress', fraction } satisfies HashMessage))
    .then((result) => self.postMessage({ id, type: 'done', ...result } satisfies HashMessage))
    .catch((error: unknown) =>
      self.postMessage({ id, type: 'error', message: error instanceof Error ? error.message : "Couldn't read the file." } satisfies HashMessage),
    );
};
