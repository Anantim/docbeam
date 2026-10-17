// Helpers for the M5 checks on dev (scripts/m5/checks.ts). Run with Node 22 (types are stripped, no build step).
// Nothing here prints a password or a token. Secrets are read from Secrets Manager when needed.
import { execFileSync } from 'node:child_process';
import { createHash, createCipheriv, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const REGION = process.env.AWS_REGION ?? 'ap-southeast-2';
export const ENV = 'dev';
export const NAME = `docbeam-${ENV}`;
export const ROOT = new URL('../../', import.meta.url).pathname;

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
export const now = (): string => new Date().toISOString();
export const log = (msg: string): void => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

// ---------------------------------------------------------------- results

export interface Result {
  name: string;
  pass: boolean;
  detail: string;
}
const results: Result[] = [];

/** Records one line of evidence. A check passes when all its lines pass. */
export function expect(name: string, pass: boolean, detail: string): boolean {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
  return pass;
}

export function finish(check: string): never {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${failed.length === 0 ? 'PASS' : 'FAIL'} ${check} (${results.length - failed.length}/${results.length} lines)`);
  process.exit(failed.length === 0 ? 0 : 1);
}

// ---------------------------------------------------------------- shell, AWS

export function sh(cmd: string, args: string[], options: { input?: string; allowFail?: boolean } = {}): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', input: options.input, maxBuffer: 256 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    if (options.allowFail) return '';
    const e = error as { stderr?: string; message: string };
    throw new Error(`${cmd} ${args.slice(0, 4).join(' ')} failed: ${(e.stderr ?? e.message).slice(0, 600)}`, { cause: error });
  }
}

export const aws = (args: string[], options: { allowFail?: boolean } = {}): string => sh('aws', [...args, '--region', REGION], options);
export const awsJson = <T>(args: string[]): T => JSON.parse(aws([...args, '--output', 'json'])) as T;

let accountCache = '';
export function account(): string {
  accountCache ||= aws(['sts', 'get-caller-identity', '--query', 'Account', '--output', 'text']);
  return accountCache;
}

export const tf = (output: string): string => sh('terraform', [`-chdir=${ROOT}infra/envs/dev`, 'output', '-raw', output]);

export const appUrl = (): string => process.env.APP ?? tf('app_url');

let pw = '';
/** The shared seed password (dev only), read from Secrets Manager. Never printed. */
export function seedPassword(): string {
  pw ||= process.env.SEED_PW ?? aws(['secretsmanager', 'get-secret-value', '--secret-id', `${NAME}/seed/user-password`, '--query', 'SecretString', '--output', 'text']);
  return pw;
}

export const queueUrl = (queue: string): string => aws(['sqs', 'get-queue-url', '--queue-name', `${NAME}-${queue}`, '--query', 'QueueUrl', '--output', 'text']);

export function queueDepth(queue: string): { visible: number; inFlight: number; delayed: number } {
  const a = awsJson<{ Attributes: Record<string, string> }>([
    'sqs', 'get-queue-attributes', '--queue-url', queueUrl(queue), '--attribute-names', 'All',
  ]).Attributes;
  return {
    visible: Number(a.ApproximateNumberOfMessages),
    inFlight: Number(a.ApproximateNumberOfMessagesNotVisible),
    delayed: Number(a.ApproximateNumberOfMessagesDelayed),
  };
}

/** Max of a queue's visible-message metric over a window, from CloudWatch (server side). */
export function queueMaxVisible(queue: string, start: string, end: string): number {
  const out = awsJson<{ Datapoints: Array<{ Maximum: number }> }>([
    'cloudwatch', 'get-metric-statistics', '--namespace', 'AWS/SQS', '--metric-name', 'ApproximateNumberOfMessagesVisible',
    '--dimensions', `Name=QueueName,Value=${NAME}-${queue}`, '--start-time', start, '--end-time', end, '--period', '60', '--statistics', 'Maximum',
  ]);
  return out.Datapoints.reduce((m, d) => Math.max(m, d.Maximum), 0);
}

export function alarmStates(): Record<string, string> {
  const out = awsJson<{ MetricAlarms: Array<{ AlarmName: string; StateValue: string }> }>(['cloudwatch', 'describe-alarms', '--alarm-name-prefix', NAME]);
  return Object.fromEntries(out.MetricAlarms.map((a) => [a.AlarmName, a.StateValue]));
}

/** Logs Insights: runs a query and returns the rows as objects. */
export async function insights(logGroup: string, query: string, startMs: number, endMs: number): Promise<Array<Record<string, string>>> {
  const id = aws([
    'logs', 'start-query', '--log-group-name', logGroup, '--start-time', String(Math.floor(startMs / 1000)),
    '--end-time', String(Math.ceil(endMs / 1000)), '--query-string', query, '--query', 'queryId', '--output', 'text',
  ]);
  for (let i = 0; i < 60; i += 1) {
    await sleep(2000);
    const r = awsJson<{ status: string; results: Array<Array<{ field: string; value: string }>> }>(['logs', 'get-query-results', '--query-id', id]);
    if (r.status === 'Complete') return r.results.map((row) => Object.fromEntries(row.map((c) => [c.field, c.value])));
    if (['Failed', 'Cancelled', 'Timeout'].includes(r.status)) throw new Error(`Logs Insights query ${r.status}`);
  }
  throw new Error('Logs Insights query did not finish in 2 minutes');
}

export const GATEWAY_LOG_GROUP = `/docbeam/${NAME}/api-gateway`;

export interface Latency {
  count: number;
  p50: number;
  p99: number;
  max: number;
}

/** Latency of one gateway route, measured by API Gateway (`responseLatency`), not by this machine. */
export async function gatewayLatency(routeKey: string, startMs: number, endMs: number): Promise<Latency> {
  const q = `fields @timestamp, latency | filter routeKey = '${routeKey}' | stats count() as n, pct(latency, 50) as p50, pct(latency, 99) as p99, max(latency) as max`;
  const [row] = await insights(GATEWAY_LOG_GROUP, q, startMs, endMs);
  return { count: Number(row?.n ?? 0), p50: Number(row?.p50 ?? NaN), p99: Number(row?.p99 ?? NaN), max: Number(row?.max ?? NaN) };
}

/** One-off ECS task in the service's network (scripts/run-task.sh). Returns the task log. */
export function runTask(service: string, task: string, command: string[] = []): string {
  return sh(`${ROOT}scripts/run-task.sh`, [ENV, service, task, ...command]);
}

/** The Delivery (or any) SQS trigger. `enabled` false pauses it; waits until the state has changed. */
export async function setTrigger(fn: string, enabled: boolean): Promise<void> {
  const list = awsJson<{ EventSourceMappings: Array<{ UUID: string; State: string }> }>(['lambda', 'list-event-source-mappings', '--function-name', `${NAME}-${fn}`]);
  for (const m of list.EventSourceMappings) {
    aws(['lambda', 'update-event-source-mapping', '--uuid', m.UUID, enabled ? '--enabled' : '--no-enabled', '--query', 'State', '--output', 'text']);
  }
  const want = enabled ? 'Enabled' : 'Disabled';
  for (let i = 0; i < 60; i += 1) {
    const states = awsJson<{ EventSourceMappings: Array<{ State: string }> }>(['lambda', 'list-event-source-mappings', '--function-name', `${NAME}-${fn}`]).EventSourceMappings.map((m) => m.State);
    if (states.every((s) => s === want)) {
      // The mapping says Disabled, but a poll already open can still hand over messages for a little while (seen on
      // dev: 6 deliveries ran 50 s after "Disabled"). Wait that out, so "paused" means paused.
      if (!enabled) await sleep(120_000);
      return;
    }
    await sleep(5000);
  }
  throw new Error(`The ${fn} trigger did not become ${want}`);
}

export async function setPlatformCount(count: number): Promise<void> {
  aws(['ecs', 'update-service', '--cluster', `${NAME}-cluster`, '--service', `${NAME}-platform`, '--desired-count', String(count), '--query', 'service.desiredCount', '--output', 'text']);
  for (let i = 0; i < 90; i += 1) {
    const s = awsJson<{ services: Array<{ runningCount: number; desiredCount: number; deployments: unknown[] }> }>([
      'ecs', 'describe-services', '--cluster', `${NAME}-cluster`, '--services', `${NAME}-platform`,
    ]).services[0];
    if (s && s.runningCount === count && s.desiredCount === count) return;
    await sleep(5000);
  }
  throw new Error(`The platform did not reach ${count} running tasks`);
}

// ---------------------------------------------------------------- API client

/** fetch that tries again when the network drops (a laptop on a home link times out now and then). Not for HTTP errors. */
export async function fetchRetry(url: string, init: RequestInit, attempts = 5): Promise<Response> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      if (attempt === attempts) throw error;
      await sleep(1000 * attempt);
    }
  }
}

export interface Reply {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  headers: Headers;
  ms: number;
}

export class Api {
  readonly base: string;
  token: string;
  /** Signs in again when a call gets 401 because the 15-minute token ran out during a long check. */
  renew?: () => Promise<string>;

  constructor(base: string, token = '') {
    this.base = base;
    this.token = token;
  }

  async call(method: string, path: string, options: { json?: unknown; headers?: Record<string, string>; token?: string | null; cookie?: string } = {}): Promise<Reply> {
    const reply = await this.send(method, path, options);
    if (reply.status === 401 && options.token === undefined && this.renew) {
      this.token = await this.renew();
      return this.send(method, path, options);
    }
    return reply;
  }

  private async send(method: string, path: string, options: { json?: unknown; headers?: Record<string, string>; token?: string | null; cookie?: string }): Promise<Reply> {
    const headers: Record<string, string> = { ...options.headers };
    const token = options.token === undefined ? this.token : options.token;
    if (token) headers.authorization = `Bearer ${token}`;
    if (options.cookie) headers.cookie = options.cookie;
    if (options.json !== undefined) headers['content-type'] = 'application/json';
    const t0 = performance.now();
    const res = await fetchRetry(`${this.base}/api${path}`, { method, headers, body: options.json !== undefined ? JSON.stringify(options.json) : undefined });
    const text = await res.text();
    const ms = performance.now() - t0;
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // not JSON
    }
    return { status: res.status, body, headers: res.headers, ms };
  }
  get = (path: string, options = {}): Promise<Reply> => this.call('GET', path, options);
  post = (path: string, json?: unknown, options: { headers?: Record<string, string>; token?: string | null } = {}): Promise<Reply> =>
    this.call('POST', path, { ...options, json });
}

export async function login(email: string, password = seedPassword()): Promise<{ api: Api; cookie: string; reply: Reply }> {
  const api = new Api(appUrl());
  const reply = await api.post('/auth/login', { email, password }, { token: null });
  const cookie = (reply.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  if (reply.status === 200) api.token = reply.body.accessToken;
  return { api, cookie, reply };
}

export async function mustLogin(email: string): Promise<Api> {
  const { api, reply } = await login(email);
  if (reply.status !== 200) throw new Error(`Sign-in as ${email} gave ${reply.status}`);
  api.renew = async () => {
    const again = await login(email);
    if (again.reply.status !== 200) throw new Error(`Sign-in again as ${email} gave ${again.reply.status}`);
    return again.api.token;
  };
  return api;
}

export const USERS = {
  priya: 'priya.shah@example.com',
  raj: 'raj.mehta@example.com',
  sam: 'sam.ito@example.com',
  load: 'load.user@example.com',
} as const;

// ---------------------------------------------------------------- files

export const sha256Hex = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');

/** A small PDF-looking file with unique bytes (the platform checks the first bytes, so it starts with %PDF-). */
export function smallPdf(name: string, size = 4096): Buffer {
  const head = Buffer.from(`%PDF-1.7\n% ${name} ${randomUUID()}\n`);
  return Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length), 0x20)]);
}

export const EICAR = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');

export interface Uploaded {
  fileId: string;
  name: string;
  sha256: string;
}

/** Uploads small files in waves of 20 (single-part presigned POST). Returns once S3 has them; scanning is separate. */
export async function uploadSmall(api: Api, files: Array<{ name: string; bytes: Buffer; contentType?: string }>): Promise<Uploaded[]> {
  const out: Uploaded[] = [];
  for (let i = 0; i < files.length; i += 20) {
    const wave = files.slice(i, i + 20);
    const r = await api.post('/uploads', {
      files: wave.map((f) => ({ name: f.name, sizeBytes: f.bytes.length, contentType: f.contentType ?? 'application/pdf', sha256: sha256Hex(f.bytes) })),
    });
    if (r.status !== 201) throw new Error(`POST /uploads gave ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    await Promise.all(
      r.body.uploads.map(async (u: { fileId: string; post: { url: string; fields: Record<string, string> } }, j: number) => {
        const f = wave[j]!;
        const form = new FormData();
        for (const [k, v] of Object.entries(u.post.fields)) form.append(k, v);
        form.append('file', new Blob([new Uint8Array(f.bytes)], { type: f.contentType ?? 'application/pdf' }), f.name);
        const res = await fetchRetry(u.post.url, { method: 'POST', body: form });
        if (res.status !== 204 && res.status !== 201 && res.status !== 200) throw new Error(`S3 refused ${f.name}: ${res.status} ${(await res.text()).slice(0, 300)}`);
        out.push({ fileId: u.fileId, name: f.name, sha256: sha256Hex(f.bytes) });
      }),
    );
  }
  return out;
}

