import { expect, test } from '@playwright/test';
import { addPdfs, CARDIO_IRB, jobIdOf, pickFilter, PRIYA, rgb, send, signIn, tick } from './helpers.js';

// What happens after Send (D-F1-31): success opens the new distribution on Status, failure keeps everything on Distribute,
// and Back returns to the empty Distribute page.

test('after a successful Send: Status opens on the new distribution, filters cleared, "Sent", the panel heading has the focus', async ({ page }) => {
  await signIn(page, PRIYA);
  // A filter is set on Status first, so the new row would be hidden if it were kept.
  await page.getByRole('button', { name: 'Status' }).click();
  await expect(page.locator('.dist-table tbody tr').first()).toBeVisible();
  await pickFilter(page, 'Status', 'Cancelled');
  await expect(page).toHaveURL(/#\/status\?status=cancelled$/);

  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Distribute' }).click();
  await addPdfs(page, 1, 'after');
  await tick(page, CARDIO_IRB);
  const jobId = await send(page);

  await expect(page).toHaveURL(new RegExp(`#/status/${jobId}$`)); // no filters in the address
  await expect(page.locator('.toast', { hasText: /^Sent$/ })).toBeVisible(); // the toast says just "Sent"
  // Toasts are dark, at the bottom left of the window, above everything, and never take a click (D-F1-43).
  const toast = (await page.locator('.toast', { hasText: /^Sent$/ }).boundingBox())!;
  const view = page.viewportSize()!;
  expect(toast.x, 'at the left').toBeLessThan(60);
  expect(toast.y + toast.height, 'at the bottom').toBeGreaterThan(view.height - 60);
  await expect(page.locator('.toast').first()).toHaveCSS('background-color', rgb('#101828'));
  expect(await page.evaluate(`getComputedStyle(document.querySelector('.toasts')).pointerEvents`)).toBe('none');
  expect(Number(await page.evaluate(`getComputedStyle(document.querySelector('.toasts')).zIndex`))).toBeGreaterThan(81); // above dialogs too
  const row = page.locator('.dist-table tbody tr').first();
  await expect(row).toHaveClass(/\bon\b/); // selected, at the top
  await expect(row.locator('.dist-id')).toHaveAttribute('data-job-id', jobId);
  await expect(page.getByRole('group', { name: 'Filters' }).getByRole('button', { name: 'Clear filters' })).toHaveCount(0);
  await expect(page.locator('.panel h2')).toBeFocused();

  // Distribute is empty.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Distribute' }).click();
  await expect(page.locator('.frow:not(.thead)')).toHaveCount(0);
});

test('Back after Send returns to the empty Distribute page', async ({ page }) => {
  await signIn(page, PRIYA);
  await addPdfs(page, 1, 'back');
  await tick(page, CARDIO_IRB);
  await send(page);
  await expect(page.getByRole('complementary')).toBeVisible();
  await page.goBack();
  await expect(page).not.toHaveURL(/#\/status/);
  await expect(page.getByRole('heading', { name: 'New distribution' })).toBeVisible();
  await expect(page.locator('.frow:not(.thead)')).toHaveCount(0); // nothing is left of what was sent
  await expect(page.getByText('Drop files here')).toBeVisible();
});

test('a failed Send stays on Distribute with the error and keeps the files and the folders', async ({ page }) => {
  await signIn(page, PRIYA);
  const [name] = await addPdfs(page, 1, 'fail');
  await tick(page, CARDIO_IRB);
  await page.route('**/api/jobs', (route) => (route.request().method() === 'POST' ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'PLATFORM_UNAVAILABLE', message: 'The platform is not answering. Try again in a moment.' } }) }) : route.continue()));
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send', exact: true }).click();

  await expect(page.getByRole('alert').filter({ hasText: 'The platform is not answering' })).toBeVisible();
  await expect(page).not.toHaveURL(/#\/status/); // still Distribute
  await expect(page.locator('.toast', { hasText: /^Sent$/ })).toHaveCount(0);
  await expect(page.locator('.frow', { hasText: name as string })).toHaveCount(1); // the file is still there
  await expect(page.getByRole('checkbox', { name: /IRB approvals/ })).toBeChecked(); // so is the folder
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();

  // Everything kept: the next try works.
  await page.unroute('**/api/jobs');
  const jobId = await send(page);
  expect(jobIdOf(page)).toBe(jobId);
});
