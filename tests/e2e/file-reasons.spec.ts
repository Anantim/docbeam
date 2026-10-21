import { expect, test } from '@playwright/test';
import { ANANTIM, eicarDocx, pdf, signIn, tooltipOf } from './helpers.js';

// The reason under a Failed or Refused chip on Distribute (D-F1-58): one short line, cut by an ellipsis, the whole sentence in the
// tooltip on hover and on focus, and the row no taller than it has to be.

test('a Failed file and a Refused file keep one short reason line, with the whole sentence in a tooltip', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, ANANTIM);
  const row = (name: string) => page.locator('.frow', { hasText: name });

  // Failed: the scan could not run (Retry).
  await page.route('**/api/files?**', async (route) => {
    const ids = (new URL(route.request().url()).searchParams.get('ids') ?? '').split(',').filter(Boolean);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ids.map((fileId) => ({ fileId, uploaded: true, scanStatus: 'failed' }))) });
  });
  await page.getByLabel('Choose files').setInputFiles([pdf('could-not-scan.pdf')]);
  await row('could-not-scan.pdf').locator('.status-chip', { hasText: 'Failed' }).waitFor({ timeout: 60_000 });
  const failed = row('could-not-scan.pdf').locator('.fmsg');
  await expect(failed).toHaveText('Scan failed. Retry or remove.');
  await failed.hover();
  expect(await tooltipOf(page, failed)).toBe('The file could not be scanned. Retry it or remove it.');
  await page.mouse.move(0, 0);
  await failed.focus(); // the keyboard shows it too
  expect(await tooltipOf(page, failed)).toBe('The file could not be scanned. Retry it or remove it.');
  await expect(failed, 'one line').toHaveCSS('white-space', 'nowrap');
  expect(Math.round((await row('could-not-scan.pdf').boundingBox())!.height), 'the row with its reason').toBeLessThanOrEqual(56);
  await page.unroute('**/api/files?**');
  await page.getByRole('button', { name: 'Clear' }).click();

  // Refused: malware (final).
  await page.getByLabel('Choose files').setInputFiles([{ name: 'eicar-test.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await eicarDocx() }]);
  await row('eicar-test.docx').locator('.status-chip', { hasText: 'Refused' }).waitFor({ timeout: 90_000 });
  const refused = row('eicar-test.docx').locator('.fmsg');
  await expect(refused).toHaveText('Malware found. Remove this file.');
  await refused.hover();
  expect(await tooltipOf(page, refused)).toBe('Malware was found. The file was deleted and cannot be sent.');
  expect(Math.round((await row('eicar-test.docx').boundingBox())!.height)).toBeLessThanOrEqual(56);

  // A narrow status column cuts the line with an ellipsis, and the tooltip still has the whole sentence.
  await page.setViewportSize({ width: 1024, height: 768 });
  const cut = await refused.evaluate((el: unknown) => (el as { scrollWidth: number; clientWidth: number }).scrollWidth >= (el as { clientWidth: number }).clientWidth);
  expect(cut).toBe(true);
  await expect(refused).toHaveCSS('text-overflow', 'ellipsis');
});
