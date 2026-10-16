import { ChangeMessageVisibilityCommand, GetQueueUrlCommand, type SQSClient } from '@aws-sdk/client-sqs';

/** `arn:aws:sqs:region:account:name` gives `name`. */
export function queueNameFromArn(arn: string): string {
  const name = arn.split(':')[5];
  if (!name) throw new Error(`Not an SQS queue ARN: ${arn}`);
  return name;
}

/** What a Lambda record carries that is needed to change its own visibility. */
export interface QueueRecord {
  eventSourceARN: string;
  receiptHandle: string;
}

export interface VisibilityChanger {
  /** Hide the message for this many seconds, so SQS offers it again then (ADR-005). */
  change(record: QueueRecord, seconds: number): Promise<void>;
}

/** Looks up each queue's URL once per cold start; the event gives only the ARN. */
export function createVisibilityChanger(client: SQSClient): VisibilityChanger {
  const urls = new Map<string, Promise<string>>();

  function urlFor(arn: string): Promise<string> {
    let pending = urls.get(arn);
    if (!pending) {
      pending = client
        .send(new GetQueueUrlCommand({ QueueName: queueNameFromArn(arn) }))
        .then((out) => {
          if (!out.QueueUrl) throw new Error('SQS returned no queue URL.');
          return out.QueueUrl;
        });
      pending.catch(() => urls.delete(arn));
      urls.set(arn, pending);
    }
    return pending;
  }

  return {
    async change(record, seconds) {
      const QueueUrl = await urlFor(record.eventSourceARN);
      await client.send(
        new ChangeMessageVisibilityCommand({ QueueUrl, ReceiptHandle: record.receiptHandle, VisibilityTimeout: seconds }),
      );
    },
  };
}
