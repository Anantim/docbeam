import { expect, test } from '@playwright/test';
import { CARDIO_IRB, ONC_ETHICS, PRIYA, removeSeeded, seedJob, signIn } from './helpers.js';

// A click anywhere on a distribution's row opens its panel, except on the copy icon and a "+N" link, which keep their own
// action (D-F1-64).

test('the middle and the end of a row open the panel; the copy icon and "+N" do their own thing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, PRIYA);
  const job = await seedJob(page, ['first.pdf', 'second.pdf', 'third.pdf'], [CARDIO_IRB, ONC_ETHICS, 'Cardio / CARDIO-301 Site files / Delegation logs']);
  try {
    await page.getByRole('button', { name: 'Distribute' }).click();
    await page.getByRole('button', { name: 'Status' }).click();
    const row = page.locator('tr', { has: page.locator(`[data-job-id="${job}"]`) });
    await expect(row).toBeVisible();

    // The middle of the row (the Files and Destinations side), not the ID.
    const box = (await row.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByRole('complementary')).toBeVisible();
    await expect(page.locator('.status-chip.big')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('complementary')).toBeHidden();

    // The right-hand end of the row, past the text.
    await page.mouse.click(box.x + box.width - 12, box.y + box.height / 2);
    await expect(page.getByRole('complementary')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('complementary')).toBeHidden();

    // The copy icon copies and does not open the panel.
    await row.hover();
    await row.getByRole('button', { name: 'Copy link' }).click();
    await expect(page.getByRole('complementary')).toBeHidden();

    // "+N" opens its list and does not open the panel.
    await row.getByRole('button', { name: /^Show \d+ more files/ }).click();
    await expect(page.getByRole('dialog', { name: /More files of/ })).toBeVisible();
    await expect(page.getByRole('complementary')).toBeHidden();
    await page.keyboard.press('Escape');

    // Beside the open panel the list is narrower, and a click anywhere on a row still opens that row's distribution (here: the same one).
    await row.locator('.dist-id').click();
    await expect(page.getByRole('complementary')).toBeVisible();
    const narrow = (await row.boundingBox())!;
    await page.mouse.click(narrow.x + narrow.width - 20, narrow.y + narrow.height / 2);
    await expect(page.getByRole('complementary')).toBeVisible();
    await expect(page.locator('.panel-top h2')).toHaveText(job.slice(0, 8));
  } finally {
    await removeSeeded(job);
  }
});
