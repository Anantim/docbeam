// How long opening a distribution takes on deployed dev, step by step (D-F1-81, A12).
//   node --no-warnings scripts/perf/open-timing.ts [--runs=10] [--user=priya|raj]
// It signs in through the real API (the seed password is read the way the M5 checks read it and is never printed), opens the live
// connection, and times what the page does when a distribution opens: the WebSocket subscribe (with its team check), the
// detail call and the first page of deliveries. It prints the old order (subscribe, then detail, then deliveries) and the new one
// (detail and deliveries at once for a finished distribution, subscribe beside them) so the two can be compared.
import { appUrl, Api, login, tf, USERS } from '../m5/lib.ts';

const flag = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const runs = Number(flag('runs') ?? 10);
const who = (flag('user') ?? 'priya') as keyof typeof USERS;

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const fmt = (xs: number[]): string => `median ${median(xs).toFixed(0)} ms, worst ${Math.max(...xs).toFixed(0)} ms`;

/** Opens the live connection and waits until it is open. The time to open is returned too. */
async function connect(token: string): Promise<{ socket: WebSocket; openMs: number }> {
  const url = tf('ws_url');
  const t0 = performance.now();
  const socket = new WebSocket(`${url}?token=${encodeURIComponent(token)}`);
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error('The WebSocket did not open.'));
  });
  return { socket, openMs: performance.now() - t0 };
}

/** Subscribes and waits for the server's answer, as the page does before it fetches. */
async function subscribe(socket: WebSocket, jobId: string): Promise<number> {
  const t0 = performance.now();
  const answered = new Promise<void>((resolve) => {
    const on = (event: MessageEvent): void => {
      const message = JSON.parse(String(event.data)) as { type?: string; jobId?: string };
      if ((message.type === 'subscribed' || message.type === 'subscribe_error') && message.jobId === jobId) {
        socket.removeEventListener('message', on);
        resolve();
      }
    };
    socket.addEventListener('message', on);
  });
  socket.send(JSON.stringify({ action: 'subscribe', jobId }));
  await answered;
  return performance.now() - t0;
}

const timed = async <T>(fn: () => Promise<T>): Promise<[T, number]> => {
  const t0 = performance.now();
  const out = await fn();
  return [out, performance.now() - t0];
};

async function main(): Promise<void> {
  const { api } = await login(USERS[who]);
  if (!api.token) throw new Error('Sign-in failed.');
  const list = await api.get('/jobs?scope=all&limit=20');
  const jobs = (list.body as { items: Array<{ jobId: string; status: string; taskCount: number }> }).items.filter((j) => j.status === 'completed' || j.status === 'completed_with_errors');
  const job = jobs.sort((a, b) => b.taskCount - a.taskCount)[0];
  if (!job) throw new Error('No finished distribution to open.');
  console.log(`${appUrl()} as ${who}: opening ${job.jobId.slice(0, 8)} (${job.taskCount} deliveries), ${runs} runs`);

  const { socket, openMs } = await connect(api.token);
  console.log(`WebSocket connect: ${openMs.toFixed(0)} ms (once, when the page loads)`);

  const sub: number[] = [];
  const detail: number[] = [];
  const tasks: number[] = [];
  const before: number[] = [];
  const after: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    // The old order: subscribe, wait for the answer, then the detail, then the deliveries.
    const t0 = performance.now();
    sub.push(await subscribe(socket, job.jobId));
    const [, d] = await timed(() => api.get(`/jobs/${job.jobId}`));
    const [, t] = await timed(() => api.get(`/jobs/${job.jobId}/tasks?page=1&limit=100`));
    detail.push(d);
    tasks.push(t);
    before.push(performance.now() - t0);
    // The new order for a finished distribution: the detail and the deliveries together, the subscribe beside them.
    const t1 = performance.now();
    await Promise.all([subscribe(socket, job.jobId), api.get(`/jobs/${job.jobId}`), api.get(`/jobs/${job.jobId}/tasks?page=1&limit=100`)]);
    after.push(performance.now() - t1);
  }
  console.log(`subscribe (with the team check): ${fmt(sub)}`);
  console.log(`GET /jobs/{id}: ${fmt(detail)}`);
  console.log(`GET /jobs/{id}/tasks (first page): ${fmt(tasks)}`);
  console.log(`BEFORE, one after the other: ${fmt(before)}`);
  console.log(`AFTER, together: ${fmt(after)}`);
  socket.close();
  void Api;
}

await main();
