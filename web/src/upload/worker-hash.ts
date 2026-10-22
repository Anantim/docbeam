import type { HashResult } from './hashing.js';
import type { HashMessage, HashRequest } from './hash.worker.js';

/** Hashes files one at a time in a Web Worker. */
export function createWorkerHasher(): (file: Blob, multipart: boolean, onProgress: (fraction: number) => void) => Promise<HashResult> {
  let worker: Worker | undefined;
  let next = 1;
  let chain: Promise<unknown> = Promise.resolve();

  const run = (file: Blob, multipart: boolean, onProgress: (fraction: number) => void): Promise<HashResult> =>
    new Promise((resolve, reject) => {
      worker ??= new Worker(new URL('./hash.worker.ts', import.meta.url), { type: 'module' });
      const w = worker;
      const id = next++;
      const finish = () => {
        w.removeEventListener('message', onMessage);
        w.removeEventListener('error', onError);
      };
      const onMessage = (event: MessageEvent<HashMessage>) => {
        if (event.data.id !== id) return;
        if (event.data.type === 'progress') onProgress(event.data.fraction);
        else if (event.data.type === 'done') {
          finish();
          resolve({ sha256: event.data.sha256, parts: event.data.parts });
        } else {
          finish();
          reject(new Error(event.data.message));
        }
      };
      const onError = () => {
        finish();
        worker = undefined;
        reject(new Error("Couldn't read the file."));
      };
      w.addEventListener('message', onMessage);
      w.addEventListener('error', onError);
      w.postMessage({ id, file, multipart } satisfies HashRequest);
    });

  return (file, multipart, onProgress) => {
    const result = chain.then(() => run(file, multipart, onProgress));
    chain = result.catch(() => undefined);
    return result;
  };
}
