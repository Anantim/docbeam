import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { Config } from './config.js';

/** The Job Queue (ADR-008). One message per job; the body carries only the job id, never a token. */
export interface JobQueue {
  sendJob(jobId: string): Promise<void>;
}

export function createJobQueue(config: Pick<Config, 'JOB_QUEUE_URL' | 'AWS_REGION' | 'AWS_ENDPOINT_URL'>): JobQueue {
  const client = new SQSClient({
    region: config.AWS_REGION,
    ...(config.AWS_ENDPOINT_URL ? { endpoint: config.AWS_ENDPOINT_URL } : {}),
  });
  return {
    async sendJob(jobId) {
      await client.send(new SendMessageCommand({ QueueUrl: config.JOB_QUEUE_URL, MessageBody: JSON.stringify({ jobId }) }));
    },
  };
}
