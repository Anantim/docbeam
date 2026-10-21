import { expect, test, type Page } from '@playwright/test';
import { ANANTIM, CARDIO_IRB, ONC_ETHICS, PRIYA, RAJ, removeSeeded, seedJob, signIn } from './helpers.js';

// The team note on the "Sent by" line (D-F1-52, D-F1-53): one line, " · " between the parts, and the names that do not fit as "+N".

const SHOTS = process.env.SHOT_DIR;
const NEURO = 'Neuro / NEURO-204 Regulatory / Ethics committee';

async function openAs(page: Page, email: string, jobId: string): Promise<void> {
  await signIn(page, email);
  await page.getByRole('button', { name: 'Status' }).click();
  await page.locator('tr', { has: page.locator(`[data-job-id="${jobId}"]`) }).locator('.dist-id').click();
  await expect(page.getByRole('complementary')).toBeVisible();
}

for (const width of [1440, 1280, 1024]) {
  test(`the panel's team note stays on one line at ${width} px, 1 team and 3 teams`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page, PRIYA);
    const jobId = await seedJob(page, ['note.pdf'], [CARDIO_IRB, ONC_ETHICS, NEURO]);
    try {
      for (const [email, count] of [[RAJ, 1], [ANANTIM, 3]] as const) {
        await page.goto('/');
        if (await page.getByRole('button', { name: 'Sign out' }).isVisible()) await page.getByRole('button', { name: 'Sign out' }).click();
        await openAs(page, email, jobId);
        const sub = page.locator('.panel-sub');
        await expect(sub).toContainText('Showing deliveries'); // the panel has loaded
        const text = (await sub.innerText()).replace(/\s+/g, ' ');
        expect(text).toMatch(/^Sent by Priya Shah · (Today|Yesterday|\d+ \w+( \d{4})?), \d\d:\d\d · Showing deliveries to your teams?:/);
        expect(Math.round((await sub.locator('.panel-note').boundingBox())!.height), 'one line').toBeLessThan(22);
        // Nothing is cut by an ellipsis: what does not fit is "+N".
        expect(await sub.locator('.teamlist').evaluate((el: unknown) => (el as { scrollWidth: number; clientWidth: number }).scrollWidth <= (el as { clientWidth: number }).clientWidth), 'no ellipsis').toBe(true);
        const more = sub.getByRole('button', { name: /^Show all \d+ teams?$/ });
        if (count === 1) {
          expect(text).toMatch(/your team: Cardio\.$/);
          await expect(more).toHaveCount(0);
        } else if (await more.count()) {
          // Cut short: the names that fit, then "+N", and the popover has all three of the viewer's teams.
          await more.click();
          const panel = page.getByRole('dialog', { name: 'Your teams' });
          await expect(panel.locator('li')).toHaveText(['Cardio', 'Neuro', 'Oncology']);
          await page.keyboard.press('Escape');
        } else {
          expect(text).toMatch(/your teams: Cardio, Neuro, Oncology\.$/);
        }
        if (SHOTS) await page.getByRole('complementary').screenshot({ path: `${SHOTS}/panel-teams-${count}-${width}.png` });
      }
    } finally {
      await removeSeeded(jobId);
    }
  });
}