export interface FileState {
  fileId: string;
  uploaded: boolean;
  scanStatus: string;
}

/** Polls until every file is clean (or the wait ends). Returns the last states. */
export async function waitScanned(api: Api, ids: string[], timeoutMs = 20 * 60_000): Promise<FileState[]> {
  const deadline = Date.now() + timeoutMs;
  let states: FileState[] = [];
  while (Date.now() < deadline) {
    states = [];
    for (let i = 0; i < ids.length; i += 100) {
      const r = await api.get(`/files?ids=${ids.slice(i, i + 100).join(',')}`);
      if (r.status !== 200) throw new Error(`GET /files gave ${r.status}`);
      states.push(...(r.body as FileState[]));
    }
    if (states.length === ids.length && states.every((s) => s.scanStatus !== 'pending')) return states;
    await sleep(3000);
  }
  return states;
}

export async function uploadClean(api: Api, count: number, label: string, size = 4096): Promise<Uploaded[]> {
  const files = await uploadSmall(api, Array.from({ length: count }, (_, i) => ({ name: `${label}-${String(i + 1).padStart(3, '0')}.pdf`, bytes: smallPdf(`${label}-${i}`, size) })));
  const states = await waitScanned(api, files.map((f) => f.fileId));
  const bad = states.filter((s) => s.scanStatus !== 'clean');
  if (bad.length > 0 || states.length !== files.length) throw new Error(`${bad.length} of ${files.length} files not clean (${[...new Set(states.map((s) => s.scanStatus))].join(', ')})`);
  return files;
}

