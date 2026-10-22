import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { ON_DEV, PRIYA, RAJ, SAM, pdf, signIn } from './helpers.js';

// The checks for the reviewer on a fresh dev that holds the demo history of `scripts/demo/seed-history.ts` (D-F1-81). They read the
// history and add nothing that stays: no distribution is sent, so the history is exactly what the reviewer will see.
// Run: npm run test:e2e:dev -- review-dev (DEV_APP_URL and DEV_SEED_PASSWORD set).

test.skip(!ON_DEV, 'dev only');

const ANANTIM = 'anantim.patil@example.com';
const rows = (page: Page) => page.locator('.dist-table tbody tr:not(.sk-row)');
const toStatus = async (page: Page) => {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Status' }).click();
  await expect(rows(page).first()).toBeVisible({ timeout: 60_000 });
};
const TEST_LOOKING = /(^|[\s_-])(test|qa|e2e|dev|resume|slow|f1dev|demo-\d)|[0-9a-f]{6}\.pdf/i;

test('the history shows for each person as it should, and no file name looks like a test', async ({ browser }) => {
  const seen: Record<string, { rows: number; text: string }> = {};
  for (const who of [PRIYA, ANANTIM, RAJ, SAM]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, who);
    await toStatus(page);
    seen[who] = { rows: await rows(page).count(), text: await page.locator('.dist-table').innerText() };
    expect(seen[who].text, `${who}: no test-looking name`).not.toMatch(TEST_LOOKING);
    await context.close();
  }
  expect(seen[PRIYA]?.rows).toBe(5); // her two, and the three of Anantim and Raj that reach Cardio or Oncology
  expect(seen[ANANTIM]?.rows).toBe(5); // his two, and the three that reach his teams
  expect(seen[RAJ]?.rows).toBe(4); // his own, Priya's first (Cardio), and Anantim's two (Cardio)
  expect(seen[SAM]?.rows).toBe(2); // the two of Anantim's with a Neuro folder
  expect(seen[ANANTIM]?.text).toContain('Cancelled');
  expect(seen[PRIYA]?.text).toContain('Informed consent form v2.docx'); // the first of her five files by name (the rest are in the "+4")
});

test('a team member sees "Showing deliveries to" with the teams of his part, and the sender sees no note', async ({ browser }) => {
  const sam = await browser.newContext();
  const page = await sam.newPage();
  await signIn(page, SAM);
  await toStatus(page);
  await rows(page).first().locator('.dist-id').click();
  await expect(page.locator('.panel-note-label')).toHaveText('Showing deliveries to');
  await expect(page.locator('.panel-note .team-chips')).toContainText('Neuro');
  await sam.close();

  const anantim = await browser.newContext();
  const own = await anantim.newPage();
  await signIn(own, ANANTIM);
  await toStatus(own);
  await rows(own).first().locator('.dist-id').click();
  await expect(own.locator('.panel-head')).toBeVisible();
  await expect(own.locator('.panel-note-label')).toHaveCount(0);
  await anantim.close();
});

test('the tab title, a team Sam is not in, and a file added twice', async ({ page }) => {
  await signIn(page, SAM);
  await expect(page).toHaveTitle('Distribute · DocBeam');
  await toStatus(page);
  await expect(page).toHaveTitle('Status · DocBeam');
  await page.goto(`/#/status?team=${randomUUID()}`);
  await expect(page.getByRole('heading', { name: 'Distributions' })).toBeVisible();
  await expect(page).toHaveURL(/#\/status$/);
  await expect(page.getByText('The team must be one of your teams.')).toHaveCount(0);
  await expect(rows(page).first()).toBeVisible();

  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Distribute' }).click();
  const file = pdf('review-copy.pdf');
  await page.getByLabel('Choose files').setInputFiles([
    { name: 'Visit schedule.pdf', mimeType: 'application/pdf', buffer: file.buffer },
    { name: 'Visit schedule (copy).pdf', mimeType: 'application/pdf', buffer: file.buffer },
  ]);
  const note = page.locator('.notice').filter({ hasText: 'not added' });
  await expect(note.locator('.notice-detail')).toHaveText('Same contents as Visit schedule.pdf, already in the list.', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Clear' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear' }).click();
});

test('a PDF preview link carries the file name, in the key and in the answer', async ({ page }) => {
  await signIn(page, PRIYA);
  await toStatus(page);
  await page.locator('.dist-id').first().click();
  const row = page.locator('.ttable [role="row"]').filter({ hasText: '.pdf' }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  const preview = row.getByRole('button', { name: /^Preview / });
  const [response] = await Promise.all([page.waitForResponse((r) => /\/files\/[0-9a-f-]+\/downloads$/.test(r.url())), preview.click()]);
  const link = ((await response.json()) as { url: string }).url;
  const url = new URL(link);
  expect(decodeURIComponent(url.pathname)).toMatch(/\/staging\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[^/]+\.pdf$/); // the key ends in the file's name
  expect(url.searchParams.get('response-content-disposition')).toMatch(/^inline; filename="/);
});
