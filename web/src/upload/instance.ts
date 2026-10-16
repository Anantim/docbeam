import { whenSignedIn } from '../auth/session.js';
import { uploadApi } from './api.js';
import { browserTransport } from './browser-transport.js';
import { UploadManager } from './manager.js';
import { createWorkerHasher } from './worker-hash.js';

/** The page's one upload queue. It outlives the Distribute screen, so a re-render never drops an upload. */
export const uploadManager = new UploadManager({
  api: uploadApi,
  transport: browserTransport,
  hash: createWorkerHasher(),
  waitForSession: whenSignedIn,
});
