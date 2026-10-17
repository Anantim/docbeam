// The M5 checks on deployed dev. One function per check of the TDD M5 list; each is run by a scripts/m5-*.sh wrapper.
//   node scripts/m5/checks.ts <check> [--yes]
// A check that changes AWS (trigger pause, scale to 0, object delete, queue purge, Multi-AZ, reboot) says what it will
// do and runs only with --yes. Every line prints PASS or FAIL with the numbers. Exit code 0 means all lines passed.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { LIMITS } from '../../packages/shared/src/limits.ts';
import {
  account, alarmStates, Api, appUrl, aws, awsJson, countBy, EICAR, expect, finish, gatewayLatency, insights, job, log, login, loadDestinations,
  mustLogin, NAME, percentile, queueDepth, queueMaxVisible, queueUrl, randomBlocks, REGION, ROOT, runTask, setPlatformCount, setTrigger,
  sh, sha256Hex, sleep, smallPdf, submit, tasksOf, tf, uploadClean, uploadSmall, USERS, waitDone, waitScanned, type Uploaded,
} from './lib.ts';

const args = process.argv.slice(3);
const yes = args.includes('--yes');
const flag = (name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

function needYes(what: string): void {
  if (yes) {
    log(`Changes AWS (approved with --yes): ${what}`);
    return;
  }
  console.log(`This check changes AWS: ${what}\nRun it again with --yes.`);
  process.exit(2);
}

const demo = JSON.parse(readFileSync(`${ROOT}services/platform/seed/demo.json`, 'utf8')) as {
  teams: Array<{ id: string; name: string; binders: Array<{ id: string; name: string }> }>;
};
const team = (n: string) => demo.teams.find((t) => t.name === n)!;
const cardio = team('Cardio');
const oncology = team('Oncology');

const objectBucket = (): string => `${NAME}-object-store-${account()}`;
const listOf = (body: any): any[] => (Array.isArray(body) ? body : (body.teams ?? body.jobs ?? body.items ?? [])); // eslint-disable-line @typescript-eslint/no-explicit-any

/** A read-only SQL query in the service's own network (a one-off task). Returns the rows. */
function sqlTask(service: 'platform' | 'docbeam-api' | 'auth', query: string): Array<Record<string, unknown>> {
  const code = `import pg from 'pg'; import { withDatabaseUrl } from '@docbeam/shared';
const p = new pg.Pool({ connectionString: withDatabaseUrl(process.env).DATABASE_URL, max: 1 });
const r = await p.query(${JSON.stringify(query)}); console.log('ROWS ' + JSON.stringify(r.rows)); await p.end();`;
  const out = runTask(service, 'service', ['node', '--input-type=module', '-e', code]);
  const line = out.split('\n').find((l) => l.startsWith('ROWS '));
  if (!line) throw new Error(`No ROWS line in the task log:\n${out.slice(-600)}`);
  return JSON.parse(line.slice(5));
}

/** Waits until the task and job queues and their DLQs hold nothing, so a check starts from a quiet system. */
async function waitQuiet(minutes = 25): Promise<void> {
  const deadline = Date.now() + minutes * 60_000;
  while (Date.now() < deadline) {
    const q = ['task', 'job'].map((n) => queueDepth(n));
    if (q.every((d) => d.visible + d.inFlight + d.delayed === 0)) return;
    await sleep(10_000);
  }
  log('Warning: the queues are not empty yet.');
}

const checks: Record<string, () => Promise<void>> = {
  // ------------------------------------------------------------------ 5.1
  async 'submit-load'() {
    const api = await mustLogin(USERS.load);
    const dests = loadDestinations(20);
    const plan: Array<{ files: number; jobs: number }> = [
      { files: 100, jobs: 5 },
      { files: 10, jobs: 20 },
      { files: 1, jobs: 75 },
    ];
    const sizes = plan.flatMap((p) => Array.from({ length: p.jobs }, () => p.files));
    // A fixed shuffle, so big and small jobs are mixed and a re-run is comparable.
    sizes.sort((a, b) => ((a * 7919) % 13) - ((b * 7919) % 13) || a - b);
    const total = sizes.reduce((s, n) => s + n, 0);
    log(`${sizes.length} jobs, ${total} files, up to 20 destinations each`);

    const pool = await uploadClean(api, total, 'm5-load');
    const t0 = Date.now() - 60_000;
    let at = 0;
    const clientMs: number[] = [];
    const bigMs: number[] = [];
    let wrong = 0;
    for (const n of sizes) {
      const files = pool.slice(at, at + n);
      at += n;
      const s = await submit(api, files, dests);
      clientMs.push(s.reply.ms);
      if (n === 100) bigMs.push(s.reply.ms);
      if (s.reply.status !== 201 || s.taskCount !== n * 20) {
        wrong += 1;
        log(`submit gave ${s.reply.status} ${JSON.stringify(s.reply.body).slice(0, 200)}`);
        continue;
      }
      await api.post(`/jobs/${s.jobId}/cancel`); // D-M5-7: no body, like a plain client
    }
    expect('every job accepted with files x 20 tasks', wrong === 0, `${sizes.length - wrong} of ${sizes.length}`);
    log('Waiting 90 s for the gateway access log, then reading it server side');
    await sleep(90_000);
    const server = await gatewayLatency('POST /jobs', t0, Date.now());
    expect('server-side POST /jobs, requests counted', server.count >= sizes.length, `${server.count}`);
    expect('server-side POST /jobs p99 under 500 ms', server.p99 < 500, `p50 ${server.p50} ms, p99 ${server.p99} ms, max ${server.max} ms (API Gateway responseLatency)`);
    log(`client side (includes the internet): p50 ${percentile(clientMs, 50).toFixed(0)} ms, p99 ${percentile(clientMs, 99).toFixed(0)} ms; the ${bigMs.length} jobs of 100 x 20: ${bigMs.map((m) => m.toFixed(0)).join(', ')} ms`);
    await waitQuiet();
    const dlq = ['job', 'task', 'upload-events'].map((q) => queueDepth(`${q}-dlq`).visible);
    expect('DLQs empty afterwards (job, task, upload events)', dlq.every((n) => n === 0), dlq.join(', '));
  },

  // ------------------------------------------------------------------ 5.2
  async 'removed-member'() {
    needYes('pauses the Delivery trigger, runs the platform seed variant (removes the load user from Load Team 20), resumes the trigger, then restores the seed');
    const api = await mustLogin(USERS.load);
    const files = await uploadClean(api, 100, 'm5-removed');
    try {
      await setTrigger('delivery', false);
      const s = await submit(api, files, loadDestinations(20));
      expect('2,000 tasks accepted', s.reply.status === 201 && s.taskCount === 2000, `${s.reply.status}, ${s.taskCount} tasks`);
      for (let i = 0; i < 60; i += 1) {
        const d = queueDepth('task');
        if (d.visible + d.inFlight >= 1990) break;
        await sleep(5000);
      }
      log(`Task queue holds ${JSON.stringify(queueDepth('task'))} with Delivery paused`);
      const held = await job(api, s.jobId);
      expect('with Delivery paused no delivery has started (all 2,000 pending)', held.counts.pending === 2000, JSON.stringify(held.counts));

      const seedLog = runTask('platform', 'seed', ['sh', '-c', 'SEED_FILES=demo.json,dev-load-m5-removed.json exec node dist/seed-run.js']);
      expect('the seed variant removed exactly one membership', /"file":"dev-load-m5-removed.json".*"membersRemoved":1/.test(seedLog), (seedLog.match(/membersRemoved":\d+/g) ?? []).join(' '));

      await setTrigger('delivery', true);
      const done = await waitDone(api, s.jobId, 60 * 60_000);
      const failed = await tasksOf(api, s.jobId, 'failed');
      const codes = countBy(failed, (t) => t.failureCode ?? 'none');
      expect('100 deliveries failed NOT_AUTHORIZED_AT_DELIVERY', codes.NOT_AUTHORIZED_AT_DELIVERY === 100 && failed.length === 100, JSON.stringify(codes));
      expect('all 100 are for Load Team 20', failed.every((t) => t.destinationPath.startsWith('Load Team 20')), failed[0]?.destinationPath ?? '');
      expect('1,900 completed', done.counts.completed === 1900, JSON.stringify(done.counts));
    } finally {
      await setTrigger('delivery', true).catch(() => undefined);
      const back = runTask('platform', 'seed');
      const restored = /"file":"dev-load.json".*"membersAdded":1/.test(back);
      const teams = listOf((await api.get('/teams')).body);
      expect('seed restored: the load user is back in Load Team 20', restored || teams.length === 50, `membersAdded in the restore log: ${restored}`);
    }
  },

  // ------------------------------------------------------------------ 5.3
  async 'platform-outage'() {
    needYes('scales the platform ECS service to 0 for 5 minutes in the middle of a run, then back to 1');
    const api = await mustLogin(USERS.load);
    const files = await uploadClean(api, 100, 'm5-outage');
    const t0 = new Date(Date.now() - 60_000).toISOString();
    const s = await submit(api, files, loadDestinations(20));
    expect('2,000 tasks accepted', s.reply.status === 201 && s.taskCount === 2000, `${s.reply.status}, ${s.taskCount} tasks`);
    let v = await job(api, s.jobId);
    while (v.counts.completed < 300) {
      await sleep(5000);
      v = await job(api, s.jobId);
    }
    const stopped = new Date();
    log(`stopping the platform with ${JSON.stringify(v.counts)}`);
    await setPlatformCount(0);
    await sleep(Math.max(0, 5 * 60_000 - (Date.now() - stopped.getTime())));
    const midway = await job(api, s.jobId);
    log(`platform back after ${((Date.now() - stopped.getTime()) / 60000).toFixed(1)} minutes; counts ${JSON.stringify(midway.counts)}`);
    await setPlatformCount(1);
    const done = await waitDone(api, s.jobId, 60 * 60_000);
    const end = new Date().toISOString();
    expect('all 2,000 deliveries completed', done.counts.completed === 2000 && done.counts.failed === 0, JSON.stringify(done.counts));
    const tasks = await tasksOf(api, s.jobId);
    expect('every task has one outcome (2,000 distinct)', new Set(tasks.map((t) => t.taskId)).size === 2000, `${tasks.length} rows`);
    const dlq = ['task-dlq', 'job-dlq'].map((q) => queueMaxVisible(q, t0, end));
    expect('Task DLQ and Job DLQ stayed empty (CloudWatch max visible over the run)', dlq.every((n) => n === 0), dlq.join(', '));
    const retries = await insights(`/aws/lambda/${NAME}-delivery`, "fields @message | filter @message like /temporary delivery error/ | stats count() as n", Date.parse(t0), Date.now());
    log(`temporary delivery errors logged by Delivery during the run: ${retries[0]?.n ?? 0}`);
    const states = alarmStates();
    log(`alarms: ${JSON.stringify(states)}`);
    expect('no alarm is in ALARM', Object.values(states).every((x) => x !== 'ALARM'), JSON.stringify(states));
  },

  // ------------------------------------------------------------------ 5.4
  async 'file-checks'() {
    needYes('pauses the Delivery trigger and deletes one staged object from the Object Store bucket');
    const api = await mustLogin(USERS.load);
    // (a) a file that was never uploaded
    const before = listOf((await api.get('/jobs?limit=100')).body).length;
    const ghost = await api.post('/uploads', { files: [{ name: 'never-uploaded.pdf', sizeBytes: 4096, contentType: 'application/pdf', sha256: sha256Hex(smallPdf('x')) }] });
    const ghostId = ghost.body.uploads[0].fileId as string;
    const refused = await submit(api, [{ fileId: ghostId, name: 'never-uploaded.pdf', sha256: sha256Hex(smallPdf('x')) }], loadDestinations(1));
    expect('a never-uploaded file gets 422 FILE_NOT_READY', refused.reply.status === 422 && refused.reply.body.error.code === 'FILE_NOT_READY', `${refused.reply.status} ${refused.reply.body?.error?.code}`);
    const after = listOf((await api.get('/jobs?limit=100')).body).length;
    expect('nothing was created', before === after, `${before} jobs before, ${after} after`);

    // (b) an object removed after submit
    const files = await uploadClean(api, 2, 'm5-removed-object');
    await setTrigger('delivery', false);
    let jobId: string | undefined;
    try {
      const s = await submit(api, files, loadDestinations(3));
      jobId = s.jobId;
      expect('6 tasks accepted', s.reply.status === 201 && s.taskCount === 6, `${s.reply.status}, ${s.taskCount}`);
      await sleep(20_000); // fan-out sends the six task messages
      const held = await job(api, jobId);
      expect('with Delivery paused no delivery has started (all 6 pending)', held.counts.pending === 6, JSON.stringify(held.counts));
      const userId = (await job(api, jobId)).submittedBy.userId;
      const victim = files[1]!;
      aws(['s3', 'rm', `s3://${objectBucket()}/staging/${userId}/${victim.fileId}`]);
      log(`deleted staging/${userId}/${victim.fileId}`);
    } finally {
      await setTrigger('delivery', true);
    }
    if (!jobId) throw new Error('The job was not submitted');
    const done = await waitDone(api, jobId, 15 * 60_000);
    const tasks = await tasksOf(api, jobId);
    const byFile = (id: string) => tasks.filter((t) => t.fileId === id);
    const bad = byFile(files[1]!.fileId);
    const ok = byFile(files[0]!.fileId);
    expect('the removed file: its 3 tasks failed FILE_NOT_UPLOADED', bad.length === 3 && bad.every((t) => t.status === 'failed' && t.failureCode === 'FILE_NOT_UPLOADED'), JSON.stringify(countBy(bad, (t) => `${t.status}/${t.failureCode}`)));
    expect('the other file: its 3 tasks completed', ok.length === 3 && ok.every((t) => t.status === 'completed'), JSON.stringify(countBy(ok, (t) => t.status)));
    expect('only those 3 failed', done.counts.failed === 3 && done.counts.completed === 3, JSON.stringify(done.counts));
  },

  // ------------------------------------------------------------------ 5.5
  async browse() {
    const api = await mustLogin(USERS.load);
    const t0 = Date.now() - 60_000;
    const first: number[] = [];
    const tree: number[] = [];
    let teams = 0;
    for (let i = 0; i < 100; i += 1) {
      const a = await api.get('/teams');
      first.push(a.ms);
      teams = listOf(a.body).length;
      const id = listOf(a.body)[0]?.id ?? listOf(a.body)[0]?.teamId;
      const b = await api.get(`/teams/${id}/binders`);
      tree.push(a.ms + b.ms);
      if (a.status !== 200 || b.status !== 200) throw new Error(`browse gave ${a.status} and ${b.status}`);
    }
    expect('the load user is in 50 teams', teams === 50, `${teams}`);
    log(`client side: GET /teams p50 ${percentile(first, 50).toFixed(0)} ms, p99 ${percentile(first, 99).toFixed(0)} ms; teams + first binders p99 ${percentile(tree, 99).toFixed(0)} ms`);
    // The first level of the tree is the team list (Blueprint: "time until the first level is usable").
    expect('first level (the 50 teams) usable under 1 s at p99, measured from this machine over the internet, 100 runs', percentile(first, 99) < 1000, `p50 ${percentile(first, 50).toFixed(0)} ms, p99 ${percentile(first, 99).toFixed(0)} ms, max ${Math.max(...first).toFixed(0)} ms`);
    // Not a requirement: two calls in a row over the internet, so the network round trip counts twice.
    log(`second level (teams, then the first team's binders, two calls in a row): p99 ${percentile(tree, 99).toFixed(0)} ms from this machine`);
    await sleep(90_000);
    for (const route of ['GET /teams', 'GET /teams/{teamId}/binders']) {
      const l = await gatewayLatency(route, t0, Date.now());
      expect(`server side ${route} p99 under 1 s`, l.p99 < 1000, `n ${l.count}, p50 ${l.p50} ms, p99 ${l.p99} ms, max ${l.max} ms`);
    }
  },

  // ------------------------------------------------------------------ 5.6
  async 'multipart-1gb'() {
    const api = await mustLogin(USERS.load);
    const size = LIMITS.maxFileBytes;
    const key = randomBytes(16);
    const partBytes = LIMITS.partBytes;
    const parts = Math.ceil(size / partBytes);
    log(`pass 1: hashing 1 GiB (${parts} parts of ${partBytes / 1024 ** 2} MiB)`);
    const whole = createHash('sha256');
    const partHashes: string[] = [];
    let cur = createHash('sha256');
    let inPart = 0;
    for (const block of randomBlocks(size, key)) {
      whole.update(block);
      cur.update(block);
      inPart += block.length;
      if (inPart === partBytes) {
        partHashes.push(cur.digest('hex'));
        cur = createHash('sha256');
        inPart = 0;
      }
    }
    if (inPart > 0) partHashes.push(cur.digest('hex'));
    const sha = whole.digest('hex');
    const name = `m5-one-gib-${randomUUID().slice(0, 8)}.pdf`;
    const started = await api.post('/uploads', { files: [{ name, sizeBytes: size, contentType: 'application/pdf', sha256: sha }] });
    const up = started.body.uploads[0];
    expect('the API chose a multipart upload', up.multipart === true && up.partCount === parts, `${up.partCount} parts of ${up.partSize} bytes`);
    const begin = await api.post(`/files/${up.fileId}/multipart-uploads`, { parts: partHashes.map((h, i) => ({ partNumber: i + 1, sha256: h })) });
    if (begin.status !== 201) throw new Error(`start gave ${begin.status} ${JSON.stringify(begin.body).slice(0, 300)}`);
    const urls = new Map<number, string>(begin.body.parts.map((p: { partNumber: number; url: string }) => [p.partNumber, p.url]));
    let signedAt = Date.now();
    const etags = new Map<number, string>();

    log('pass 2: uploading the parts, 4 at a time');
    const pending: Promise<void>[] = [];
    let n = 0;
    let consumed = 0;
    let acc: Buffer[] = [];
    let accBytes = 0;
    const send = async (item: { n: number; data: Buffer }): Promise<void> => {
      if (Date.now() - signedAt > 10 * 60_000) {
        signedAt = Date.now();
        const rest = partHashes.map((h, i) => ({ partNumber: i + 1, sha256: h })).filter((p) => !etags.has(p.partNumber));
        const fresh = await api.post(`/files/${up.fileId}/multipart-uploads/${begin.body.uploadId}/parts`, { parts: rest });
        for (const p of fresh.body.parts) urls.set(p.partNumber, p.url);
        log(`re-signed ${rest.length} parts`);
      }
      for (let attempt = 1; ; attempt += 1) {
        const res = await fetch(urls.get(item.n)!, { method: 'PUT', body: new Uint8Array(item.data), headers: { 'x-amz-checksum-sha256': Buffer.from(partHashes[item.n - 1]!, 'hex').toString('base64') } });
        if (res.ok) {
          etags.set(item.n, res.headers.get('etag')!);
          return;
        }
        if (attempt === 3) throw new Error(`part ${item.n} refused: ${res.status} ${(await res.text()).slice(0, 200)}`);
      }
    };
    const flush = async (): Promise<void> => {
      while (pending.length >= 4) await Promise.race(pending);
    };
    for (const block of randomBlocks(size, key)) {
      acc.push(block);
      accBytes += block.length;
      consumed += block.length;
      if (accBytes === partBytes || consumed === size) {
        n += 1;
        const item = { n, data: Buffer.concat(acc) };
        acc = [];
        accBytes = 0;
        const p = send(item).then(() => void pending.splice(pending.indexOf(p), 1));
        pending.push(p);
        await flush();
        if (n % 10 === 0) log(`${n}/${parts} parts sent`);
      }
    }
    await Promise.all(pending);
    const done = await api.post(`/files/${up.fileId}/multipart-uploads/${begin.body.uploadId}/complete`, { parts: [...etags].map(([partNumber, etag]) => ({ partNumber, etag })) });
    expect('multipart complete accepted', done.status === 200, `${done.status} ${JSON.stringify(done.body).slice(0, 200)}`);
    log('waiting for the ClamAV scan of 1 GiB');
    const t = Date.now();
    const states = await waitScanned(api, [up.fileId], 45 * 60_000);
    expect('scanned clean', states[0]?.scanStatus === 'clean', `${states[0]?.scanStatus} after ${((Date.now() - t) / 1000).toFixed(0)} s`);
    const row = sqlTask('docbeam-api', `SELECT size_bytes, checksum_sha256, s3_checksum FROM files WHERE id = '${up.fileId}'`)[0]!;
    expect('combined checksum stored from S3 (<base64>-<parts>)', String(row.s3_checksum).endsWith(`-${parts}`), String(row.s3_checksum));
    expect('stored size and SHA-256 are the local ones', Number(row.size_bytes) === size && row.checksum_sha256 === sha, `${row.size_bytes} bytes, ${row.checksum_sha256}`);

    const file: Uploaded = { fileId: up.fileId, name, sha256: sha };
    const s = await submit(api, [file], loadDestinations(1));
    expect('submitted', s.reply.status === 201, `${s.reply.status} ${JSON.stringify(s.reply.body).slice(0, 200)}`);
    const end = await waitDone(api, s.jobId, 30 * 60_000);
    expect('delivered', end.counts.completed === 1, JSON.stringify(end.counts));
    const taskId = (await tasksOf(api, s.jobId))[0]!.taskId;
    const doc = sqlTask('platform', `SELECT size_bytes, checksum_sha256 FROM documents WHERE source_task_id = '${taskId}'`)[0];
    expect('the platform document has the same SHA-256 and size', doc?.checksum_sha256 === sha && Number(doc?.size_bytes) === size, `${doc?.size_bytes} bytes, ${doc?.checksum_sha256} (local ${sha})`);
  },

  // ------------------------------------------------------------------ 5.7 and cross-team 5.12
  async 'team-viewer'() {
    const priya = await mustLogin(USERS.priya);
    const raj = await mustLogin(USERS.raj);
    const sam = await mustLogin(USERS.sam);
    const [both, onc] = await uploadClean(priya, 2, 'm5-viewer');
    const s = await submit(priya, [both!], [{ binderId: cardio.binders[0]!.id }, { binderId: oncology.binders[0]!.id }]);
    const s2 = await submit(priya, [onc!], [{ binderId: oncology.binders[0]!.id }]);
    expect('both jobs accepted', s.reply.status === 201 && s2.reply.status === 201, `${s.reply.status}, ${s2.reply.status}`);
    await waitDone(priya, s.jobId, 10 * 60_000);
    await waitDone(priya, s2.jobId, 10 * 60_000);
    await sleep(65_000); // DocBeam API caches a user's teams for 60 seconds

    const rajTasks = await tasksOf(raj, s.jobId);
    expect('Raj (Cardio only) sees only the Cardio delivery', rajTasks.length === 1 && rajTasks[0]!.destinationPath.startsWith('Cardio'), JSON.stringify(rajTasks.map((t) => t.destinationPath)));
    const rv = await job(raj, s.jobId);
    expect('Raj sees counts for his team only', rv.taskCount === 1, `taskCount ${rv.taskCount}`);
    const other = await raj.get(`/jobs/${s2.jobId}`);
    expect('Raj gets 404 for the Oncology-only job', other.status === 404, `${other.status}`);
    const a1 = await raj.post(`/files/${both!.fileId}/downloads`, { mode: 'preview' });
    expect('Raj may preview the file delivered to Cardio', a1.status === 201, `${a1.status}`);
    for (const mode of ['download', 'preview']) {
      const r = await raj.post(`/files/${onc!.fileId}/downloads`, { mode });
      expect(`Raj gets 404 for the Oncology-only file (${mode})`, r.status === 404 && !r.body.url, `${r.status} ${r.body?.error?.code}`);
    }
    const rajAudit = (await raj.get(`/audit?jobId=${s.jobId}`)).body.events as Array<{ action: string; teamId: string | null }>;
    const leak = rajAudit.filter((e) => e.teamId !== null && e.teamId !== cardio.id);
    expect('Raj sees audit events for his team and job-wide ones only', rajAudit.length > 0 && leak.length === 0, `${rajAudit.length} events, ${leak.length} for other teams`);
    const none = await sam.get(`/jobs/${s.jobId}`);
    const noAudit = (await sam.get(`/audit?jobId=${s.jobId}`)).body.events as unknown[];
    const samDl = await sam.post(`/files/${both!.fileId}/downloads`, {});
    expect('Sam (Neuro) gets 404 for the job, nothing in the audit, 404 for the file', none.status === 404 && noAudit.length === 0 && samDl.status === 404, `${none.status}, ${noAudit.length} events, ${samDl.status}`);
    const stranger = await new Api(appUrl()).post(`/files/${both!.fileId}/downloads`, {}, { token: null });
    expect('no token: 401', stranger.status === 401, `${stranger.status}`);
  },

  // ------------------------------------------------------------------ 5.9
  async eicar() {
    const priya = await mustLogin(USERS.priya);
    const [clean] = await uploadSmall(priya, [{ name: 'clean.pdf', bytes: smallPdf('clean') }]);
    const [bad] = await uploadSmall(priya, [{ name: 'eicar-test.pdf', bytes: EICAR }]);
    const states = await waitScanned(priya, [clean!.fileId, bad!.fileId], 10 * 60_000);
    const st = (id: string) => states.find((s) => s.fileId === id)?.scanStatus;
    expect('the EICAR file is marked infected', st(bad!.fileId) === 'infected', `${st(bad!.fileId)}`);
    expect('the clean file is marked clean', st(clean!.fileId) === 'clean', `${st(clean!.fileId)}`);
    const s = await submit(priya, [bad!], [{ binderId: cardio.binders[0]!.id }]);
    expect('submitting the EICAR file is refused', s.reply.status === 422 && s.reply.body.error.code === 'FILE_NOT_READY', `${s.reply.status} ${s.reply.body?.error?.code}`);
    const key = String(sqlTask('docbeam-api', `SELECT s3_key FROM files WHERE id = '${bad!.fileId}'`)[0]!.s3_key);
    const head = sh('aws', ['s3api', 'head-object', '--bucket', objectBucket(), '--key', key, '--region', REGION], { allowFail: true });
    expect('the object was deleted from the Object Store', head === '', head ? 'object still exists' : 'head-object found nothing');
    const dl = await priya.post(`/files/${bad!.fileId}/downloads`, {});
    expect('it can never be downloaded (404, even for its owner)', dl.status === 404, `${dl.status}`);
    const refused = (await priya.get('/audit?action=file.refused')).body.events as Array<{ detail?: { fileId?: string } }>;
    expect('a file.refused audit event exists', refused.some((e) => JSON.stringify(e).includes(bad!.fileId)), `${refused.length} file.refused events`);
  },

  // ------------------------------------------------------------------ 5.10
  async cancel() {
    const api = await mustLogin(USERS.load);
    const files = await uploadClean(api, 100, 'm5-cancel');
    const s = await submit(api, files, loadDestinations(20));
    expect('2,000 tasks accepted', s.reply.status === 201 && s.taskCount === 2000, `${s.reply.status}`);
    let v = await job(api, s.jobId);
    while (v.counts.completed < 100) {
      await sleep(2000);
      v = await job(api, s.jobId);
    }
    const c = await api.call('POST', `/jobs/${s.jobId}/cancel`); // no body
    expect('cancel accepted with 202 (a POST with no body)', c.status === 202, `${c.status} ${JSON.stringify(c.body)}`);
    const atCancel = await job(api, s.jobId);
    const done = await waitDone(api, s.jobId, 20 * 60_000);
    await sleep(60_000);
    const later = await job(api, s.jobId);
    expect('nothing is left pending or running', done.counts.pending === 0 && done.counts.in_progress === 0, JSON.stringify(done.counts));
    expect('the job reads cancelled', later.status === 'cancelled', later.status);
    expect('waiting deliveries show CANCELLED', done.counts.cancelled > 0 && done.counts.cancelled <= c.body.cancelled, `${done.counts.cancelled} cancelled of ${c.body.cancelled} reported`);
    expect('running deliveries finished (completed did not drop)', done.counts.completed >= atCancel.counts.completed, `${atCancel.counts.completed} at cancel, ${done.counts.completed} after`);
    expect('counts are final a minute later', JSON.stringify(later.counts) === JSON.stringify(done.counts), JSON.stringify(later.counts));
    expect('no real failures', later.counts.failed === 0, JSON.stringify(later.counts));
    const cancelled = await tasksOf(api, s.jobId, 'cancelled');
    expect('cancelled tasks carry the code CANCELLED', cancelled.every((t) => t.failureCode === 'CANCELLED'), `${cancelled.length} tasks`);
    await waitQuiet();
  },

  // ------------------------------------------------------------------ 5.11
  async auth() {
    const base = appUrl();
    const email = (tag: string) => `m5.${tag}.${Date.now()}@example.com`;
    const password = 'm5-correct-horse-battery';
    const api = new Api(base);
    const mk = async (tag: string) => {
      const e = email(tag);
      const r = await api.post('/auth/register', { email: e, password, name: `M5 ${tag}` }, { token: null });
      if (r.status !== 201) throw new Error(`register gave ${r.status}`);
      return e;
    };

    // A refresh token used twice ends the sign-in.
    const user = await mk('refresh');
    const first = await login(user, password);
    const cookieOf = (r: { headers: Headers }): string => (r.headers.getSetCookie() ?? []).map((c) => c.split(';')[0]).join('; ');
    expect('login sets a strict cookie', (first.reply.headers.getSetCookie() ?? []).some((c) => /Path=\/api\/auth/.test(c) && /HttpOnly/.test(c) && /Secure/.test(c) && /SameSite=Strict/.test(c)), 'Path=/api/auth; HttpOnly; Secure; SameSite=Strict');
    const r1 = await api.call('POST', '/auth/refresh', { cookie: first.cookie, token: null }); // no body
    expect('refresh with the cookie gives a new token', r1.status === 200 && !!r1.body.accessToken, `${r1.status}`);
    const second = cookieOf(r1);
    const replay = await api.call('POST', '/auth/refresh', { cookie: first.cookie, token: null });
    expect('the old cookie used again is refused', replay.status === 401, `${replay.status}`);
    const after = await api.call('POST', '/auth/refresh', { cookie: second, token: null });
    expect('and the newer cookie is refused too: the whole sign-in is cancelled', after.status === 401, `${after.status}`);

    // Five wrong passwords pause sign-in for 15 minutes.
    const victim = await mk('pause');
    const wrong: number[] = [];
    for (let i = 0; i < 5; i += 1) wrong.push((await api.post('/auth/login', { email: victim, password: `wrong-password-${i}` }, { token: null })).status);
    expect('five wrong passwords all get 401', wrong.every((s) => s === 401), wrong.join(', '));
    const paused = await api.post('/auth/login', { email: victim, password }, { token: null });
    const pausedAt = Date.now();
    expect('the right password is refused during the pause (same 401)', paused.status === 401, `${paused.status} ${paused.body?.error?.code}`);
    if (args.includes('--no-wait')) {
      log('skipping the 15-minute wait (--no-wait)');
      return;
    }
    log('waiting for the 15-minute pause to end');
    await sleep(15 * 60_000 + 15_000 - (Date.now() - pausedAt));
    const ok = await api.post('/auth/login', { email: victim, password }, { token: null });
    expect('after 15 minutes the right password works', ok.status === 200, `${ok.status}`);
  },

  // ------------------------------------------------------------------ 5.12
  async security() {
    const base = appUrl();
    const anon = new Api(base);
    const alb = tf('alb_arn_suffix');
    const apiId = new URL(tf('api_endpoint')).hostname.split('.')[0]!;
    const t0 = new Date();
    const routes: Array<[string, string]> = [
      ['GET', '/teams'], ['GET', '/jobs'], ['GET', '/audit'], ['GET', `/files?ids=${randomUUID()}`],
      ['POST', '/jobs'], ['POST', '/uploads'], ['POST', `/files/${randomUUID()}/downloads`], ['POST', `/jobs/${randomUUID()}/cancel`], ['POST', `/jobs/${randomUUID()}/retry`],
    ];
    const codes: string[] = [];
    for (let i = 0; i < 3; i += 1) for (const [m, p] of routes) codes.push(String((await anon.call(m, p, { token: null })).status));
    expect('no-token calls get 401 on every protected route', codes.every((c) => c === '401'), `${codes.length} calls: ${[...new Set(codes)].join(', ')}`);
    log('waiting 150 s, then reading the gateway and load balancer metrics');
    await sleep(150_000);
    const window = ['--start-time', t0.toISOString(), '--end-time', new Date().toISOString(), '--period', '60'];
    const metric = (ns: string, name: string, dim: string, stat: string): number =>
      awsJson<{ Datapoints: Array<Record<string, number>> }>(['cloudwatch', 'get-metric-statistics', '--namespace', ns, '--metric-name', name, '--dimensions', dim, ...window, '--statistics', stat]).Datapoints.reduce(
        (s, d) => s + (d[stat] ?? 0),
        0,
      );
    const rejected = metric('AWS/ApiGateway', '4xx', `Name=ApiId,Value=${apiId}`, 'Sum');
    const forwarded = metric('AWS/ApiGateway', 'IntegrationLatency', `Name=ApiId,Value=${apiId}`, 'SampleCount');
    expect('the gateway counted the rejected calls as 4xx (CloudWatch)', rejected >= codes.length, `${rejected} 4xx for ${codes.length} calls`);
    expect('and forwarded none of them to the backend (IntegrationLatency has no samples)', forwarded === 0, `${forwarded} samples`);
    const albCount = metric('AWS/ApplicationELB', 'RequestCount', `Name=LoadBalancer,Value=${alb}`, 'Sum');
    log(`load balancer RequestCount in the same window: ${albCount} (the services call each other for their service tokens; it does not grow with the ${codes.length} calls)`);

    // A POST with no body, with the same tools a client would use.
    const priya = await mustLogin(USERS.priya);
    const curlPost = (path: string, token: string): string =>
      sh('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '-X', 'POST', `${base}/api${path}`, '-H', `authorization: Bearer ${token}`]);
    const [fileA, fileB] = await uploadClean(priya, 2, 'm5-sec');
    const toCancel = await submit(priya, [fileA!], [{ binderId: cardio.binders[0]!.id }]);
    const cancelled = curlPost(`/jobs/${toCancel.jobId}/cancel`, priya.token);
    expect('curl -X POST (no body) cancel: 202', ['202', '409'].includes(cancelled), cancelled);
    expect('curl -X POST (no body) retry: not 415', ['409', '404'].includes(curlPost(`/jobs/${toCancel.jobId}/retry`, priya.token)), 'a refusal that is not 415');
    const kept = await submit(priya, [fileB!], [{ binderId: cardio.binders[0]!.id }]);
    const done = await waitDone(priya, kept.jobId, 10 * 60_000);
    const dl = curlPost(`/files/${fileB!.fileId}/downloads`, priya.token);
    expect('curl -X POST (no body) download link: 201', done.counts.completed === 1 && dl === '201', `${dl}, job ${JSON.stringify(done.counts)}`);

    // Cross-team and the link's life.
    const raj = await mustLogin(USERS.raj);
    const [onc] = await uploadClean(priya, 1, 'm5-sec-onc');
    const j2 = await submit(priya, [onc!], [{ binderId: oncology.binders[0]!.id }]);
    await waitDone(priya, j2.jobId, 10 * 60_000);
    await sleep(65_000);
    for (const mode of ['download', 'preview']) {
      const r = await raj.post(`/files/${onc!.fileId}/downloads`, { mode });
      expect(`cross-team ${mode} gets 404`, r.status === 404, `${r.status}`);
    }
    const link = await priya.post(`/files/${onc!.fileId}/downloads`, { mode: 'download' });
    const fresh = await fetch(link.body.url);
    expect('a fresh link works', fresh.status === 200, `${fresh.status}`);
    log('waiting 130 s for the 2-minute link to expire');
    await sleep(130_000);
    const old = await fetch(link.body.url);
    expect('the link is refused after 2 minutes', old.status === 403, `${old.status} ${(await old.text()).replace(/\s+/g, ' ').slice(0, 80)}`);
    const key = String(sqlTask('docbeam-api', `SELECT s3_key FROM files WHERE id = '${onc!.fileId}'`)[0]!.s3_key);
    const direct = await fetch(`https://${objectBucket()}.s3.${REGION}.amazonaws.com/${key}`);
    expect('the bucket without a link: 403', direct.status === 403, `${direct.status}`);
    log('gitleaks and the repository checks run with scripts/check-public.sh');
  },

  // ------------------------------------------------------------------ 5.13
  async 'lost-job'() {
    needYes('disables the Fan-out trigger, purges the Job Queue (only after checking nothing else is queued or running), then enables the trigger again');
    const api = await mustLogin(USERS.load);
    const open = async (): Promise<number> => {
      const jobs = listOf((await api.get('/jobs?limit=100')).body) as Array<{ counts?: { pending: number; in_progress: number } }>;
      return jobs.filter((j) => (j.counts?.pending ?? 0) + (j.counts?.in_progress ?? 0) > 0).length;
    };
    await waitQuiet(10);
    const depth = ['job', 'task'].map((q) => queueDepth(q));
    const busy = depth.some((d) => d.visible + d.inFlight + d.delayed > 0) || (await open()) > 0;
    expect('before the purge: no other job is queued or running', !busy, JSON.stringify({ queues: depth, openJobs: await open() }));
    if (busy) return;
    const files = await uploadClean(api, 2, 'm5-lost');
    await setTrigger('fanout', false);
    let committed: number | undefined;
    let jobId: string | undefined;
    try {
      const s = await submit(api, files, loadDestinations(2));
      committed = Date.now();
      jobId = s.jobId;
      expect('accepted', s.reply.status === 201 && s.taskCount === 4, `${s.reply.status}`);
      aws(['sqs', 'purge-queue', '--queue-url', queueUrl('job')]);
      log('Job Queue purged: the message is gone');
    } finally {
      await setTrigger('fanout', true);
    }
    if (!jobId || !committed) throw new Error('The job was not submitted');
    let started = 0;
    while (Date.now() - committed < 6 * 60_000) {
      const v = await job(api, jobId);
      if (v.counts.pending < 4) {
        started = Date.now();
        break;
      }
      await sleep(3000);
    }
    const secs = started ? (started - committed) / 1000 : Infinity;
    expect('the sweeper started fan-out within 3 minutes of the commit', secs <= 180, `${secs.toFixed(0)} s`);
    const done = await waitDone(api, jobId, 10 * 60_000);
    expect('all 4 deliveries completed', done.counts.completed === 4, JSON.stringify(done.counts));
  },

  // ------------------------------------------------------------------ 5.8
  async failover() {
    needYes('applies db_multi_az=true to the dev database (about +0.6 USD a day), reboots it with failover during a run, then applies db_multi_az=false');
    const id = tf('db_instance_id');
    const tag = process.env.IMAGE_TAG ?? '';
    const email = process.env.TF_VAR_alarm_email ?? sh('gh', ['variable', 'get', 'ALARM_EMAIL']);
    const apply = (multiAz: boolean): string =>
      sh('terraform', [`-chdir=${ROOT}infra/envs/dev`, 'apply', '-auto-approve', '-target=module.rds', `-var=db_multi_az=${multiAz}`, `-var=image_tag=${tag || 'bootstrap'}`, `-var=upload_events_image_tag=${tag || 'bootstrap'}`, `-var=alarm_email=${email}`]);
    const state = (): { multi: boolean; status: string } => {
      const o = awsJson<{ DBInstances: Array<{ MultiAZ: boolean; DBInstanceStatus: string }> }>(['rds', 'describe-db-instances', '--db-instance-identifier', id]).DBInstances[0]!;
      return { multi: o.MultiAZ, status: o.DBInstanceStatus };
    };
    const waitState = async (multi: boolean): Promise<void> => {
      for (let i = 0; i < 180; i += 1) {
        const s = state();
        if (s.multi === multi && s.status === 'available') return;
        await sleep(20_000);
      }
      throw new Error(`The database did not reach MultiAZ=${multi} and available`);
    };
    let switchedOn = false;
    try {
      try {
        apply(true);
      } catch (error) {
        const msg = (error as Error).message;
        expect('LIMIT: the Free plan refuses Multi-AZ (drill skipped)', false, msg.replace(/\s+/g, ' ').slice(0, 500));
        return;
      }
      switchedOn = true;
      log('waiting for the standby to be built (10 to 30 minutes)');
      await waitState(true);
      const api = await mustLogin(USERS.load);
      const files = await uploadClean(api, 100, 'm5-failover');
      const s = await submit(api, files, loadDestinations(20));
      expect('2,000 tasks accepted', s.reply.status === 201 && s.taskCount === 2000, `${s.reply.status}`);
      let v = await job(api, s.jobId);
      while (v.counts.completed < 300) {
        await sleep(3000);
        v = await job(api, s.jobId);
      }
      const t0 = new Date();
      log(`rebooting with failover at ${t0.toISOString()} with ${JSON.stringify(v.counts)}`);
      aws(['rds', 'reboot-db-instance', '--db-instance-identifier', id, '--force-failover', '--query', 'DBInstance.DBInstanceStatus', '--output', 'text']);
      // Sample the completed count every 5 s: a stall is a pause.
      let last = v.counts.completed;
      let lastMove = Date.now();
      let longest = 0;
      let samples = 0;
      let final = v;
      while (Date.now() - t0.getTime() < 40 * 60_000) {
        await sleep(5000);
        try {
          final = await job(api, s.jobId);
          samples += 1;
        } catch {
          continue; // the API cannot read during the switch; that is the pause
        }
        if (final.counts.completed > last) {
          longest = Math.max(longest, Date.now() - lastMove);
          last = final.counts.completed;
          lastMove = Date.now();
        }
        if (final.counts.pending === 0 && final.counts.in_progress === 0) break;
      }
      longest = Math.max(longest, 0);
      log(`longest stretch with no new completion: ${(longest / 1000).toFixed(0)} s (${samples} reads)`);
      const events = awsJson<{ Events: Array<{ Date: string; Message: string }> }>(['rds', 'describe-events', '--source-identifier', id, '--source-type', 'db-instance', '--start-time', t0.toISOString(), '--duration', '120']).Events;
      for (const e of events.reverse()) log(`RDS event ${e.Date}: ${e.Message}`);
      expect('all 2,000 deliveries completed after the failover', final.counts.completed === 2000 && final.counts.failed === 0, JSON.stringify(final.counts));
      expect('nothing lost: no failed task, no task left open', final.counts.pending + final.counts.in_progress + final.counts.failed === 0, JSON.stringify(final.counts));
      expect('RDS recorded a failover', events.some((e) => /failover/i.test(e.Message)), `${events.length} events`);
      const dlq = ['task-dlq', 'job-dlq'].map((q) => queueMaxVisible(q, t0.toISOString(), new Date().toISOString()));
      expect('Task and Job DLQs stayed empty', dlq.every((n) => n === 0), dlq.join(', '));
      log(`alarms: ${JSON.stringify(alarmStates())}`);
    } finally {
      if (switchedOn || state().multi) {
        log('switching the database back to Single-AZ');
        apply(false);
        await waitState(false);
        expect('dev database is Single-AZ again', !state().multi, 'MultiAZ=false');
      }
    }
  },

  // ------------------------------------------------------------------ demo helper, not a check
  // Uploads 100 small files and sends them to 20 folders as the load user: 2,000 deliveries to watch in the browser.
  async 'demo-send'() {
    const api = await mustLogin(USERS.load);
    const files = await uploadClean(api, 100, 'demo');
    const s = await submit(api, files, loadDestinations(20));
    if (s.reply.status !== 201) throw new Error(`POST /jobs gave ${s.reply.status} ${JSON.stringify(s.reply.body).slice(0, 300)}`);
    console.log(`Sent ${s.taskCount} deliveries as ${USERS.load}.\nWatch it live: ${appUrl()}/#/status/${s.jobId}`);
    process.exit(0);
  },

  // ------------------------------------------------------------------ helper, not a check
  async metrics() {
    const since = Date.parse(flag('since') ?? new Date(Date.now() - 3600_000).toISOString());
    const rows = await insights(
      '/docbeam/docbeam-dev/api-gateway',
      'fields latency | stats count() as n, pct(latency, 50) as p50, pct(latency, 99) as p99, max(latency) as max by routeKey | sort n desc',
      since,
      Date.now(),
    );
    for (const r of rows) console.log(`${(r.routeKey ?? '').padEnd(48)} n=${r.n} p50=${r.p50} p99=${r.p99} max=${r.max}`);
    process.exit(0);
  },
};

const name = process.argv[2] ?? '';
const fn = checks[name];
if (!fn) {
  console.error(`usage: node scripts/m5/checks.ts <${Object.keys(checks).join(' | ')}> [--yes]`);
  process.exit(64);
}
await fn();
finish(name);
