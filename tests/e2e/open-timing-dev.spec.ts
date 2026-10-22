import { expect, test } from '@playwright/test';
import { ON_DEV, PRIYA, RAJ, signIn } from './helpers.js';

// How long opening a distribution takes on deployed dev, in a real browser (D-F1-81, A12): from the click on a row of the list to
// the moment its first delivery row is drawn. Each run opens a finished distribution again (a warm open).
// Run: npm run test:e2e:dev -- open-timing-dev. It prints the runs, the median and the worst.

test.skip(!ON_DEV, 'dev only');

for (const who of [PRIYA, RAJ]) {
  test(`opening a finished distribution as ${who.split('.')[0]} shows its deliveries in about a second`, async ({ page }) => {
    test.setTimeout(240_000);
    await signIn(page, who);
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Status' }).click();
    const rows = page.locator('.dist-table tbody tr:not(.sk-row)', { has: page.locator('.status-chip', { hasText: /^Completed$/ }) });
    await expect(rows.first()).toBeVisible({ timeout: 60_000 });
    const id = (await rows.first().locator('.dist-id').getAttribute('data-job-id')) as string;
    const times: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      if (i > 0) {
        await page.getByRole('complementary').getByRole('button', { name: 'Close', exact: true }).click(); // the panel closes, and is gone before the next open
        await expect(page.getByRole('complementary')).toHaveCount(0);
      }
      await expect(page.locator(`[data-job-id="${id}"]`)).toBeVisible();
      const started = Date.now();
      await page.locator(`[data-job-id="${id}"]`).click();
      await page.locator('.ttable [role="row"][aria-rowindex="2"]').waitFor({ timeout: 30_000 });
      times.push(Date.now() - started);
    }
    const sorted = [...times].sort((a, b) => a - b);
    console.log(`open-timing ${who}: runs ${times.join(', ')} ms, median ${sorted[Math.floor(sorted.length / 2)]} ms, worst ${sorted[sorted.length - 1]} ms`);
  });
}
