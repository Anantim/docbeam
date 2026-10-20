import { expect, test } from '@playwright/test';
import { distRow, PRIYA, signIn } from './helpers.js';

// The last round of Status polish (D-F1-18): table alignment, one toast corner, Showing N, the copy icon, the dialog backdrop.

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const unauthorised = { status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Sign in again.' } }) };

test('the list: Files and Folders are right-aligned with their headers, Status and Sent sit close', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  await expect(distRow(page).first()).toBeVisible();
  for (const name of ['Files', 'Folders']) {
    await expect(page.getByRole('columnheader', { name })).toHaveCSS('text-align', 'right');
    const index = (await page.getByRole('columnheader').allTextContents()).findIndex((t) => t.trim() === name);
    const head = (await page.getByRole('columnheader').nth(index).boundingBox())!;
    const cell = (await distRow(page).first().locator('td').nth(index).boundingBox())!;
    expect(Math.abs(head.x + head.width - (cell.x + cell.width))).toBeLessThan(2); // right edges line up
    await expect(distRow(page).first().locator('td').nth(index)).toHaveCSS('text-align', 'right');
  }
  const heads = await page.getByRole('columnheader').all();
  const status = (await heads[1]!.boundingBox())!;
  const sent = (await heads[2]!.boundingBox())!;
  expect(sent.x - (status.x + status.width)).toBeLessThan(4); // no wide gap: the columns take what they need
  expect(status.width).toBeLessThan(220);
});

test('Showing N sits beside Show more; Show more adds a page; scrolling to the end loads nothing (no infinite scroll)', async ({ page }) => {
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  await expect(distRow(page).first()).toBeVisible();
  const foot = page.locator('.list-foot');
  const shown = async (): Promise<number> => Number(/Showing (\d+)/.exec((await foot.textContent()) ?? '')?.[1]);
  const first = await shown();
  expect(first).toBe(await distRow(page).count());
  const more = page.getByRole('button', { name: 'Show more' });
  if ((await more.count()) === 0) test.skip(true, 'Priya has no more than one page of distributions here');
  await foot.scrollIntoViewIfNeeded();
  await page.evaluate(`window.scrollTo(0, document.documentElement.scrollHeight)`);
  await page.waitForTimeout(1500);
  expect(await shown()).toBe(first); // scrolling to the end does not load
  await more.click();
  await expect.poll(shown).toBeGreaterThan(first);
  expect(await shown()).toBe(await distRow(page).count());
});

test('the copy icon: shown on row hover and focus, always in the panel; it copies the link, toasts bottom-right, and does not open or close the panel', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  const row = distRow(page).first();
  await expect(row).toBeVisible();
  const jobId = (await row.locator('.dist-id').getAttribute('title')) as string;
  await expect(page.getByRole('button', { name: 'Copy link', exact: true })).toHaveCount(await distRow(page).count()); // one per row, none in the header

  const icon = row.getByRole('button', { name: 'Copy link' });
  await expect(icon).toHaveAttribute('title', 'Copy link');
  await expect(icon).toHaveCSS('opacity', '0'); // hidden until the row is hovered or focused
  await row.hover();
  await expect(icon).toHaveCSS('opacity', '1');
  await page.mouse.move(5, 5);
  await row.locator('.dist-id').focus();
  await expect(icon).toHaveCSS('opacity', '1'); // keyboard focus in the row shows it too
  await page.mouse.move(5, 5);

  // A click copies and does not open the panel.
  await row.hover();
  await icon.click();
  await expect(page.getByText('Link copied.')).toBeVisible();
  expect(await page.evaluate('navigator.clipboard.readText()')).toBe(`http://localhost:5173/#/status/${jobId}`);
  await expect(page).toHaveURL(/#\/status$/);
  await expect(page.getByRole('complementary')).toHaveCount(0);

  // The toast is in the bottom-right corner, clear of the table.
  const toast = (await page.locator('.toast').boundingBox())!;
  const view = page.viewportSize()!;
  expect(toast.x + toast.width).toBeGreaterThan(view.width - 60);
  expect(toast.y + toast.height).toBeGreaterThan(view.height - 60);

  // In the panel the icon is always there, there is no "Copy link" text button, and a click leaves the panel open.
  await row.locator('.dist-id').click();
  const panel = page.getByRole('complementary');
  const panelIcon = panel.getByRole('button', { name: 'Copy link' });
  await expect(panelIcon).toHaveCSS('opacity', '1');
  await expect(panel.getByText('Copy link', { exact: true })).toHaveCount(0);
  await page.evaluate('navigator.clipboard.writeText("")');
  await panelIcon.click();
  expect(await page.evaluate('navigator.clipboard.readText()')).toBe(`http://localhost:5173/#/status/${jobId}`);
  await expect(panel).toBeVisible();
  // Clicking the icon of the open row's own list entry does not close the panel either.
  await distRow(page, jobId.slice(0, 8)).getByRole('button', { name: 'Copy link' }).click();
  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#/status/${jobId}$`));
});

test('the dialog backdrop covers the strip where the scrollbar was: no undimmed edge on the right', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  await expect(distRow(page).first()).toBeVisible();
  await page.route('**/api/jobs**', (route) => route.fulfill(unauthorised));
  await page.route('**/api/auth/refresh', (route) => route.fulfill(unauthorised));
  await page.getByRole('button', { name: 'My teams' }).click();
  await expect(page.getByRole('dialog', { name: 'Sign in again' })).toBeVisible();
  const shot = await page.screenshot();
  // Read two pixels of the picture in the browser: the last column (where the scrollbar was) and one inside the page.
  // (The code is a string because these tests are compiled without the DOM types.)
  const [edge, inside] = (await page.evaluate(`(async () => {
    const img = new Image();
    img.src = 'data:image/png;base64,${shot.toString('base64')}';
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return [ctx.getImageData(img.width - 1, 300, 1, 1).data, ctx.getImageData(img.width - 60, 300, 1, 1).data].map((d) => [d[0], d[1], d[2]]);
  })()`)) as [number[], number[]];
  for (let i = 0; i < 3; i += 1) expect(Math.abs((edge[i] as number) - (inside[i] as number)), `channel ${i}: edge ${edge} inside ${inside}`).toBeLessThan(6);
});