// ---------------------------------------------------------------- destinations and jobs

interface SeedTeam {
  id: string;
  name: string;
  binders: Array<{ id: string; name: string }>;
}
export const loadTeams = (): SeedTeam[] => JSON.parse(readFileSync(`${ROOT}services/platform/seed/dev-load.json`, 'utf8')).teams as SeedTeam[];

/** The root of the first binder of Load Team 01..n, as job destinations. */
export const loadDestinations = (n: number): Array<{ binderId: string }> => loadTeams().slice(0, n).map((t) => ({ binderId: t.binders[0]!.id }));

export interface Submitted {
  jobId: string;
  taskCount: number;
  reply: Reply;
}

export async function submit(api: Api, files: Uploaded[], destinations: Array<{ binderId: string; folderId?: string | null }>, key = randomUUID()): Promise<Submitted> {
  const reply = await api.post(
    '/jobs',
    { files: files.map((f) => ({ fileId: f.fileId, sha256: f.sha256 })), mappings: files.map((f) => ({ fileId: f.fileId, destinations })) },
    { headers: { 'idempotency-key': key } },
  );
  return { jobId: reply.body?.jobId, taskCount: reply.body?.taskCount, reply };
}

export interface JobView {
  status: string;
  taskCount: number;
  counts: { pending: number; in_progress: number; completed: number; failed: number; cancelled: number };
  completedAt: string | null;
  submittedBy: { userId: string };
}
export const job = async (api: Api, jobId: string): Promise<JobView> => (await api.get(`/jobs/${jobId}`)).body as JobView;

