import {
  GetBucketNotificationConfigurationCommand,
  GetBucketVersioningCommand,
  HeadBucketCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { GetQueueAttributesCommand, GetQueueUrlCommand } from '@aws-sdk/client-sqs';
import { describe, expect, it } from 'vitest';
import { eventually, logLines, PREFIX, s3, sqs } from './helpers.js';

async function attributes(name: string) {
  const { QueueUrl } = await sqs.send(new GetQueueUrlCommand({ QueueName: name }));
  const { Attributes = {} } = await sqs.send(new GetQueueAttributesCommand({ QueueUrl, AttributeNames: ['All'] }));
  return Attributes;
}

describe('local LocalStack', () => {
  it('has the Object Store and the versioned Platform File Store', async () => {
    await s3.send(new HeadBucketCommand({ Bucket: `${PREFIX}-object-store` }));
    const versioning = await s3.send(new GetBucketVersioningCommand({ Bucket: `${PREFIX}-platform-files` }));
    expect(versioning.Status).toBe('Enabled');
  });

  it.each(['http://localhost:5173', 'http://127.0.0.1:5173'])(
    'answers a CORS preflight from the web app at %s',
    async (origin) => {
      // A browser sends this before an upload. A missing header here blocks every upload in the page.
      const res = await fetch(`http://localhost:4566/${PREFIX}-object-store`, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'PUT',
          'Access-Control-Request-Headers': 'content-type,x-amz-checksum-sha256',
        },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe(origin);
      expect(res.headers.get('access-control-allow-methods')).toMatch(/PUT/);
    },
  );

  it('does not allow another origin in a CORS preflight', async () => {
    const res = await fetch(`http://localhost:4566/${PREFIX}-object-store`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://evil.example', 'Access-Control-Request-Method': 'PUT' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it.each([
    ['job', '360', 'job-dlq', 3],
    ['task', '720', 'task-dlq', 5],
    ['upload-events', '3600', 'upload-events-dlq', 5],
  ])('has the %s queue with its visibility timeout and DLQ', async (name, visibility, dlq, maxReceive) => {
    const attrs = await attributes(`${PREFIX}-${name}`);
    expect(attrs.VisibilityTimeout).toBe(visibility);
    expect(attrs.MessageRetentionPeriod).toBe('1209600');
    const redrive = JSON.parse(attrs.RedrivePolicy ?? '{}');
    expect(redrive.deadLetterTargetArn).toMatch(new RegExp(`:${PREFIX}-${dlq}$`));
    expect(Number(redrive.maxReceiveCount)).toBe(maxReceive);
  });

  it('sends staging/ uploads to the Upload Events Queue, and the worker takes them', async () => {
    const config = await s3.send(new GetBucketNotificationConfigurationCommand({ Bucket: `${PREFIX}-object-store` }));
    expect(config.QueueConfigurations?.[0]?.QueueArn).toMatch(/:docbeam-local-upload-events$/);

    const since = new Date(Date.now() - 1000);
    const fileId = crypto.randomUUID();
    const key = `staging/${crypto.randomUUID()}/${fileId}`;
    await s3.send(new PutObjectCommand({ Bucket: `${PREFIX}-object-store`, Key: key, Body: 'hello' }));
    // No file row exists for this key, so the handler reads the event and acknowledges it as unknown.
    await eventually(() =>
      logLines('workers', since).find(
        (l) => l.name === 'upload-events' && l.msg === 'upload event for an unknown file' && l.fileId === fileId,
      ),
    );
  });
});
