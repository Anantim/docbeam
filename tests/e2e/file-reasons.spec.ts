import { expect, test } from '@playwright/test';
import { ANANTIM, eicarDocx, pdf, signIn, tooltipOf } from './helpers.js';

// A Failed file on Distribute (D-F1-60): no reason line under the chip; the whole reason is the chip's tooltip on hover, focus and
// click; the row keeps its action (Retry) and the shared 52 px height; the Send reason names what blocks Send. A file with malware is
// not a state any more (D-F1-78): it leaves the list by itself and the "not added" box says why.

test('a Failed file: the reason is in the chip tooltip, the row stays 52 px, Send says what blocks it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, ANANTIM);
  const row = (name: string) => page.locator('.frow', { hasText: name });

  // Failed: the scan couldn't run (Retry).
  await page.route('**/api/files?**', async (route) => {
    const ids = (new URL(route.request().url()).searchParams.get('ids') ?? '').split(',').filter(Boolean);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ids.map((fileId) => ({ fileId, uploaded: true, scanStatus: 'failed' }))) });
  });
  await page.getByLabel('Choose files').setInputFiles([pdf('could-not-scan.pdf')]);
  const failedChip = row('could-not-scan.pdf').locator('.status-chip', { hasText: 'Failed' });
  await failedChip.waitFor({ timeout: 60_000 });
  await expect(row('could-not-scan.pdf').locator('.fmsg')).toHaveCount(0); // nothing under the chip
  await failedChip.hover();
  expect(await tooltipOf(page, failedChip)).toBe("The scan couldn't run.");
  await page.mouse.move(0, 0);
  await failedChip.focus(); // the chip is a Tab stop: the keyboard shows it too
  expect(await tooltipOf(page, failedChip)).toBe("The scan couldn't run.");
  await page.keyboard.press('Escape'); // Esc closes it
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.mouse.move(0, 0);
  await failedChip.click(); // a click shows it
  expect(await tooltipOf(page, failedChip)).toBe("The scan couldn't run.");
  await expect(row('could-not-scan.pdf').getByRole('button', { name: 'Retry upload of could-not-scan.pdf' })).toBeVisible();
  expect(Math.round((await row('could-not-scan.pdf').boundingBox())!.height), 'the row is the shared height').toBeLessThanOrEqual(53);
  await expect(page.locator('.send-reason')).toHaveText('Retry or remove 1 failed file');
  await page.unroute('**/api/files?**');
  await page.getByRole('button', { name: 'Clear' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear' }).click();
});

test('a file with malware leaves the list by itself, and the "not added" box says why (D-F1-78)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, ANANTIM);
  await page.getByLabel('Choose files').setInputFiles([
    pdf('good-one.pdf'),
    { name: 'eicar-test.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await eicarDocx() },
  ]);
  const note = page.locator('.notice').filter({ hasText: 'not added' });
  await expect(note).toContainText('eicar-test.docx', { timeout: 90_000 });
  await expect(note.locator('.notice-list .notice-detail')).toHaveText('Malware was found. The file was deleted.');
  await expect(note.getByText('1 file not added.')).toBeVisible();
  await expect(page.locator('.frow', { hasText: 'eicar-test.docx' })).toHaveCount(0); // not a row any more
  await expect(page.locator('.frow', { hasText: 'good-one.pdf' })).toHaveCount(1); // the good file stays
  await expect(page.getByText('Refused')).toHaveCount(0);
  await expect(page.getByText('Will not be sent')).toHaveCount(0);
  await expect(page.locator('.send-reason')).toHaveText('Choose folders for 1 file'); // the usual rule: no "Remove 1 refused file"
});
