import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { CARDIO_IRB, PRIYA, sendFiles, signIn, sql, stopWorkers } from './helpers.js';

// A delivery that goes into a retry is pushed to the page (D-F1-65): the "Retrying" chip and the counts change live, with no
// reload and no new request for the rows. Local stack: the platform is stopped while the workers are held, so every first try
// fails, and the second try is the first thing the page is told about.

const cwd = new URL('../..', import.meta.url).pathname;
const compose = (...args: string[]): void => void execFileSync('docker', ['compose', ...args], { cwd, stdio: 'pipe' });

test('the Retrying chip appears live when a second try starts, and the delivery completes when the platform is back', async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, PRIYA);
  let platformDown = false;
  try {
    const { jobId } = await sendFiles(page, 1, [CARDIO_IRB], async () => {
      stopWorkers(); // no delivery starts before the platform is stopped
      await new Promise((resolve) => setTimeout(resolve, 11_000)); // a stopped worker's last long poll
    });
    await page.evaluate('window.__kept = 1'); // gone if the page is reloaded
    compose('stop', '-t', '0', 'platform');
    platformDown = true;
    compose('up', '-d', '--no-deps', 'workers');

    // The first try fails and goes back to the queue; the second try is pushed.
    await expect(page.locator('.trow .status-chip', { hasText: 'Retrying' })).toBeVisible({ timeout: 150_000 });
    expect(await page.evaluate('window.__kept === 1')).toBe(true); // no reload
    await expect(page.locator('.trow .status-chip', { hasText: 'Retrying' })).toHaveAttribute('data-tone', 'busy');
    const rows = await sql<{ attempt_count: number }>('SELECT attempt_count FROM tasks WHERE job_id = $1', [jobId]);
    expect(rows[0]?.attempt_count).toBeGreaterThanOrEqual(2);

    compose('start', 'platform');
    platformDown = false;
    await expect(page.locator('.status-chip.big')).toHaveText('Completed', { timeout: 240_000 });
  } finally {
    if (platformDown) compose('start', 'platform');
    compose('up', '-d', 'workers');
  }
});
