import { expect, test } from '@playwright/test';
import { env } from '../integration/helpers.js';
import { CARDIO_IRB, CARDIO_PROTOCOL, chip, columnReport, counts, PRIYA, readCounts, sendFiles, signIn, sql, withWorkersStopped } from './helpers.js';

// Found on dev in the person's browser checks (D-M3-17): an old sign-in error that stayed after signing in again,
// a File column that took a third of the table, and the counts of a distribution that was cancelled part way.

const unauthorised = { status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Sign in again.' } }) };

test('signing in again from the dialog clears every sign-in error and reads the list and the distribution again', async ({ page }) => {
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  const first = page.locator('.jcard').first();
  await expect(first).toBeVisible();
  const jobId = (await first.locator('.jid').getAttribute('title')) as string;

  // The server stops accepting the token and the refresh, as after 12 hours.
  await page.route('**/api/jobs**', (route) => route.fulfill(unauthorised));
  await page.route('**/api/audit**', (route) => route.fulfill(unauthorised));
  await page.route('**/api/auth/refresh', (route) => route.fulfill(unauthorised));
  await page.getByRole('button', { name: 'My teams' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sign in again' });
  await expect(dialog).toBeVisible();
  // The list shows the old error, and so does a distribution opened while the sign-in was over.
  await expect(page.getByRole('alert').filter({ hasText: 'Your sign-in has ended.' })).toHaveCount(1);
  await page.evaluate((id) => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = `#/status/${id}`;
  }, jobId);
  await expect(page.getByRole('alert').filter({ hasText: 'Your sign-in has ended.' })).toHaveCount(2);

  // Sign in again. Nothing says the sign-in has ended any more, and the distribution and the list are back.
  await page.unroute('**/api/jobs**');
  await page.unroute('**/api/audit**');
  await page.unroute('**/api/auth/refresh');
  await dialog.getByLabel('Password').fill(env.SEED_USER_PASSWORD as string);
  await dialog.getByRole('button', { name: 'Sign in again' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('Your sign-in has ended.')).toHaveCount(0);
  await expect(chip(page)).toBeVisible();
  await expect(page.locator('.ttable .tscroll .trow').first()).toBeVisible();
  await expect(page.getByText('Loading distributions…')).toHaveCount(0);

  // The Audit trail page recovers the same way.
  await page.route('**/api/audit**', (route) => route.fulfill(unauthorised));
  await page.route('**/api/auth/refresh', (route) => route.fulfill(unauthorised));
  await page.getByRole('button', { name: 'Audit trail' }).click();
  await expect(page.getByRole('dialog', { name: 'Sign in again' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Your sign-in has ended.' })).toHaveCount(1);
  await page.unroute('**/api/audit**');
  await page.unroute('**/api/auth/refresh');
  await page.getByRole('dialog').getByLabel('Password').fill(env.SEED_USER_PASSWORD as string);
  await page.getByRole('dialog').getByRole('button', { name: 'Sign in again' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.arow').first()).toBeVisible();
});

test('the File column is as wide as the longest file name, and Destination takes the room that is left', async ({ page }) => {
  await signIn(page, PRIYA);
  await sendFiles(page, 2, [CARDIO_IRB, CARDIO_PROTOCOL]);
  await expect(page.locator('.ttable .tscroll .trow').first()).toBeVisible();
  for (const width of [1280, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(300);
    const report = await columnReport(page, '.ttable .trow.thead', '.ttable .tscroll .trow');
    const [file, dest] = [report.columns[0]!, report.columns[1]!];
    const where = `at ${width}: ${JSON.stringify(report.columns)}`;
    expect(report.overflow, `${where}: scrolls sideways`).toBeLessThanOrEqual(1);
    expect(file.header).toBe('File');
    expect(dest.header).toBe('Destination');
    // The names here are short: the File column holds the longest one and no more than a little room.
    expect(file.width, `${where}: the File column is wider than its names`).toBeLessThanOrEqual(file.need + 32);
    expect(file.width, `${where}: the File column is cut short`).toBeGreaterThanOrEqual(file.need);
    // Destination gets what is left: more than the File column, and all of its text at 1920.
    expect(dest.width, `${where}: Destination should take the spare room`).toBeGreaterThan(file.width);
    if (width === 1920) expect(dest.width, `${where}: Destination is cut short`).toBeGreaterThanOrEqual(dest.need);
  }
});

test('a distribution cancelled part way keeps its delivered rows: counts, chip, list card and filters agree', async ({ page }) => {
  await signIn(page, PRIYA);
  await withWorkersStopped(async ({ hold, start }) => {
    const { jobId } = await sendFiles(page, 4, [CARDIO_IRB, CARDIO_PROTOCOL], hold); // 8 deliveries
    expect(await readCounts(page)).toEqual([0, 0, 0, 8]);
    // Three deliveries finish before the cancel (the page cannot make that state while the workers are stopped).
    await sql(
      "UPDATE tasks SET status = 'completed', attempt_count = 1 WHERE id IN (SELECT id FROM tasks WHERE job_id = $1 AND status = 'pending' ORDER BY id LIMIT 3)",
      [jobId],
    );
    await page.reload();
    await expect(counts(page)).toBeVisible();
    expect(await readCounts(page)).toEqual([3, 0, 0, 5]);

    await page.getByRole('button', { name: 'Cancel distribution' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel distribution' }).click();
    await expect(page.getByText(/5 deliveries cancelled\./)).toBeVisible();
    await expect(chip(page)).toHaveText('Cancelled');
    expect(await readCounts(page)).toEqual([3, 5, 0, 0]);

    // The filters carry the same numbers and show those rows.
    await page.getByRole('button', { name: /^All, 8 deliveries/ }).click();
    await expect(page.locator('.ttable .tscroll .trow')).toHaveCount(8);
    await page.getByRole('button', { name: /^Delivered, 3 deliveries/ }).click();
    await expect(page.locator('.ttable .tscroll .trow')).toHaveCount(3);
    await expect(page.locator('.ttable .code')).toHaveCount(0);
    await page.getByRole('button', { name: /^Failed, 5 deliveries/ }).click();
    await expect(page.locator('.ttable .tscroll .trow')).toHaveCount(5);
    await expect(page.locator('.ttable .code', { hasText: 'CANCELLED' })).toHaveCount(5);

    // The card in the list says the same: Cancelled, and the same bar.
    const card = page.locator('.jcard.on');
    await expect(card.locator('.status-chip')).toHaveText('Cancelled');
    await expect(card).toContainText('8 deliveries');
    // And so does a reload: nothing is recomputed differently.
    await page.reload();
    await expect(counts(page)).toBeVisible();
    await expect(chip(page)).toHaveText('Cancelled');
    expect(await readCounts(page)).toEqual([3, 5, 0, 0]);
    start();
    await page.waitForTimeout(5_000);
    expect(await readCounts(page)).toEqual([3, 5, 0, 0]); // the workers do not touch it
  });
});
