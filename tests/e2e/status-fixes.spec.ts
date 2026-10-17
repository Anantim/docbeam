import { expect, test, type Locator, type Page } from '@playwright/test';
import { env } from '../integration/helpers.js';
import { CARDIO_IRB, CARDIO_PROTOCOL, chip, columnReport, counts, PRIYA, readCounts, rgb, sendFiles, signIn, sql, withWorkersStopped } from './helpers.js';

// Found on dev in the person's browser checks (D-M3-17): an old sign-in error that stayed after signing in again,
// a File column that took a third of the table, and the counts of a distribution that was cancelled part way.

// The functions given to `evaluate` run in the browser; these tests are compiled without the DOM types.
declare function getComputedStyle(el: unknown): { color: string; backgroundColor: string };

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

/** Each tile of the counts panel by its label, with its colour. */
async function tiles(page: Page): Promise<Record<string, { n: number; colour: string }>> {
  const out: Record<string, { n: number; colour: string }> = {};
  const all = counts(page).locator('> div');
  for (let i = 0; i < (await all.count()); i++) {
    const tile = all.nth(i);
    const n = tile.locator('.n');
    out[(await tile.locator('.lead').textContent()) as string] = { n: Number(await n.textContent()), colour: await n.evaluate((el: unknown) => getComputedStyle(el).color) };
  }
  return out;
}

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

test('a distribution cancelled part way: tiles, both bars, chips, filters, rows and audit agree, and red means failed only', async ({ page }) => {
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
    // Nothing was cancelled yet: no Cancelled tile, no Cancelled filter.
    expect(Object.keys(await tiles(page))).toEqual(['Delivered', 'Failed', 'In progress', 'Waiting']);
    await expect(page.getByRole('button', { name: /^Cancelled,/ })).toHaveCount(0);

    await page.getByRole('button', { name: 'Cancel distribution' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel distribution' }).click();
    await expect(page.getByText(/5 deliveries cancelled\./)).toBeVisible();
    await expect(chip(page)).toHaveText('Cancelled');

    // The tiles: 3 delivered, 0 failed, 5 cancelled. Failed is not red-with-5; Cancelled is grey, not the red of Failed.
    const t = await tiles(page);
    expect(Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.n]))).toEqual({ Delivered: 3, Failed: 0, 'In progress': 0, Waiting: 0, Cancelled: 5 });
    expect(t['Cancelled']!.colour).not.toBe(t['Failed']!.colour);
    expect(t['Cancelled']!.colour).toBe(rgb('#667085'));
    expect(t['Failed']!.colour).toBe(rgb('#B42318'));

    // The bar in the header: 3 of 8 green, 5 of 8 grey, and no red or blue.
    const header = await bar(page.locator('.jbar.thick'));
    expect(header[GREEN]).toBeCloseTo(37.5, 1);
    expect(header[GREY]).toBeCloseTo(62.5, 1);
    expect(header[RED]).toBe(0);
    expect(header[BLUE]).toBe(0);
    // The bar on this distribution's card in the list: the same.
    const card = page.locator('.jcard.on');
    await expect(card.locator('.status-chip')).toHaveText('Cancelled');
    await expect(card).toContainText('8 deliveries');
    const listBar = await bar(card.locator('.jbar'));
    expect(listBar[GREEN]).toBeCloseTo(37.5, 1);
    expect(listBar[GREY]).toBeCloseTo(62.5, 1);
    expect(listBar[RED]).toBe(0);

    // The filters carry the same numbers and show those rows, with the right chips.
    await expect(page.getByRole('button', { name: 'All, 8 deliveries' })).toBeVisible();
    await page.getByRole('button', { name: 'All, 8 deliveries' }).click();
    await expect(page.locator('.ttable .tscroll .trow')).toHaveCount(8);
    await page.getByRole('button', { name: 'Delivered, 3 deliveries' }).click();
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

    // The Audit tab says cancelled, never failed, for those five.
    await page.getByRole('tab', { name: 'Audit' }).click();
    const audit = page.locator('.audit-tab');
    await expect(audit).toContainText('Distribution cancelled');
    await expect(audit.getByText('Delivery cancelled', { exact: true })).toHaveCount(5);
    await expect(audit.getByText('Delivery failed', { exact: true })).toHaveCount(0);
    await page.getByRole('tab', { name: /^Deliveries/ }).click();

    // A reload and the workers starting change nothing.
    await page.reload();
    await expect(counts(page)).toBeVisible();
    await expect(chip(page)).toHaveText('Cancelled');
    start();
    await page.waitForTimeout(5_000);
    expect(Object.fromEntries(Object.entries(await tiles(page)).map(([k, v]) => [k, v.n]))).toEqual({ Delivered: 3, Failed: 0, 'In progress': 0, Waiting: 0, Cancelled: 5 });
  });
});
