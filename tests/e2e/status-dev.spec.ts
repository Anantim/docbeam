import { expect, test } from '@playwright/test';
import { addPdfs, CARDIO_IRB, distRow, PRIYA, send, signIn, tick } from './helpers.js';

// The changed screens on dev (F1): Distribute with the question before Send, and Status with its list, filters,
// side panel. Needs DEV_APP_URL and DEV_SEED_PASSWORD (see playwright.dev.config.ts).
test('send with the question first, then the list, a filter, the panel and Esc, on dev', async ({ page }) => {
  await signIn(page, PRIYA);
  await addPdfs(page, 1, 'f1dev');
  await tick(page, CARDIO_IRB);
  await expect(page.locator('.send-summary')).toHaveText('1 file to 1 folder: 1 delivery');

  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const ask = page.getByRole('dialog', { name: 'Send 1 file to 1 folder?' });
  await expect(ask.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(ask).toHaveCount(0);
  const jobId = await send(page); // Send, then Send in the question

  await expect(page.locator('.status-chip.big')).toHaveText('Completed', { timeout: 120_000 });
  await expect(page.getByRole('complementary').getByRole('region', { name: 'Deliveries' })).toBeVisible();
  await expect(page.getByText('History')).toHaveCount(0); // job history only, no audit trail (D-F1-13)

  // Esc closes the panel and the list is there with the distribution in it; the filters narrow it.
  await page.getByRole('button', { name: 'Close' }).focus();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/#\/status$/);
  await expect(distRow(page, jobId.slice(0, 8))).toBeVisible();
  await page.getByLabel('Status').selectOption('completed');
  await expect(distRow(page, jobId.slice(0, 8))).toBeVisible();
  await page.getByLabel('Status').selectOption('cancelled');
  await expect(distRow(page, jobId.slice(0, 8))).toHaveCount(0);
  await page.getByRole('button', { name: 'All I can see' }).click();
  await page.getByLabel('Status').selectOption('');
  await expect(distRow(page, jobId.slice(0, 8))).toBeVisible();
});
