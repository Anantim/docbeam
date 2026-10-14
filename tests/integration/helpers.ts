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

export const AUTH_URL = 'http://localhost:3001';
export const PLATFORM_URL = 'http://localhost:3002';
export const DOCBEAM_URL = 'http://localhost:3003';

export interface Reply {
  status: number;
  body: any;
  headers: Headers;
}

export async function call(
  base: string,
  path: string,
  options: { method?: string; token?: string; json?: unknown; cookie?: string; headers?: Record<string, string> } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.cookie) headers.cookie = options.cookie;
  if (options.json !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${base}${path}`, {
    method: options.method ?? (options.json !== undefined ? 'POST' : 'GET'),
    headers,
    body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // not JSON
  }
  return { status: res.status, body, headers: res.headers };
}

/** The `name=value` part of the refresh cookie in a response, for sending back. */
export function refreshCookie(reply: Reply): string {
  const header = reply.headers.getSetCookie().find((c) => c.startsWith('docbeam_refresh='));
  if (!header) throw new Error('no refresh cookie in the response');
  return header.split(';')[0] as string;
}

let counter = 0;
export function uniqueEmail(prefix = 'user'): string {
  counter += 1;
  return `${prefix}.${Date.now()}.${counter}@example.com`;
}

export const TEST_PASSWORD = 'correct-horse-battery-staple';

export async function registerAndLogin(email = uniqueEmail(), name = 'Test User'): Promise<{ id: string; email: string; token: string; cookie: string }> {
  const created = await call(AUTH_URL, '/auth/register', { json: { email, password: TEST_PASSWORD, name } });
  if (created.status !== 201) throw new Error(`register failed: ${created.status}`);
  const login = await call(AUTH_URL, '/auth/login', { json: { email, password: TEST_PASSWORD } });
  return { id: created.body.id, email, token: login.body.accessToken, cookie: refreshCookie(login) };
}

/** A service token for one of the four clients, using the secrets in .env. */
export async function serviceToken(clientId: string, scope: string): Promise<string> {
  const secret = env[`CLIENT_SECRET_${clientId.toUpperCase().replace(/-/g, '_')}`];
  const reply = await call(AUTH_URL, '/auth/token', { json: { clientId, clientSecret: secret, scope } });
  if (reply.status !== 200) throw new Error(`service token failed: ${reply.status}`);
  return reply.body.accessToken;
}
