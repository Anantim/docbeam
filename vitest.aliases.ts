import { fileURLToPath } from 'node:url';

const src = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

// Tests run against the TypeScript sources, so no build is needed first.
export const aliases: Record<string, string> = {
  '@docbeam/shared': src('./packages/shared/src/index.ts'),
  '@docbeam/worker-runtime': src('./packages/worker-runtime/src/index.ts'),
  '@docbeam/worker-fanout': src('./workers/fanout/src/index.ts'),
  '@docbeam/worker-delivery': src('./workers/delivery/src/index.ts'),
  '@docbeam/worker-upload-events': src('./workers/upload-events/src/index.ts'),
  '@docbeam/worker-dlq': src('./workers/dlq/src/index.ts'),
  '@docbeam/worker-ws': src('./workers/ws/src/index.ts'),
  '@docbeam/worker-sweeper': src('./workers/sweeper/src/index.ts'),
};
