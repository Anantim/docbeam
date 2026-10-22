import { expect, test, type Locator } from '@playwright/test';
import { addPdfs, CARDIO_IRB, chip, clearPage, counts, openListedDistribution, PRIYA, sendFiles, signIn, tooltipOf, withWorkersStopped } from './helpers.js';

// The side panel's first row (D-F1-77): Cancel and Retry are icons just left of Close, then a thin divider; and one
// control height (--control, 36 px) for the boxes and buttons that sit beside each other.

const box = async (l: Locator) => (await l.boundingBox())!;

test('Cancel is an icon left of Close with a divider; its name is its tooltip; with no icon there is no divider', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, PRIYA);
  await withWorkersStopped(async ({ hold, start }) => {
    await sendFiles(page, 1, [CARDIO_IRB], hold); // 1 delivery, waiting: the distribution runs
    const cancel = page.getByRole('button', { name: 'Cancel distribution' });
    await expect(cancel).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry failed deliveries' })).toHaveCount(0); // nothing failed
    // Just started: All, Completed (0) and Pending; the other statuses have no tab.
    await expect(counts(page).getByRole('button')).toHaveText([/^All\s*1$/, /^Completed\s*0$/, /^Pending\s*1$/]);
    expect(await tooltipOf(page, cancel)).toBe('Cancel distribution');
    await cancel.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab'); // the keyboard moves the focus there: the tooltip shows at once (focus the app moves shows none, D-F1-81)
    await expect(page.getByRole('tooltip', { name: 'Cancel distribution' })).toHaveText('Cancel distribution');

    // 32 px square, left of the divider, which is left of Close, all on the first row.
    const c = await box(cancel);
    const divider = await box(page.locator('.panel-top .panel-divider'));
    const close = await box(page.locator('.panel-top').getByRole('button', { name: 'Close' }));
    expect(Math.round(c.width)).toBe(32);
    expect(Math.round(c.height)).toBe(32);
    expect(c.x + c.width).toBeLessThanOrEqual(divider.x + 1);
    expect(divider.x + divider.width).toBeLessThanOrEqual(close.x + 1);
    expect(Math.round(divider.width)).toBe(1);
    expect(Math.round(divider.height)).toBe(24);
    await expect(page.locator('.panel-top .panel-divider')).toHaveCSS('margin-left', '6px');
    await expect(page.locator('.panel-top .panel-divider')).toHaveCSS('margin-right', '6px');
    await expect(page.locator('.panel-actions')).toHaveCount(0); // the row of text buttons is gone
    start();
    await expect(chip(page)).toHaveText('Completed', { timeout: 90_000 });
    // Finished and nothing failed: no icon, so no divider, only Close.
    await expect(page.getByRole('button', { name: 'Cancel distribution' })).toHaveCount(0);
    await expect(page.locator('.panel-top .panel-divider')).toHaveCount(0);
    await expect(page.locator('.panel-top').getByRole('button', { name: 'Close' })).toBeVisible();
    // Everything completed: only the Completed tab, and it is the selected one.
    await expect(counts(page).getByRole('button')).toHaveCount(1);
    await expect(counts(page).getByRole('button', { name: 'Completed, 1 delivery' })).toHaveAttribute('aria-pressed', 'true');
  });
});

test('one control height: Open by ID, the deliveries filter, the Files filter, Add files and the folder filter are all 36 px', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, PRIYA);
  await addPdfs(page, 1, 'heights');
  const h = async (l: Locator) => Math.round((await box(l)).height);
  expect(await h(page.getByRole('textbox', { name: 'Filter files' })), 'Files filter').toBe(36);
  expect(await h(page.getByRole('button', { name: 'Add files' })), 'Add files').toBe(36);
  expect(await h(page.getByRole('searchbox', { name: 'Filter folders' })), 'Destinations filter').toBe(36);
  await clearPage(page);

  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Status' }).click();
  await page.getByRole('button', { name: 'Open by ID' }).click();
  expect(await h(page.getByLabel('Distribution ID or link')), 'Open by ID field').toBe(36);
  await page.getByLabel('Distribution ID or link').fill('abc');
  expect(await h(page.getByRole('button', { name: 'Open', exact: true })), 'Open button').toBe(36);
  await page.keyboard.press('Escape');
  await openListedDistribution(page);
  expect(await h(page.getByRole('textbox', { name: 'Filter deliveries' })), 'deliveries filter').toBe(36);
});
