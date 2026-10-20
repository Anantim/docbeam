import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';
import { addPdfs, CARDIO_IRB, CARDIO_PROTOCOL, PRIYA, signIn, tick } from './helpers.js';

// Takes a screenshot of every screen at 1440 and 1280 px wide (F1). It does not assert anything and only runs
// when SHOT_DIR is set: SHOT_DIR=docs/testing/f1-evidence/before npx playwright test screens
const dir = process.env.SHOT_DIR;
const sizes = [
  { w: 1440, h: 900 },
  { w: 1280, h: 800 },
  { w: 1024, h: 768 },
];

test.describe('screens', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });
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

    await page.goto('/');
    await shot('01-sign-in');
    await page.getByRole('button', { name: 'Create an account' }).click();
    await shot('02-register');
    await page.getByRole('button', { name: 'I already have an account' }).click();
    await page.getByLabel('Work email').fill('nobody@example.com');
    await page.getByLabel('Password').fill('wrong-password-here');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('alert').waitFor();
    await shot('03-sign-in-error');

    await signIn(page, PRIYA);
    await shot('04-distribute-empty');

    await addPdfs(page, 3, 'shot');
    await page.getByLabel('Select all files').click();
    await tick(page, CARDIO_IRB);
    await tick(page, CARDIO_PROTOCOL);
    await shot('05-distribute-filled');

    await page.getByRole('button', { name: /^Preview/ }).first().click();
    await page.waitForTimeout(800);
    await shot('06-preview-dialog');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await shot('07-send-question');
    await page.getByRole('dialog').getByRole('button', { name: 'Send', exact: true }).click();
    await page.waitForURL(/#\/status\//);
    await page.waitForTimeout(4000);
    await shot('08-status-panel');
    await page.getByRole('button', { name: 'Copy link' }).click();
    await page.waitForTimeout(300);
    await shot('09-toast');

    await page.getByRole('button', { name: 'Close' }).click();
    await page.waitForTimeout(500);
    await shot('10-status-list');
    await page.getByRole('button', { name: 'Upload events' }).click();
    await page.waitForTimeout(1000);
    await shot('11-upload-events');

    // The sign-in-again dialog: the server stops accepting the token.
    await page.route('**/api/jobs**', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Sign in again.' } }) }));
    await page.route('**/api/auth/refresh', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Sign in again.' } }) }));
    await page.getByRole('button', { name: 'My teams' }).click();
    await page.getByRole('dialog', { name: 'Sign in again' }).waitFor();
    await shot('12-session-dialog');
  });
});
