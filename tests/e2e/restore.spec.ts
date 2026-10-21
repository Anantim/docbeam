import { expect, test } from '@playwright/test';
import { addPdfs, CARDIO_IRB, ONC_ETHICS, PRIYA, pdf, send, signIn, tick } from './helpers.js';

// The batch survives a reload (D-F1-66): files already uploaded and scanned come back Ready with their folder ticks; a file that
// was mid-upload cannot, and the page says so; after Send or Clear nothing comes back.

test('ready files come back after a reload with their folders, and can be sent', async ({ page }) => {
  await signIn(page, PRIYA);
  const names = await addPdfs(page, 2, 'restore');
  await tick(page, CARDIO_IRB);
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  for (const name of names) await expect(page.locator('.frow', { hasText: name })).toBeVisible();
  await expect(page.getByText('Ready', { exact: true })).toHaveCount(2);
  // The folder is still ticked for both files: Send is on, and its question names them.
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Send 2 files to 1 folder?' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  // A restored file has no copy of its bytes in this page: its Preview says so.
  await expect(page.locator('.frow', { hasText: names[0] as string }).getByRole('button', { name: /^Preview/ })).toBeDisabled();
  // Nothing was lost, so nothing is said about files that could not be restored.
  await expect(page.getByRole('alert').filter({ hasText: 'could not be restored' })).toHaveCount(0);

  // Remove one and reload: the other still comes back, the removed one does not.
  await page.getByRole('button', { name: `Remove ${names[0]}` }).click();
  await page.reload();
  await expect(page.locator('.frow', { hasText: names[1] as string })).toBeVisible();
  await expect(page.locator('.frow', { hasText: names[0] as string })).toHaveCount(0);
});

test('a file that was still uploading is not restored, and the page says how many', async ({ page }) => {
  await signIn(page, PRIYA);
  await addPdfs(page, 1, 'kept');
  // The storage upload of the next file never finishes (the request is held), so it is mid-upload at the reload.
  await page.route(/localhost:4566/, () => undefined);
  await page.getByLabel('Choose files').setInputFiles([pdf('midway-upload.pdf')]);
  await expect(page.locator('.frow', { hasText: 'midway-upload.pdf' })).toBeVisible();
  page.on('dialog', (d) => void d.accept()); // the browser asks before leaving: a file would be lost
  await page.unroute(/localhost:4566/);
  await page.reload();
  await expect(page.getByRole('alert').filter({ hasText: '1 file could not be restored' })).toBeVisible();
  await expect(page.locator('.frow', { hasText: 'midway-upload.pdf' })).toHaveCount(0);
  await expect(page.locator('.frow', { hasText: 'kept-' })).toBeVisible();
});

test('after Send and after Clear nothing comes back', async ({ page }) => {
  await signIn(page, PRIYA);
  await addPdfs(page, 1, 'sent');
  await tick(page, ONC_ETHICS);
  await send(page);
  await page.getByRole('button', { name: 'Distribute' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.getByRole('button', { name: 'Distribute' }).click();
  await expect(page.locator('.frow')).toHaveCount(0);

  await addPdfs(page, 1, 'cleared');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.getByRole('button', { name: 'Distribute' }).click();
  await expect(page.locator('.frow')).toHaveCount(0);
});
