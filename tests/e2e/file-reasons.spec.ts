import { expect, test } from '@playwright/test';
import { ANANTIM, eicarDocx, pdf, signIn, tooltipOf } from './helpers.js';

// A Failed or Refused file on Distribute (D-F1-60): no reason line under the chip; the whole reason is the chip's tooltip on hover,
// focus and click; the row keeps its action (Retry on Failed, remove on Refused) and the shared 52 px height; the Send reason
// names what blocks Send.

test('a Failed file and a Refused file: the reason is in the chip tooltip, the row stays 52 px, Send says what blocks it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, ANANTIM);
  const row = (name: string) => page.locator('.frow', { hasText: name });

  // Failed: the scan could not run (Retry).
  await page.route('**/api/files?**', async (route) => {
    const ids = (new URL(route.request().url()).searchParams.get('ids') ?? '').split(',').filter(Boolean);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ids.map((fileId) => ({ fileId, uploaded: true, scanStatus: 'failed' }))) });
  });
  await page.getByLabel('Choose files').setInputFiles([pdf('could-not-scan.pdf')]);
  const failedChip = row('could-not-scan.pdf').locator('.status-chip', { hasText: 'Failed' });
  await failedChip.waitFor({ timeout: 60_000 });
  await expect(row('could-not-scan.pdf').locator('.fmsg')).toHaveCount(0); // nothing under the chip
  await failedChip.hover();
  expect(await tooltipOf(page, failedChip)).toBe('The scan could not run.');
  await page.mouse.move(0, 0);
  await failedChip.focus(); // the chip is a Tab stop: the keyboard shows it too
  expect(await tooltipOf(page, failedChip)).toBe('The scan could not run.');
  await page.keyboard.press('Escape'); // Esc closes it
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.mouse.move(0, 0);
  await failedChip.click(); // a click shows it
  expect(await tooltipOf(page, failedChip)).toBe('The scan could not run.');
  await expect(row('could-not-scan.pdf').getByRole('button', { name: 'Retry upload of could-not-scan.pdf' })).toBeVisible();
  expect(Math.round((await row('could-not-scan.pdf').boundingBox())!.height), 'the row is the shared height').toBeLessThanOrEqual(53);
  await expect(page.locator('.send-reason')).toHaveText('Retry or remove 1 failed file');
  await page.unroute('**/api/files?**');
  await page.getByRole('button', { name: 'Clear' }).click();

  // Refused: malware (final).
  await page.getByLabel('Choose files').setInputFiles([{ name: 'eicar-test.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await eicarDocx() }]);
  const refusedChip = row('eicar-test.docx').locator('.status-chip', { hasText: 'Refused' });
  await refusedChip.waitFor({ timeout: 90_000 });
  await expect(row('eicar-test.docx').locator('.fmsg')).toHaveCount(0);
  await refusedChip.hover();
  expect(await tooltipOf(page, refusedChip)).toBe('Malware was found. The file was deleted and cannot be sent.');
  await expect(row('eicar-test.docx').getByRole('button', { name: 'Remove eicar-test.docx' })).toBeVisible(); // the visible action
  expect(Math.round((await row('eicar-test.docx').boundingBox())!.height)).toBeLessThanOrEqual(53);
  await expect(page.locator('.send-reason')).toHaveText('Remove 1 refused file');
});
