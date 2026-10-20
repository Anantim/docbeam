import { expect, test, type Locator } from '@playwright/test';
import { env } from '../integration/helpers.js';
import { CARDIO_IRB, CARDIO_PROTOCOL, chip, counts, distRow, openHistory, PRIYA, readCounts, rgb, sendFiles, signIn, sql, withWorkersStopped } from './helpers.js';

// Found on dev in the person's browser checks (D-M3-17): an old sign-in error that stayed after signing in again,
// and the counts of a distribution that was cancelled part way.

// The functions given to `evaluate` run in the browser; these tests are compiled without the DOM types.
declare function getComputedStyle(el: unknown): { color: string; backgroundColor: string };

const unauthorised = { status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Sign in again.' } }) };

test('signing in again from the dialog clears every sign-in error and reads the list and the distribution again', async ({ page }) => {
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  const first = distRow(page).first();
  await expect(first).toBeVisible();
  const jobId = (await first.locator('.dist-id').getAttribute('title')) as string;

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
  await expect(page.getByLabel('Loading distributions')).toHaveCount(0);

  // The Upload events panel recovers the same way.
  await page.route('**/api/audit**', (route) => route.fulfill(unauthorised));
  await page.route('**/api/auth/refresh', (route) => route.fulfill(unauthorised));
  await page.getByRole('button', { name: 'Upload events' }).click();
  await expect(page.getByRole('dialog', { name: 'Sign in again' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Your sign-in has ended.' })).toHaveCount(1);
  await page.unroute('**/api/audit**');
  await page.unroute('**/api/auth/refresh');
  await page.getByRole('dialog').getByLabel('Password').fill(env.SEED_USER_PASSWORD as string);
  await page.getByRole('dialog').getByRole('button', { name: 'Sign in again' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Upload events' })).toBeVisible();
});

/** The coloured parts of a progress bar, as colour to width in percent. */
async function bar(locator: Locator): Promise<Record<string, number>> {
  const parts = await locator.locator('> div').evaluateAll((els: unknown[]) =>
    els.map((el) => ({ colour: getComputedStyle(el).backgroundColor, width: (el as { style: { width: string } }).style.width })),
  );
  return Object.fromEntries(parts.map((p) => [p.colour, parseFloat(p.width)]));
}

const GREEN = rgb('#12B76A');
const RED = rgb('#F04438');
const BLUE = rgb('#2B59C3');
const GREY = rgb('#98A2B3');

test('a distribution cancelled part way: filter numbers, the bar, chips, rows and history agree, and red means failed only', async ({ page }) => {
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
    // Nothing was cancelled yet: no Cancelled filter.
    await expect(page.getByRole('button', { name: /^Cancelled,/ })).toHaveCount(0);

    await page.getByRole('button', { name: 'Cancel distribution' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel distribution' }).click();
    await expect(page.getByText(/5 deliveries cancelled\./)).toBeVisible();
    await expect(chip(page)).toHaveText('Cancelled');

    // 3 delivered, 0 failed, 5 cancelled: Cancelled is its own filter, grey, and Failed stays 0.
    expect(await readCounts(page)).toEqual([3, 0, 0, 0, 5]);
    await expect(page.locator('.tfilter', { hasText: 'Cancelled' }).locator('.tdot')).toHaveCSS('background-color', GREY);
    await expect(page.locator('.tfilter', { hasText: 'Failed' }).locator('.tdot')).toHaveCSS('background-color', RED);

    // The bar in the panel: 3 of 8 green, 5 of 8 grey, and no red or blue.
    const header = await bar(page.locator('.panel .jbar'));
    expect(header[GREEN]).toBeCloseTo(37.5, 1);
    expect(header[GREY]).toBeCloseTo(62.5, 1);
    expect(header[RED]).toBe(0);
    expect(header[BLUE]).toBe(0);
    // This distribution's row in the list says Cancelled too.
    const row = page.locator('.dist-table tbody tr.on');
    await expect(row.locator('.status-chip')).toHaveText('Cancelled');

    // The filters carry the same numbers and show those rows, with the right chips.
    await expect(page.getByRole('button', { name: 'All, 8 deliveries' })).toBeVisible();
    await page.getByRole('button', { name: 'All, 8 deliveries' }).click();
    await expect(page.locator('.ttable .tscroll .trow')).toHaveCount(8);
    await page.getByRole('button', { name: 'Completed, 3 deliveries' }).click();
    await expect(page.locator('.ttable .tscroll .trow')).toHaveCount(3);
    await expect(page.locator('.ttable .code')).toHaveCount(0);
    await page.getByRole('button', { name: 'Failed, 0 deliveries' }).click();
    await expect(page.locator('.ttable .tscroll .trow')).toHaveCount(0);
    await expect(page.getByText('No deliveries with this status.')).toBeVisible();
    await page.getByRole('button', { name: 'Cancelled, 5 deliveries' }).click();
    await expect(page.locator('.ttable .tscroll .trow')).toHaveCount(5);
    await expect(page.locator('.ttable .code', { hasText: 'CANCELLED' })).toHaveCount(5);
    const rowChips = page.locator('.ttable .tscroll .status-chip');
    await expect(rowChips).toHaveCount(5);
    for (const text of await rowChips.allTextContents()) expect(text).toBe('Cancelled');
    await expect(rowChips.first()).toHaveAttribute('title', /Nothing was delivered/);

    // The history says cancelled, never failed, for those five.
    await openHistory(page);
    const audit = page.locator('.audit-tab');
    await expect(audit).toContainText('Distribution cancelled');
    await expect(audit.getByText('Delivery cancelled', { exact: true })).toHaveCount(5);
    await expect(audit.getByText('Delivery failed', { exact: true })).toHaveCount(0);

    // A reload and the workers starting change nothing.
    await page.reload();
    await expect(counts(page)).toBeVisible();
    await expect(chip(page)).toHaveText('Cancelled');
    start();
    await page.waitForTimeout(5_000);
    expect(await readCounts(page)).toEqual([3, 0, 0, 0, 5]);
  });
});
