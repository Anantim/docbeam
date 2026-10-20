import { expect, test, type Locator } from '@playwright/test';
import { env } from '../integration/helpers.js';
import { CARDIO_IRB, CARDIO_PROTOCOL, chip, counts, distRow, jobIdOf, pickFilter, PRIYA, readCounts, rgb, sendFiles, signIn, sql, withWorkersStopped } from './helpers.js';

// Found on dev in the person's browser checks (D-M3-17): an old sign-in error that stayed after signing in again,
// and the counts of a distribution that was cancelled part way.

// The functions given to `evaluate` run in the browser; these tests are compiled without the DOM types.
declare function getComputedStyle(el: unknown): { color: string; backgroundColor: string };

const unauthorised = { status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Sign in again.' } }) };

test('while the sign-in is over the page behind the dialog shows no error, and after signing in again the waiting requests are sent', async ({ page }) => {
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  const first = distRow(page).first();
  await expect(first).toBeVisible();
  const jobId = (await first.locator('.dist-id').getAttribute('title')) as string;

  // The server stops accepting the token and the refresh, as after 12 hours.
  await page.route('**/api/jobs**', (route) => route.fulfill(unauthorised));
  await page.route('**/api/auth/refresh', (route) => route.fulfill(unauthorised));
  await pickFilter(page, 'Sender', 'Me'); // a filter reads the list again: this call meets the 401
  const dialog = page.getByRole('dialog', { name: 'Sign in again' });
  await expect(dialog).toBeVisible();
  await page.evaluate((id) => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = `#/status/${id}`;
  }, jobId);
  // Nothing behind the dialog says the sign-in has ended or that something could not be loaded: the requests wait (D-F1-14).
  await page.waitForTimeout(500);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText(/could not be loaded/i)).toHaveCount(0);

  // Sign in again. The requests that waited are sent again: the distribution and the list are back.
  await page.unroute('**/api/jobs**');
  await page.unroute('**/api/auth/refresh');
  await dialog.getByLabel('Password').fill(env.SEED_USER_PASSWORD as string);
  await dialog.getByRole('button', { name: 'Sign in again' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(chip(page)).toBeVisible();
  await expect(page.locator('.ttable .tscroll .trow').first()).toBeVisible();
  await expect(page.getByLabel('Loading distributions')).toHaveCount(0);
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

test('a distribution cancelled part way: filter numbers, the bar, chips and rows agree, and red means failed only', async ({ page }) => {
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

    // A reload and the workers starting change nothing.
    await page.reload();
    await expect(counts(page)).toBeVisible();
    await expect(chip(page)).toHaveText('Cancelled');
    start();
    await page.waitForTimeout(5_000);
    expect(await readCounts(page)).toEqual([3, 0, 0, 0, 5]);
  });
});

test('the badge on the Status tab counts what is running and goes when the distribution finishes (D-F1-15)', async ({ page }) => {
  await signIn(page, PRIYA);
  const badge = page.locator('.tab-badge');
  const shown = async (): Promise<number> => ((await badge.count()) === 0 ? 0 : Number(/\d+/.exec((await badge.first().textContent()) ?? '0')?.[0] ?? 0));
  await page.getByRole('button', { name: 'Status' }).click();
  await expect(distRow(page).first()).toBeVisible();
  const before = await shown(); // other tests may have left distributions running for Priya
  await withWorkersStopped(async ({ hold, start }) => {
    await sendFiles(page, 1, [CARDIO_IRB], hold);
    await expect.poll(shown).toBe(before + 1);
    start();
    await expect(chip(page)).toHaveText('Completed', { timeout: 90_000 });
    await expect.poll(shown, { timeout: 15_000 }).toBe(before); // well before the 30 s refresh of the list
  });
});

test('a distribution of 6 deliveries shows all 6 in the panel on a laptop screen (D-F1-15)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, PRIYA);
  const { jobId } = await sendFiles(page, 3, [CARDIO_IRB, CARDIO_PROTOCOL]); // 3 files x 2 folders
  await expect(chip(page)).toHaveText('Completed', { timeout: 90_000 });
  expect(jobIdOf(page)).toBe(jobId);
  await expect(page.getByRole('button', { name: /^All, 6 deliveries/ })).toBeVisible();
  const rows = page.locator('.ttable .tscroll .trow');
  await expect(rows).toHaveCount(6);
  const box = (await page.getByRole('region', { name: /Delivery rows/ }).boundingBox())!;
  for (let i = 0; i < 6; i += 1) {
    const r = (await rows.nth(i).boundingBox())!;
    expect(r.y + r.height, `row ${i + 1} ends inside the box`).toBeLessThanOrEqual(box.y + box.height + 1);
  }
});

test('the sign-in dialog covers the whole viewport on a long page scrolled down, and the page behind does not scroll (D-F1-14)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  await expect(distRow(page).first()).toBeVisible();
  await page.evaluate(`window.scrollTo(0, document.documentElement.scrollHeight)`);
  await page.route('**/api/jobs**', (route) => route.fulfill(unauthorised));
  await page.route('**/api/auth/refresh', (route) => route.fulfill(unauthorised));
  // Open the Sender menu and choose "Me" without scrolling the page to them (a click would).
  await page.getByRole('group', { name: 'Filters' }).getByRole('button', { name: /^Sender/ }).dispatchEvent('click');
  await page.getByRole('menuitemradio', { name: 'Me', exact: true }).dispatchEvent('click');
  const dialog = page.getByRole('dialog', { name: 'Sign in again' });
  await expect(dialog).toBeVisible();
  const viewport = page.viewportSize()!;
  const overlay = (await page.locator('.overlay').boundingBox())!;
  expect(overlay).toMatchObject({ x: 0, y: 0, width: viewport.width, height: viewport.height });
  const scrollBefore = await page.evaluate(`window.scrollY`);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(200);
  expect(await page.evaluate(`window.scrollY`)).toBe(scrollBefore);
  // The dialog is inside the viewport, and the label sits apart from the text above it and close to its field.
  const d = (await dialog.boundingBox())!;
  expect(d.y).toBeGreaterThanOrEqual(0);
  expect(d.y + d.height).toBeLessThanOrEqual(viewport.height);
  const gap = async (a: string, b: string): Promise<number> => {
    const top = (await dialog.locator(a).boundingBox())!;
    const next = (await dialog.locator(b).boundingBox())!;
    return next.y - (top.y + top.height);
  };
  expect(await gap('.dialog-body', 'label')).toBeGreaterThan(await gap('label', 'input'));
});
