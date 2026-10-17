import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, mkdtempSync, openSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { CARDIO_IRB, ON_DEV, PRIYA, readCounts, send, signIn, tick } from './helpers.js';

// M5 manual checks (5.14), run in a real browser against dev (npm run test:e2e:dev): a slow connection, a multipart
// upload that loses its network and carries on, the WebSocket coming back, and PNG and JPG previews.
// The evidence (screenshots) goes to docs/testing/m5-evidence/.
test.skip(!ON_DEV, 'runs only against dev: set DEV_APP_URL and use npm run test:e2e:dev');
test.describe.configure({ mode: 'serial' });

const PW = process.env.DEV_SEED_PASSWORD as string;
const LOAD = 'load.user@example.com';
const evidence = (name: string): string => `docs/testing/m5-evidence/${name}.png`;

async function token(request: APIRequestContext, email: string): Promise<string> {
  const res = await request.post('/api/auth/login', { data: { email, password: PW } });
  expect(res.status()).toBe(200);
  return (await res.json()).accessToken as string;
}

interface Limit {
  bytesPerSecond: number;
  latencyMs: number;
}

const sessions = new WeakMap<Page, Awaited<ReturnType<ReturnType<Page['context']>['newCDPSession']>>>();

/**
 * The page's network, the way the DevTools Network tab sets it: offline or not, and a speed limit in bytes per second.
 * One DevTools session per page, and every call sets the whole state, so "offline" and "slow" never fight each other
 * (`context.setOffline` did not stop a transfer that was already running here).
 */
async function network(page: Page, state: { offline?: boolean; limit?: Limit | null }): Promise<void> {
  let cdp = sessions.get(page);
  if (!cdp) {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    sessions.set(page, cdp);
  }
  await cdp.send('Network.emulateNetworkConditions', {
    offline: state.offline ?? false,
    latency: state.limit?.latencyMs ?? 0,
    downloadThroughput: state.limit?.bytesPerSecond ?? -1,
    uploadThroughput: state.limit?.bytesPerSecond ?? -1,
  });
}

const SLOW_UPLOAD: Limit = { bytesPerSecond: 1024 * 1024, latencyMs: 50 };

/** Slows the network the way DevTools "Slow 3G" does. `null` removes the limit. */
const throttle = (page: Page, limit: Limit | null): Promise<void> => network(page, { limit });

/** A PDF of about `bytes` bytes with unique content. */
const bigPdf = (name: string, bytes: number) => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.concat([Buffer.from(`%PDF-1.7\n% ${randomUUID()}\n`), Buffer.alloc(bytes, 0x20)]),
});

const rowOf = (page: Page, name: string) => page.locator('.frow', { hasText: name });
const taskRow = (page: Page, name: string) => page.locator('.ttable .trow', { hasText: name });

test('slow connection: a file uploads over a slow link, is checked, sent and delivered', async ({ page }) => {
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Distribute' }).click();
  await throttle(page, { bytesPerSecond: 64 * 1024, latencyMs: 400 }); // about 0.5 Mbit/s, like Slow 3G
  const file = bigPdf(`slow-${randomUUID().slice(0, 6)}.pdf`, 2 * 1024 * 1024);
  const started = Date.now();
  await page.getByLabel('Choose files').setInputFiles([file]);
  await expect(rowOf(page, file.name).getByText(/^Uploading/)).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: evidence('slow-connection-uploading') });
  await expect(rowOf(page, file.name).getByText('Verified', { exact: true })).toBeVisible({ timeout: 280_000 });
  const seconds = (Date.now() - started) / 1000;
  await page.screenshot({ path: evidence('slow-connection-verified') });
  expect(seconds, 'the throttle really slowed the upload').toBeGreaterThan(15);
  console.log(`slow connection: 2 MiB uploaded and verified in ${seconds.toFixed(0)} s at about 64 KiB/s`);

  await throttle(page, null);
  await tick(page, CARDIO_IRB);
  await send(page);
  await expect.poll(() => readCounts(page), { timeout: 120_000 }).toEqual([1, 0, 0, 0]);
  await expect(taskRow(page, file.name)).toContainText('Delivered');
  await page.screenshot({ path: evidence('slow-connection-delivered') });
});

