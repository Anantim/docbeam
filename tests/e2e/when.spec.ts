import { expect, test } from '@playwright/test';
import { PRIYA, removeSeeded, seedJob, signIn, tooltipOf } from './helpers.js';

// Every time is written one way (D-F1-59): "Today, 04:34", a <time datetime> element, the full time with seconds and the zone
// in the shared tooltip, tabular numerals.

const SHOTS = process.env.SHOT_DIR;

for (const width of [1440, 1280, 1024]) {
  test(`a time in the list and in the panel at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page, PRIYA);
    const jobId = await seedJob(page, ['when.pdf'], ['Cardio / CARDIO-301 Regulatory / IRB approvals']);
    try {
      await page.getByRole('button', { name: 'Distribute' }).click();
      await page.getByRole('button', { name: 'Status' }).click();
      const row = page.locator('tr', { has: page.locator(`[data-job-id="${jobId}"]`) });
      const time = row.locator('time.when');
      await expect(time).toHaveText(/^Today, \d\d:\d\d$/);
      const iso = (await time.getAttribute('datetime'))!;
      expect(new Date(iso).toISOString()).toBe(iso); // the machine-readable value
      await time.hover();
      expect(await tooltipOf(page, time)).toMatch(/^\d{1,2} \w{3} \d{4}, \d\d:\d\d:\d\d( \S+)?$/); // with seconds and the zone
      expect(await page.evaluate('getComputedStyle(document.querySelector("time.when")).fontVariantNumeric')).toContain('tabular-nums');

      if (SHOTS) await page.locator('.dist-scroll').screenshot({ path: `${SHOTS}/dates-list-${width}.png` });
      await row.locator('.dist-id').click();
      await expect(page.locator('.panel-sub time.when')).toHaveText(/^Today, \d\d:\d\d$/);
      await page.mouse.move(0, 0);
      await page.locator('.panel-sub time.when').focus(); // in the panel the time is a Tab stop: the keyboard shows the full time
      expect(await tooltipOf(page, page.locator('.panel-sub time.when'))).toMatch(/^\d{1,2} \w{3} \d{4}, \d\d:\d\d:\d\d( \S+)?$/);
      expect((await page.locator('.panel-sub').innerText()).replace(/\s+/g, ' ')).toMatch(/^Sent by Priya Shah \(you\) · Today, \d\d:\d\d/);
      if (SHOTS) await page.getByRole('complementary').screenshot({ path: `${SHOTS}/dates-panel-${width}.png` });
    } finally {
      await removeSeeded(jobId);
    }
  });
}
