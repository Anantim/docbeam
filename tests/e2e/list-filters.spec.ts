import { expect, test } from '@playwright/test';
import { addPdfs, CARDIO_IRB, PRIYA, removeSeeded, seedJob, signIn, tick } from './helpers.js';

// The "Filter…" box on long lists (D-F1-41), in a real browser: the file list on Distribute (past 15 files) and the deliveries
// in the side panel (past 15). Both narrow only what is listed; short lists have no box. (The Sender menu's box, past 10
// people, is covered by FilterMenu.test.tsx: the seed has too few people to reach 10.)

test('Distribute: the box is always shown, narrows the list, says Showing N of M, and Select all and Send still act on every file', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, PRIYA);
  const box = page.getByRole('textbox', { name: 'Filter files' });
  await expect(box).toBeDisabled(); // always there (D-F1-77), and off while there is no file
  await addPdfs(page, 15, 'few');
  await expect(box).toBeEnabled(); // no threshold: the box is on from the first file
  await page.getByLabel('Choose files').setInputFiles([{ name: 'sixteenth-labs.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n% sixteen\n%%EOF\n') }]);
  await expect(page.getByText('Ready', { exact: true })).toHaveCount(16, { timeout: 90_000 });
  await expect(box).toBeVisible();

  await box.fill('SIXTEENTH');
  await expect(page.locator('.frow[data-id]')).toHaveCount(1);
  await expect(page.getByText('Showing 1 of 16')).toBeVisible();
  await box.fill('zzz');
  await expect(page.getByText('No matches')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(box).toHaveValue('');
  await expect(page.locator('.frow[data-id]')).toHaveCount(16);

  // Filtered to one file, "Select all" and the tick of a folder still take all 16.
  await box.fill('sixteenth');
  await page.getByLabel('Select all to choose their folders').click();
  await page.getByLabel('Select all to choose their folders').click(); // none: a tick goes to all files
  await tick(page, CARDIO_IRB);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Send 16 files to 1 folder?' })).toBeVisible(); // all 16, not the one that is listed
  await page.keyboard.press('Escape');
});

test('the side panel: the box is always shown, matches the file name or the folder, and works with the status choice', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, PRIYA);
  const names = Array.from({ length: 20 }, (_, i) => `${i % 2 === 0 ? 'Consent' : 'Lab results'} ${String(i + 1).padStart(2, '0')}.pdf`);
  const jobId = await seedJob(page, names, ['Cardio / CARDIO-301 Regulatory / IRB approvals']);
  const short = await seedJob(page, names.slice(0, 3), ['Cardio / CARDIO-301 Regulatory / IRB approvals']);
  try {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Status' }).click();
    await page.locator(`[data-job-id="${short}"]`).click();
    await expect(page.getByRole('table', { name: 'Deliveries, 3' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /Filter deliveries/ })).toBeEnabled(); // 3 deliveries: the box is there all the same (D-F1-77)

    await page.locator(`[data-job-id="${jobId}"]`).click();
    const table = page.getByRole('table', { name: 'Deliveries, 20' });
    await expect(table).toBeVisible();
    const box = page.getByRole('textbox', { name: /Filter deliveries/ });
    await expect(box).toBeVisible();
    const rows = table.locator('[role="row"][aria-rowindex]');
    await box.fill('lab RESULTS 1');
    await expect(rows).toHaveCount(5); // Lab results 10, 12, 14, 16, 18
    await box.fill('zzz');
    await expect(page.getByText('No matches')).toBeVisible();
    await page.keyboard.press('Escape'); // empties the box, and does not close the panel
    await expect(box).toHaveValue('');
    await expect(page.getByRole('complementary')).toBeVisible();

    // The folder path matches too: all 20 deliveries go to "IRB approvals" (the list draws the rows in view).
    await box.fill('irb approvals');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(5);

    // With the status choice: the text stays when "Completed" is chosen.
    await box.fill('consent');
    await page.getByRole('button', { name: /^Completed/ }).click();
    await expect(box).toHaveValue('consent');
    await expect(rows.first()).toContainText('Consent');
  } finally {
    await removeSeeded(jobId);
    await removeSeeded(short);
  }
});
