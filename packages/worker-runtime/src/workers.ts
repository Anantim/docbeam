// Entrypoint of the `workers` container in Docker Compose. It stands in for the Lambda triggers:
// each queue is polled and its messages go to the same handler code that runs in Lambda,
// and the sweeper runs on timers like its EventBridge schedules.
import { createServer } from 'node:http';
import { SQSClient } from '@aws-sdk/client-sqs';
import { createLogger } from '@docbeam/shared';
import { handler as delivery } from '@docbeam/worker-delivery';
import { handler as dlq } from '@docbeam/worker-dlq';
import { handler as fanout } from '@docbeam/worker-fanout';
import { handler as sweeper } from '@docbeam/worker-sweeper';
import { handler as uploadEvents } from '@docbeam/worker-upload-events';
import { pollQueue, type QueueBinding } from './poller.js';

const log = createLogger('worker-runtime');
const region = process.env.AWS_REGION ?? 'ap-southeast-2';
const prefix = process.env.QUEUE_PREFIX ?? 'docbeam-local';
const sweepMs = Number(process.env.SWEEPER_INTERVAL_MS ?? 60_000);
const cleanupMs = Number(process.env.SWEEPER_CLEANUP_INTERVAL_MS ?? 24 * 60 * 60_000);
const healthPort = Number(process.env.WORKERS_HEALTH_PORT ?? 3005);

const sqs = new SQSClient({ region, endpoint: process.env.AWS_ENDPOINT_URL });

// Batch size 1 everywhere, as in Terraform. Concurrency is lower than AWS (Delivery 50, Upload Events 10)
// to suit a laptop.
const bindings: QueueBinding[] = [
  { queueName: `${prefix}-job`, handler: fanout, batchSize: 1, concurrency: 1 },
  { queueName: `${prefix}-task`, handler: delivery, batchSize: 1, concurrency: 5 },
  { queueName: `${prefix}-upload-events`, handler: uploadEvents, batchSize: 1, concurrency: 2 },
  { queueName: `${prefix}-job-dlq`, handler: dlq, batchSize: 1, concurrency: 1 },
  { queueName: `${prefix}-task-dlq`, handler: dlq, batchSize: 1, concurrency: 1 },
  { queueName: `${prefix}-upload-events-dlq`, handler: dlq, batchSize: 1, concurrency: 1 },
];

const controller = new AbortController();
let ready = false;

const health = createServer((req, res) => {
  const ok = req.url === '/health' && ready && !controller.signal.aborted;
  res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ status: ok ? 'ok' : 'starting' }));
});
health.listen(healthPort);

const runSweeper = (task: 'resend' | 'cleanup') => () => {
  sweeper({ task }).catch((err: unknown) => log.error('sweeper failed', { task, error: String(err) }));
};
const timers = [setInterval(runSweeper('resend'), sweepMs), setInterval(runSweeper('cleanup'), cleanupMs)];

const shutdown = (): void => {
  log.info('shutting down');
  controller.abort();
  timers.forEach(clearInterval);
  health.close();
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

const polling = bindings.map((b) => pollQueue(sqs, b, region, controller.signal));
ready = true;
log.info('workers started', { queues: bindings.map((b) => b.queueName) });
await Promise.all(polling);
