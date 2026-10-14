import { GetQueueAttributesCommand, GetQueueUrlCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { describe, expect, it } from 'vitest';
import { eventually, logLines, PREFIX, sqs } from './helpers.js';

async function send(queue: string, body: object): Promise<{ id: string; url: string }> {
  const { QueueUrl = '' } = await sqs.send(new GetQueueUrlCommand({ QueueName: `${PREFIX}-${queue}` }));
  const { MessageId = '' } = await sqs.send(new SendMessageCommand({ QueueUrl, MessageBody: JSON.stringify(body) }));
  return { id: MessageId, url: QueueUrl };
}

async function inFlight(url: string): Promise<number> {
  const { Attributes = {} } = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: url,
      AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
    }),
  );
  return Number(Attributes.ApproximateNumberOfMessages) + Number(Attributes.ApproximateNumberOfMessagesNotVisible);
}

describe('workers container', () => {
  it.each([
    ['task', 'delivery', 'task message received'],
    // upload-events and fanout have real logic since M2: see upload-events.test.ts and fanout.test.ts.
    ['job-dlq', 'dlq', 'dead-letter message received'],
    ['task-dlq', 'dlq', 'dead-letter message received'],
    ['upload-events-dlq', 'dlq', 'dead-letter message received'],
  ])('runs the handler for the %s queue and deletes the message', async (queue, name, msg) => {
    const since = new Date(Date.now() - 1000);
    const { id, url } = await send(queue, { test: queue });
    const line = await eventually(() =>
      logLines('workers', since).find((l) => l.name === name && l.msg === msg && l.messageId === id),
    );
    expect(line.receiveCount).toBe(1);
    await eventually(async () => (await inFlight(url)) === 0);
  });

  it('runs the sweeper on its one-minute timer', async () => {
    const since = new Date();
    await eventually(
      () => logLines('workers', since).find((l) => l.name === 'sweeper' && l.task === 'resend'),
      75_000,
    );
  }, 90_000);
});
