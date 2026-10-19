import { mkdirSync } from 'node:fs';
import { test, type Page } from '@playwright/test';
import { addPdfs, CARDIO_IRB, CARDIO_PROTOCOL, PRIYA, send, signIn, tick } from './helpers.js';

// Takes a screenshot of every screen at 1440 and 1280 px wide (F1). It does not assert anything and only runs
// when SHOT_DIR is set: SHOT_DIR=docs/testing/f1-evidence/before npx playwright test screens
const dir = process.env.SHOT_DIR;
const sizes = [
  { w: 1440, h: 900 },
  { w: 1280, h: 800 },
];

test.describe('screens', () => {
  test.skip(dir === undefined, 'set SHOT_DIR to take screenshots');
  test.setTimeout(300_000);

  test('every screen at two widths', async ({ page }) => {
    mkdirSync(dir as string, { recursive: true });
    const shot = async (name: string): Promise<void> => {
      for (const s of sizes) {
        await page.setViewportSize({ width: s.w, height: s.h });
        await page.waitForTimeout(250);
        await page.screenshot({ path: `${dir}/${name}-${s.w}.png`, fullPage: true });
      }
    };
    const open = async (p: Page, tab: string): Promise<void> => {
      await p.getByRole('button', { name: tab, exact: true }).click();
    };

    await page.goto('/');
    await shot('01-sign-in');
    await signIn(page, PRIYA);
    await shot('02-distribute-empty');

    await addPdfs(page, 3, 'shot');
    await tick(page, CARDIO_IRB);
    await tick(page, CARDIO_PROTOCOL);
    await shot('03-distribute-filled');

    await send(page);
    await page.waitForTimeout(4000);
    await shot('04-status');

    await open(page, 'Audit trail');
    await page.waitForTimeout(1500);
    await shot('05-audit');
  });
});
