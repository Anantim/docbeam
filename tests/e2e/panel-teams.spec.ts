import { expect, test, type Page } from '@playwright/test';
import { ANANTIM, CARDIO_IRB, ONC_ETHICS, PRIYA, RAJ, removeSeeded, seedJob, signIn } from './helpers.js';

// The team chips on the "Sent by" line (D-F1-77, which replaced the sentence of D-F1-52 and D-F1-53): " · Showing only
// deliveries to" and the teams as pills on the one line with the time; up to 3 teams are all shown.

const SHOTS = process.env.SHOT_DIR;
const NEURO = 'Neuro / NEURO-204 Regulatory / Ethics committee';

async function openAs(page: Page, email: string, jobId: string): Promise<void> {
  await signIn(page, email);
  await page.getByRole('button', { name: 'Status' }).click();
  await page.locator('tr', { has: page.locator(`[data-job-id="${jobId}"]`) }).locator('.dist-id').click();
  await expect(page.getByRole('complementary')).toBeVisible();
}

for (const width of [1440, 1280, 1024]) {
  test(`the panel's team chips stay on one line at ${width} px, 1 team and 3 teams`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page, PRIYA);
    const jobId = await seedJob(page, ['note.pdf'], [CARDIO_IRB, ONC_ETHICS, NEURO]);
    try {
      for (const [email, teams] of [[RAJ, ['Cardio']], [ANANTIM, ['Cardio', 'Neuro', 'Oncology']]] as const) {
        await page.goto('/');
        if (await page.getByRole('button', { name: 'Sign out' }).isVisible()) await page.getByRole('button', { name: 'Sign out' }).click();
        await openAs(page, email, jobId);
        const sub = page.locator('.panel-sub');
        await expect(sub.locator('.panel-note-label')).toHaveText('Showing only deliveries to'); // the panel has loaded
        await expect(sub.locator('.panel-note .sr')).toHaveText(`Showing only deliveries to ${teams.length === 1 ? teams[0] : `${teams.slice(0, -1).join(', ')} and ${teams[teams.length - 1]}`}`);
        // The chips, sorted A to Z, all shown for up to 3 teams: no "+N".
        await expect(sub.locator('.team-chip')).toHaveText([...teams]);
        await expect(sub.locator('button.team-chip.more')).toHaveCount(0);
        // One line: the whole line is as tall as one chip row, and the chips are not cut off by the panel.
        expect(Math.round((await sub.boundingBox())!.height), 'one line').toBeLessThan(36);
        const edge = (await page.getByRole('complementary').boundingBox())!;
        const last = (await sub.locator('.team-chip').last().boundingBox())!;
        expect(last.x + last.width, 'inside the panel').toBeLessThanOrEqual(edge.x + edge.width);
        if (SHOTS) await page.getByRole('complementary').screenshot({ path: `${SHOTS}/panel-teams-${teams.length}-${width}.png` });
      }
    } finally {
      await removeSeeded(jobId);
    }
  });
}