/** Waits until nothing is open. Logs the counts about every 30 s. */
export async function waitDone(api: Api, jobId: string, timeoutMs = 60 * 60_000, onTick?: (v: JobView) => Promise<void> | void): Promise<JobView> {
  const deadline = Date.now() + timeoutMs;
  let last = 0;
  let v = await job(api, jobId);
  while (Date.now() < deadline) {
    v = await job(api, jobId);
    if (onTick) await onTick(v);
    if (Date.now() - last > 30_000) {
      last = Date.now();
      log(`job ${jobId.slice(0, 8)} ${JSON.stringify(v.counts)}`);
    }
    if (v.counts.pending === 0 && v.counts.in_progress === 0) return v;
    await sleep(5000);
  }
  return v;
}

/** All tasks of a job, 100 at a time. */
export interface TaskRow {
  taskId: string;
  fileId: string;
  fileName: string;
  destinationPath: string;
  status: string;
  failureCode: string | null;
}
export async function tasksOf(api: Api, jobId: string, status?: string): Promise<TaskRow[]> {
  const out: TaskRow[] = [];
  for (let page = 1; ; page += 1) {
    const r = await api.get(`/jobs/${jobId}/tasks?page=${page}&limit=100${status ? `&status=${status}` : ''}`);
    if (r.status !== 200) throw new Error(`GET tasks gave ${r.status}`);
    out.push(...(r.body.tasks as TaskRow[]));
    if (out.length >= r.body.total || r.body.tasks.length === 0) return out;
  }
}

export const countBy = <T>(rows: T[], key: (r: T) => string): Record<string, number> => {
  const m: Record<string, number> = {};
  for (const r of rows) m[key(r)] = (m[key(r)] ?? 0) + 1;
  return m;
};

// ---------------------------------------------------------------- numbers

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

// ---------------------------------------------------------------- deterministic big file (check 5.6)

/** The same pseudo-random bytes every time for one key, so a 1 GiB file is hashed first and re-read without a disk. */
export function* randomBlocks(totalBytes: number, key: Buffer, blockBytes = 1024 * 1024): Generator<Buffer> {
  const cipher = createCipheriv('aes-128-ctr', key, Buffer.alloc(16));
  const zero = Buffer.alloc(blockBytes);
  const head = Buffer.from('%PDF-1.7\n% m5 one gigabyte file\n');
  let left = totalBytes;
  let first = true;
  while (left > 0) {
    const size = Math.min(blockBytes, left);
    const block = cipher.update(zero.subarray(0, size));
    if (first) {
      head.copy(block);
      first = false;
    }
    yield block;
    left -= size;
  }
}
