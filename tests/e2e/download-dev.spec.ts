import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { CARDIO_IRB, jobIdOf, ON_DEV, ONC_ETHICS, openHistory, PRIYA, RAJ, readCounts, SAM, send, signIn, tick } from './helpers.js';

// M4 browser checks on dev (npm run test:e2e:dev). People and files: Priya (Cardio, Oncology) sends; Raj (Cardio);
// Sam (neither). download.spec.ts runs on dev too (previews and download of the three file types).
test.skip(!ON_DEV, 'runs only against dev: set DEV_APP_URL and use npm run test:e2e:dev');
test.describe.configure({ mode: 'serial' });

const PW = process.env.DEV_SEED_PASSWORD as string;
const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.7\n${randomUUID()}\n%%EOF\n`) });
const id = randomUUID().slice(0, 6);
const BOTH = `both-${id}.pdf`; // delivered to Cardio and Oncology
const ONC = `onc-only-${id}.pdf`; // delivered to Oncology only

const evidence = (name: string) => `docs/testing/m4-evidence/${name}.png`;

async function token(request: APIRequestContext, email: string): Promise<string> {
  const res = await request.post('/api/auth/login', { data: { email, password: PW } });
  expect(res.status()).toBe(200);
  return (await res.json()).accessToken as string;
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function sendOne(page: Page, name: string, folders: string[]): Promise<string> {
  await page.getByRole('button', { name: 'Distribute' }).click();
  await page.getByLabel('Choose files').setInputFiles([pdf(name)]);
  await expect(page.getByText('Ready', { exact: true })).toHaveCount(1, { timeout: 120_000 });
  for (const f of folders) await tick(page, f);
  const job = await send(page);
  await expect.poll(() => readCounts(page), { timeout: 120_000 }).toEqual([folders.length, 0, 0, 0]);
  return job;
}

const rowOf = (page: Page, name: string) => page.locator('.ttable .trow', { hasText: name });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'File preview' });

let jobBoth = '';
let jobOnc = '';
let fileOnc = '';

test('Priya sends a PDF to Cardio and Oncology, and another to Oncology only', async ({ page, request }) => {
  await signIn(page, PRIYA);
  jobBoth = await sendOne(page, BOTH, [CARDIO_IRB, ONC_ETHICS]);
  jobOnc = await sendOne(page, ONC, [ONC_ETHICS]);
  const tasks = await request.get(`/api/jobs/${jobOnc}/tasks`, { headers: auth(await token(request, PRIYA)) });
  fileOnc = (await tasks.json()).tasks[0].fileId;
  expect(jobIdOf(page)).toBe(jobOnc);
});

test('Raj previews a Cardio file; the Oncology-only file and its distribution are not found', async ({ browser, request }) => {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, RAJ);
  await page.goto(`/#/status/${jobBoth}`);
  await expect(rowOf(page, BOTH)).toHaveCount(1); // only the Cardio delivery
  await rowOf(page, BOTH).getByRole('button', { name: `Preview ${BOTH}` }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(page.getByTitle(`Preview of ${BOTH}`)).toBeVisible();
  await page.screenshot({ path: evidence('raj-preview-cardio-file') });
  await page.keyboard.press('Escape');

  await page.goto(`/#/status/${jobOnc}`);
  await expect(page.getByText('Distribution not found')).toBeVisible();
  await page.screenshot({ path: evidence('raj-oncology-only-not-found') });
  const denied = await request.post(`/api/files/${fileOnc}/downloads`, { headers: auth(await token(request, RAJ)), data: { mode: 'download' } });
  expect(denied.status()).toBe(404);
});

test('Sam, in neither team, gets not found for the distribution and 404 for its file', async ({ browser, request }) => {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, SAM);
  await page.goto(`/#/status/${jobBoth}`);
  await expect(page.getByText('Distribution not found')).toBeVisible();
  await page.screenshot({ path: evidence('sam-not-found') });
  const tasks = await request.get(`/api/jobs/${jobBoth}/tasks`, { headers: auth(await token(request, PRIYA)) });
  const file = (await tasks.json()).tasks[0].fileId as string;
  const denied = await request.post(`/api/files/${file}/downloads`, { headers: auth(await token(request, SAM)), data: {} });
  expect(denied.status()).toBe(404);
});

test('Priya previews and downloads; her History shows every link event, Raj\'s only his own', async ({ page, browser, request }) => {
  await signIn(page, PRIYA);
  await page.goto(`/#/status/${jobBoth}`);
  await rowOf(page, BOTH).first().getByRole('button', { name: `Preview ${BOTH}` }).click();
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  const saved = page.waitForEvent('download');
  await rowOf(page, BOTH).first().getByRole('button', { name: `Download ${BOTH}` }).click();
  expect((await saved).suggestedFilename()).toBe(BOTH);

  await openHistory(page);
  await expect(page.getByText('Preview link issued')).toHaveCount(2); // Raj's and hers
  await expect(page.getByText('Download link issued')).toHaveCount(1);
  await page.screenshot({ path: evidence('priya-audit-tab-all-link-events') });

  const priyaView = await request.get(`/api/audit?action=download.issued&jobId=${jobBoth}`, { headers: auth(await token(request, PRIYA)) });
  expect(((await priyaView.json()).events as unknown[]).length).toBe(3);
  const rajView = await request.get(`/api/audit?action=download.issued&jobId=${jobBoth}`, { headers: auth(await token(request, RAJ)) });
  const rajEvents = (await rajView.json()).events as Array<{ detail: { mode: string; actorName: string }; teamId: string | null }>;
  expect(rajEvents).toHaveLength(1);
  expect(rajEvents[0]?.detail.mode).toBe('preview');
  expect(rajEvents[0]?.teamId).not.toBeNull();

  const rajPage = await (await browser.newContext()).newPage();
  await signIn(rajPage, RAJ);
  await rajPage.goto(`/#/status/${jobBoth}`);
  await openHistory(rajPage);
  await expect(rajPage.getByText('Preview link issued')).toHaveCount(1);
  await expect(rajPage.getByText('Download link issued')).toHaveCount(0);
  await rajPage.screenshot({ path: evidence('raj-audit-tab-only-his-own') });
});

test('a download bar runs past 2:00 and shows the expired text', async ({ page }) => {
  await signIn(page, PRIYA);
  await page.goto(`/#/status/${jobBoth}`);
  await rowOf(page, BOTH).first().getByRole('button', { name: `Download ${BOTH}` }).click();
  const bar = page.getByRole('status').filter({ hasText: BOTH });
  await expect(bar).toContainText('is downloading. Its link works for this one file for another');
  await page.screenshot({ path: evidence('download-bar-counting-down') });
  await expect(bar).toContainText(`The link for ${BOTH} has expired and storage now refuses it. Click Download for a fresh one.`, { timeout: 150_000 });
  await page.screenshot({ path: evidence('download-bar-expired') });
});
