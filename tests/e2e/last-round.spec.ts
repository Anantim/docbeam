import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { clearPage, PRIYA, SAM, pdf, signIn } from './helpers.js';

// The last round (D-F1-81) in a real browser: copies, the address, titles, the offline note and toasts.

const box = (page: Page) => page.locator('.notice').filter({ hasText: 'not added' });

test('the same file twice goes in the "not added" note, a renamed copy is taken out after it is read, and the same name with other contents is kept', async ({ page }) => {
  await signIn(page, PRIYA);
  const dir = mkdtempSync(join(tmpdir(), 'docbeam-dup-'));
  const original = join(dir, `Lab certification ${randomUUID().slice(0, 6)}.pdf`);
  writeFileSync(original, pdf('x').buffer);

  await page.getByLabel('Choose files').setInputFiles([original]);
  await expect(page.getByText('Ready', { exact: true })).toHaveCount(1, { timeout: 90_000 });
  await page.getByLabel('Choose files').setInputFiles([original]); // the same file (same name, size and time) in a later pick
  await expect(box(page).getByText('1 file not added.')).toBeVisible();
  await expect(box(page).locator('.notice-detail')).toHaveText('This file is already in the list.');
  await expect(page.locator('.frow[data-id]')).toHaveCount(1);

  // A renamed copy: other name, same contents. It is out after it is read, and the note names the file it copies.
  const bytes = pdf('copy').buffer;
  const first = `Site log ${randomUUID().slice(0, 6)}.pdf`;
  const copy = `Site log copy ${randomUUID().slice(0, 6)}.pdf`;
  await page.getByLabel('Choose files').setInputFiles([
    { name: first, mimeType: 'application/pdf', buffer: bytes },
    { name: copy, mimeType: 'application/pdf', buffer: bytes },
  ]);
  await expect(box(page).getByText('2 files not added.')).toBeVisible({ timeout: 60_000 });
  await expect(box(page).locator('.notice-list li').last()).toContainText(`${copy} Same contents as ${first}, already in the list.`);
  await expect(page.locator('.frow[data-id]', { hasText: copy })).toHaveCount(0);
  await expect(page.locator('.frow[data-id]', { hasText: first })).toHaveCount(1);

  // The same name with different contents is allowed.
  const same = `Consent ${randomUUID().slice(0, 6)}.pdf`;
  await page.getByLabel('Choose files').setInputFiles([
    { name: same, mimeType: 'application/pdf', buffer: pdf('one').buffer },
    // Other contents, and another size: the browser tells files of one name apart by size and time, and these two are picked at the same moment.
    { name: same, mimeType: 'application/pdf', buffer: Buffer.concat([pdf('two').buffer, Buffer.from('\n% a few more bytes\n')]) },
  ]);
  await expect(page.locator('.frow[data-id]', { hasText: same })).toHaveCount(2, { timeout: 30_000 });
  await clearPage(page);
});

test('a name longer than 255 characters is not added, with its reason', async ({ page }) => {
  await signIn(page, PRIYA);
  const name = `${'long-name-'.repeat(26)}.pdf`;
  expect(name.length).toBeGreaterThan(255);
  await page.getByLabel('Choose files').setInputFiles([{ name, mimeType: 'application/pdf', buffer: pdf('x').buffer }]);
  await expect(box(page).locator('.notice-detail')).toHaveText('The name is longer than 255 characters.');
  await expect(page.locator('.frow[data-id]')).toHaveCount(0);
});

test('the tab title follows the page', async ({ page }) => {
  await signIn(page, PRIYA);
  await expect(page).toHaveTitle('Distribute · DocBeam');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Status' }).click();
  await expect(page).toHaveTitle('Status · DocBeam');
  await page.locator('.dist-id').first().click();
  await expect(page).toHaveTitle(/^[0-9a-f]{8} · Status · DocBeam$/);
});

test.describe('an address with filters that do not apply', () => {
  test('a team Sam is not in, an unknown sender, and values the page does not know open the normal list and leave the address', async ({ page }) => {
    await signIn(page, SAM);
    const stranger = randomUUID();
    await page.goto(`/#/status?team=${stranger}`);
    await expect(page.getByRole('heading', { name: 'Distributions' })).toBeVisible();
    await expect(page).toHaveURL(/#\/status$/); // dropped from the address, replacing it
    await expect(page.getByText('The team must be one of your teams.')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Team/ })).toHaveCount(0); // Sam is in one team
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);

    await page.goto(`/#/status?sender=${stranger}`);
    await expect(page).toHaveURL(/#\/status$/);
    await expect(page.getByText(/Sender: Someone/)).toHaveCount(0);

    await page.goto('/#/status?status=banana&sent=forever');
    await expect(page).toHaveURL(/#\/status$/);
    await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(0);
  });

  test('"Sender: Me" is the person\'s id in the address, and a colleague who opens the link sees the name', async ({ page, browser }) => {
    await signIn(page, PRIYA);
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Status' }).click();
    await page.getByRole('button', { name: 'Sender' }).click();
    await page.getByRole('menuitemradio', { name: 'Me', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sender: Me' })).toBeVisible();
    const link = page.url();
    expect(link).toMatch(/sender=[0-9a-f-]{36}/);
    expect(link).not.toContain('sender=me');

    const other = await browser.newContext();
    const colleague = await other.newPage();
    await signIn(colleague, 'raj.mehta@example.com');
    await colleague.goto(link);
    await expect(colleague.getByRole('button', { name: 'Sender: Priya Shah' })).toBeVisible({ timeout: 30_000 });
    await other.close();
  });
});

test('offline: one info note shows under the header and goes when the browser is back', async ({ page, context }) => {
  await signIn(page, PRIYA);
  await context.setOffline(true);
  await expect(page.getByText("You're offline. Uploads and live updates carry on when you're back.")).toBeVisible();
  await expect(page.locator('.offline-note .notice.info')).toHaveCount(1);
  await context.setOffline(false);
  await expect(page.getByText(/You're offline/)).toHaveCount(0);
});
