// Entrypoint of the `ws-local` container in Docker Compose.
import { handler } from '@docbeam/worker-ws';
import { startWsLocal, type WsHandler } from './ws-local.js';

const server = await startWsLocal({
  port: Number(process.env.WS_LOCAL_PORT ?? 3004),
  // ws-local builds the same event fields API Gateway sends.
  handler: handler as unknown as WsHandler,
});
const shutdown = (): void => {
  server.close();
  process.exit(0);
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
