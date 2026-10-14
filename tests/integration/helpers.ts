import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { SQSClient } from '@aws-sdk/client-sqs';
import { S3Client } from '@aws-sdk/client-s3';

/** Values from .env, so the tests use the same local passwords as the stack. */
export const env: Record<string, string> = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);

const aws = {
  region: 'ap-southeast-2',
  endpoint: 'http://localhost:4566',
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
};
export const sqs = new SQSClient(aws);
export const s3 = new S3Client({ ...aws, forcePathStyle: true });

export const PREFIX = 'docbeam-local';

export function compose(...args: string[]): string {
  return execFileSync('docker', ['compose', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** JSON log lines a container wrote since the given time. */
export function logLines(service: string, since: Date): Record<string, unknown>[] {
  return compose('logs', '--no-log-prefix', '--since', since.toISOString(), service)
    .split('\n')
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
}

export async function eventually<T>(
  check: () => T | undefined | false | Promise<T | undefined | false>,
  timeoutMs = 20_000,
): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
