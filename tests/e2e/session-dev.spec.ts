import { expect, test } from '@playwright/test';
import { ON_DEV, PRIYA, signIn } from './helpers.js';

// The session on dev (D-F1-14, D-F1-19): sign in, stay on the page for 22 minutes while using it, and the "Sign in again"
// dialog never shows. The access token lasts about 15 minutes, so at least one silent refresh happens in this time. The test
// prints when each refresh happened and what it answered. Runs on dev only (`npm run test:e2e:dev -- session-dev`).
const MINUTES = 22;

test.skip(!ON_DEV, 'runs only against dev: set DEV_APP_URL and use npm run test:e2e:dev');

test(`the page stays signed in for ${MINUTES} minutes of use, with no dialog`, async ({ page }) => {
  test.setTimeout((MINUTES + 6) * 60_000);
  const started = Date.now();
  const at = (): string => `${((Date.now() - started) / 60_000).toFixed(1)} min`;
  page.on('response', (res) => {
    if (res.url().endsWith('/auth/refresh')) console.log(`refresh at ${at()}: HTTP ${res.status()}`);
  });

  await signIn(page, PRIYA);
  const dialog = page.getByRole('dialog', { name: 'Sign in again' });
  const nav = page.getByRole('navigation', { name: 'Main' });
  let rounds = 0;
  while (Date.now() - started < MINUTES * 60_000) {
    await nav.getByRole('button', { name: 'Status' }).click(); // a request every minute: the list
    await expect(page.getByRole('heading', { name: 'Distributions' })).toBeVisible();
    await page.waitForTimeout(30_000);
    await expect(dialog, `no dialog at ${at()}`).toHaveCount(0);
    await nav.getByRole('button', { name: 'Distribute' }).click();
    await page.mouse.move(100 + (rounds % 5) * 40, 300);
    await page.waitForTimeout(30_000);
    await expect(dialog, `no dialog at ${at()}`).toHaveCount(0);
    rounds += 1;
  }
  console.log(`session check: ${rounds} rounds, ${at()} on the page, no dialog`);
  await nav.getByRole('button', { name: 'Status' }).click();
  await expect(page.getByRole('heading', { name: 'Distributions' })).toBeVisible();
});
