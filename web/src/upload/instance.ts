import { UploadManager } from './manager.js';
import { browserTransport } from './transport.js';
import { createWorkerHasher } from './worker-hash.js';

/** The page's one upload queue. It outlives the Distribute screen, so a re-render never drops an upload. */
export const uploadManager = new UploadManager({ transport: browserTransport, hash: createWorkerHasher() });
