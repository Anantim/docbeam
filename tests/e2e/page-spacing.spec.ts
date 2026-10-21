import { expect, test, type Page } from '@playwright/test';
import { ANANTIM, RAJ, signIn } from './helpers.js';

// One rhythm on Status and Distribute (D-F1-54): 16 px from the top bar to the title and from the title to what follows,
// 12 px from the filter row to the table. And the header teams line on one line (D-F1-53).

const SHOTS = process.env.SHOT_DIR;
const SIZES = [1440, 1280, 1024];

const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;

for (const width of SIZES) {
  test(`Status and Distribute spacing at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page, ANANTIM);
    await page.getByRole('button', { name: 'Status' }).click();
    await expect(page.getByRole('heading', { name: 'Distributions' })).toBeVisible();
    const bar = await box(page, 'header.top');
    const title = await box(page, '.page-head:visible');
    const filters = await box(page, '.filterbar:visible');
    const list = await box(page, '.status-layout');
    expect(Math.round(title.y - (bar.y + bar.height)), 'top bar to title').toBe(16);
    expect(Math.round(filters.y - (title.y + title.height)), 'title to filter row').toBe(16);
    expect(Math.round(list.y - (filters.y + filters.height)), 'filter row to table').toBe(12);

    await page.getByRole('button', { name: 'Distribute' }).click();
    await expect(page.getByRole('heading', { name: 'New distribution' })).toBeVisible();
    const head = await box(page, '.page-head:visible');
    const cards = await box(page, '.workspace:visible');
    expect(Math.round(head.y - (bar.y + bar.height)), 'top bar to title').toBe(16);
    expect(Math.round(cards.y - (head.y + head.height)), 'title to cards').toBe(16);
  });

  test(`the header shows the teams on one line at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const [email, teams] of [[RAJ, 'Cardio'], [ANANTIM, 'Cardio, Neuro, Oncology']] as const) {
      await signIn(page, email);
      const line = page.locator('.who .tm');
      await expect(line).toHaveText(teams);
      const b = (await line.boundingBox())!;
      expect(b.width).toBeLessThanOrEqual(221);
      expect(b.height).toBeLessThan(20); // one line
      if (SHOTS) await page.locator('header.top').screenshot({ path: `${SHOTS}/header-teams-${teams.split(',').length}-${width}.png` });
      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect(page.getByLabel('Work email')).toBeVisible();
    }
  });
}