test('multipart resume: the network drops mid-upload and the same upload carries on from the stored parts', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'm5-'));
  const path = join(dir, `resume-${randomUUID().slice(0, 6)}.pdf`);
  const fd = openSync(path, 'w');
  writeSync(fd, Buffer.from(`%PDF-1.7\n% ${randomUUID()}\n`));
  const chunk = Buffer.alloc(1024 * 1024, 0x20);
  for (let i = 0; i < 120; i += 1) writeSync(fd, chunk); // 120 MiB: above the 100 MiB multipart threshold
  closeSync(fd);
  const name = path.split('/').pop() as string;

  try {
    await signIn(page, PRIYA);
    await page.getByRole('button', { name: 'Distribute' }).click();
    await throttle(page, SLOW_UPLOAD); // 1 MiB/s, so the 8 parts of 16 MiB take about two minutes
    await page.evaluate('window.__kept = 1'); // a reload would remove this marker: it proves it is the same session
    await page.getByLabel('Choose files').setInputFiles(path);

    const progress = rowOf(page, name).getByText(/Uploading parts \d+\/\d+/);
    await expect(progress).toBeVisible({ timeout: 120_000 });
    await expect(rowOf(page, name).getByText(/Uploading parts [2-9]\/\d+/)).toBeVisible({ timeout: 120_000 });
    const before = Number(/parts (\d+)\//.exec((await progress.textContent()) ?? '')?.[1]);
    await page.screenshot({ path: evidence('multipart-before-drop') });

    await network(page, { offline: true, limit: SLOW_UPLOAD });
    await expect(rowOf(page, name).getByText('Upload interrupted')).toBeVisible({ timeout: 180_000 });
    await page.screenshot({ path: evidence('multipart-interrupted') });
    await page.waitForTimeout(20_000);
    await network(page, { limit: SLOW_UPLOAD });

    await rowOf(page, name).getByRole('button', { name: `Retry upload of ${name}` }).click();
    await expect(rowOf(page, name).getByText(/Uploading parts \d+\/\d+|Checking for malware|Verified/)).toBeVisible({ timeout: 60_000 });
    const resumed = await rowOf(page, name).textContent();
    const after = Number(/parts (\d+)\//.exec(resumed ?? '')?.[1] ?? before);
    console.log(`multipart resume: ${before} parts stored before the drop, ${after} shown right after Retry`);
    expect(after, 'Retry carried on from the stored parts instead of starting again').toBeGreaterThanOrEqual(Math.max(1, before - 1));
    await page.screenshot({ path: evidence('multipart-resumed') });

    await throttle(page, null);
    await expect(rowOf(page, name).getByText('Verified', { exact: true })).toBeVisible({ timeout: 600_000 });
    expect(await page.evaluate('window.__kept === 1'), 'same session: the page was not reloaded').toBe(true);
    await page.screenshot({ path: evidence('multipart-verified') });

    await tick(page, CARDIO_IRB);
    await send(page);
    await expect.poll(() => readCounts(page), { timeout: 300_000 }).toEqual([1, 0, 0, 0]);
    await page.screenshot({ path: evidence('multipart-delivered') });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PNG and JPG previews show the image in the page', async ({ page }) => {
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Distribute' }).click();
  const id = randomUUID().slice(0, 6);
  // Real images, drawn by the browser itself, so nothing here is a guess at the file format.
  const make = async (type: 'image/png' | 'image/jpeg'): Promise<Buffer> => {
    const b64 = (await page.evaluate(`(async () => {
      const c = document.createElement('canvas');
      c.width = 240;
      c.height = 160;
      const g = c.getContext('2d');
      g.fillStyle = '#2563eb';
      g.fillRect(0, 0, 240, 160);
      g.fillStyle = '#fff';
      g.font = '28px sans-serif';
      g.fillText('DocBeam M5', 30, 90);
      const blob = await new Promise((r) => c.toBlob(r, ${JSON.stringify(type)}));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (const x of bytes) s += String.fromCharCode(x);
      return btoa(s);
    })()`)) as string;
    return Buffer.from(b64, 'base64');
  };
  const files = [
    { name: `m5-${id}.png`, mimeType: 'image/png', buffer: await make('image/png') },
    { name: `m5-${id}.jpg`, mimeType: 'image/jpeg', buffer: await make('image/jpeg') },
  ];
  await page.getByLabel('Choose files').setInputFiles(files);
  await expect(page.getByText('Verified', { exact: true })).toHaveCount(2, { timeout: 120_000 });
  await tick(page, CARDIO_IRB);
  await send(page);
  await expect.poll(() => readCounts(page), { timeout: 120_000 }).toEqual([2, 0, 0, 0]);

  for (const f of files) {
    await taskRow(page, f.name).getByRole('button', { name: `Preview ${f.name}` }).click();
    const dialog = page.getByRole('dialog', { name: 'File preview' });
    await expect(dialog).toBeVisible();
    const img = dialog.getByRole('img', { name: f.name });
    await expect(img).toBeVisible({ timeout: 30_000 });
    const size = await img.evaluate('(el) => [el.naturalWidth, el.naturalHeight]');
    expect(size, `${f.name} decoded by the browser`).toEqual([240, 160]);
    await page.screenshot({ path: evidence(`preview-${f.name.endsWith('.png') ? 'png' : 'jpg'}`) });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  }
});

test('WebSocket reconnect: the page loses its connection for 30 s mid-run and catches up', async ({ page, request }) => {
  // A 2,000-delivery run as the load user, started the way the demo does (scripts/demo-send.sh). 1 MiB files, so the
  // run lasts minutes: with 4 KB files all 2,000 deliveries finish in 20 seconds, before the page can be taken offline.
  const out = execFileSync('scripts/demo-send.sh', ['--size=1048576'], { encoding: 'utf8', timeout: 900_000 });
  const jobId = /#\/status\/([0-9a-f-]{36})/.exec(out)?.[1] as string;
  expect(jobId).toBeTruthy();
  const api = { authorization: `Bearer ${await token(request, LOAD)}` };
  const apiDelivered = async (): Promise<number> => ((await (await request.get(`/api/jobs/${jobId}`, { headers: api })).json()).counts.completed as number);

  await signIn(page, LOAD);
  await page.goto(`/#/status/${jobId}`);
  await page.evaluate('window.__kept = 1');
  await expect.poll(async () => (await readCounts(page))[0], { timeout: 180_000 }).toBeGreaterThan(50);
  await page.screenshot({ path: evidence('websocket-before-drop') });

  await network(page, { offline: true });
  await page.waitForTimeout(3000);
  const frozen = (await readCounts(page))[0] as number;
  await page.waitForTimeout(27_000);
  const frozenLater = (await readCounts(page))[0] as number;
  const serverNow = await apiDelivered();
  console.log(`websocket: page showed ${frozen} then ${frozenLater} delivered while offline; the server had ${serverNow}`);
  expect(serverNow, 'the run kept going while the page was offline').toBeGreaterThan(frozen);
  expect(frozenLater, 'no live updates reach the page while it is offline').toBe(frozen);
  await page.screenshot({ path: evidence('websocket-offline') });

  await network(page, {});
  // The page connects again, subscribes again and fetches once, so it is at least as far as the server was.
  await expect.poll(async () => (await readCounts(page))[0], { timeout: 90_000 }).toBeGreaterThanOrEqual(serverNow);
  const caught = (await readCounts(page))[0] as number;
  expect(await page.evaluate('window.__kept === 1'), 'caught up without a reload').toBe(true);
  // And it keeps moving live afterwards.
  await expect.poll(async () => (await readCounts(page))[0], { timeout: 90_000 }).toBeGreaterThan(caught);
  console.log(`websocket: back online, page caught up to ${caught} (server had ${serverNow}) and kept moving`);
  await page.screenshot({ path: evidence('websocket-caught-up') });
});
