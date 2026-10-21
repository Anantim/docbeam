import { expect, test } from '@playwright/test';
import { CARDIO_IRB, PRIYA, removeSeeded, seedJob, signIn, tooltipOf } from './helpers.js';

// The deliveries table (D-F1-60): icons only in Details, nothing under the status chip, the reason and the attempts in the
// shared tooltip on the chip and on the info icon, the Retrying chip, and every row 52 px in every state.

test('permanent failure, retried failure, cancelled, retrying and completed rows', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, PRIYA);
  const job = await seedJob(page, ['Permanent.pdf', 'Retried.pdf', 'Cancelled.pdf', 'Retrying.pdf', 'Done.pdf'], [CARDIO_IRB], () => 'application/pdf', (i) =>
    i === 0 ? { status: 'failed', attempts: 1, code: 'FILE_NOT_UPLOADED' } : i === 1 ? { status: 'failed', attempts: 5, code: 'RETRIES_EXHAUSTED' } : i === 2 ? { status: 'failed', attempts: 1, code: 'CANCELLED' } : i === 3 ? { status: 'in_progress', attempts: 3 } : { status: 'completed', attempts: 1 },
  );
  try {
    await page.getByRole('button', { name: 'Distribute' }).click();
    await page.getByRole('button', { name: 'Status' }).click();
    await page.locator('tr', { has: page.locator(`[data-job-id="${job}"]`) }).locator('.dist-id').click();
    await page.getByRole('table', { name: 'Deliveries, 5' }).waitFor();
    const row = (file: string) => page.locator('.trow', { hasText: file });
    const chip = (file: string) => row(file).locator('.status-chip');

    // The words on the chips: the retrying one says so, in the in-progress colour.
    await expect(chip('Retrying.pdf')).toHaveText('Retrying');
    await expect(chip('Retrying.pdf')).toHaveAttribute('data-tone', 'busy');
    await expect(chip('Cancelled.pdf')).toHaveText('Cancelled');
    await expect(chip('Permanent.pdf')).toHaveText('Failed');

    // Nothing under a chip, and no raw code or attempts text on the page.
    await expect(page.locator('.tattempt-note, .tdetail .code, .tdetail .reason')).toHaveCount(0);
    await expect(page.locator('.ttable')).not.toContainText(/FILE_NOT_UPLOADED|RETRIES_EXHAUSTED|CANCELLED/);

    // The tooltip on the chip and on the info icon: the reason from the one map, and the attempts only where they apply.
    const says = async (file: string, text: string): Promise<void> => {
      await page.mouse.move(0, 0);
      await chip(file).hover();
      expect(await tooltipOf(page, chip(file)), `${file} chip`).toBe(text);
      await page.mouse.move(0, 0);
      const info = row(file).getByRole('button', { name: /^Why this/ });
      if (await info.count()) {
        await info.focus();
        expect(await tooltipOf(page, info), `${file} info icon`).toBe(text);
      }
    };
    await says('Permanent.pdf', 'The file never finished uploading, so it could not be delivered.');
    await says('Retried.pdf', 'The platform did not respond after 5 attempts.');
    await says('Cancelled.pdf', 'Cancelled by the sender before it was delivered.');
    await says('Retrying.pdf', 'Trying again. Attempt 3 of 5.');
    await says('Done.pdf', 'Delivered to the folder in the platform.');

    // Details: Preview and Download on the delivered row, an info icon where nothing arrived, nothing for a delivery still running.
    await expect(row('Done.pdf').getByRole('button')).toHaveCount(2);
    await expect(row('Retried.pdf').getByRole('button', { name: 'Why this delivery failed' })).toBeVisible();
    await expect(row('Retrying.pdf').locator('.tdetail button')).toHaveCount(0);
    await expect(row('Retrying.pdf').locator('.tdetail')).toHaveText('');

    // Every row is 52 px, in every state.
    const heights = await page.locator('.tscroll [role="row"][aria-rowindex]').evaluateAll((rows: unknown[]) => (rows as Array<{ getBoundingClientRect(): { height: number } }>).map((r) => Math.round(r.getBoundingClientRect().height)));
    expect(heights).toEqual([52, 52, 52, 52, 52]);

    // A click on the info icon shows it too, and Esc closes it (and then the panel, which Esc closes as well).
    await page.mouse.move(0, 0);
    await row('Permanent.pdf').getByRole('button', { name: 'Why this delivery failed' }).click();
    await expect(page.getByRole('tooltip')).toHaveText('The file never finished uploading, so it could not be delivered.');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip').filter({ hasText: 'never finished uploading' })).toHaveCount(0);
  } finally {
    await removeSeeded(job);
  }
});
