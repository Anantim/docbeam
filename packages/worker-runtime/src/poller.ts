import {
  DeleteMessageBatchCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { createLogger } from '@docbeam/shared';
import { runBatch, toSqsEvent, type SqsHandler } from './batch.js';

export interface QueueBinding {
  queueName: string;
  handler: SqsHandler;
  /** Messages per call, like the trigger's batch size. */
  batchSize: number;
  /** Parallel pollers, like the trigger's maximum concurrency. */
  concurrency: number;
}

const log = createLogger('worker-runtime');

/** Polls one LocalStack queue and feeds its messages to a handler until the signal aborts. */
export async function pollQueue(sqs: SQSClient, binding: QueueBinding, region: string, signal: AbortSignal): Promise<void> {
  const { QueueUrl } = await sqs.send(new GetQueueUrlCommand({ QueueName: binding.queueName }));
  if (!QueueUrl) throw new Error(`queue not found: ${binding.queueName}`);
  const { Attributes } = await sqs.send(new GetQueueAttributesCommand({ QueueUrl, AttributeNames: ['QueueArn'] }));
  const queueArn = Attributes?.QueueArn ?? binding.queueName;
  log.info('polling queue', { queue: binding.queueName, concurrency: binding.concurrency });

  const loop = async (): Promise<void> => {
    while (!signal.aborted) {
      try {
        const { Messages = [] } = await sqs.send(
          new ReceiveMessageCommand({
            QueueUrl,
            MaxNumberOfMessages: binding.batchSize,
            WaitTimeSeconds: 10,
            MessageSystemAttributeNames: ['All'],
            MessageAttributeNames: ['All'],
          }),
          { abortSignal: signal },
        );
        if (Messages.length === 0) continue;
        const handles = await runBatch(binding.handler, toSqsEvent(Messages, queueArn, region));
        if (handles.length > 0) {
          await sqs.send(
            new DeleteMessageBatchCommand({
              QueueUrl,
              Entries: handles.map((ReceiptHandle, i) => ({ Id: String(i), ReceiptHandle })),
            }),
          );
        }
      } catch (err) {
        if (signal.aborted) return;
        log.error('poll failed', { queue: binding.queueName, error: String(err) });
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
  };
  await Promise.all(Array.from({ length: binding.concurrency }, loop));
}
