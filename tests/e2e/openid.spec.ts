import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { PRIYA, signIn } from './helpers.js';

// The Open-by-ID box and the empty state of the Status page (found on dev, M3 browser check 13).

const NOTE = 'Paste the full distribution id or a link to it. The short 8-character id is not enough.';
const PASSWORD = 'correct-horse-battery-staple';

const openButton = (page: Page) => page.getByRole('button', { name: 'Open', exact: true });
const box = (page: Page) => page.getByLabel('Open by ID');
const notFound = (page: Page) => page.getByRole('heading', { name: 'Distribution not found' });
/** The list's own empty state (nothing sent yet, or nothing sent to my teams). */
const emptyState = (page: Page) => page.locator('.card.state');

/** A new account in no team: it has no distributions, and no one to share any with. */
async function register(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Full name').fill('E2E Newcomer');
  await page.getByLabel('Work email').fill(`e2e.${randomUUID().slice(0, 8)}@example.com`);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

test('Open is off while the box is empty or only spaces, and says why', async ({ page }) => {
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  await expect(openButton(page)).toBeDisabled();
  await expect(openButton(page)).toHaveAttribute('disabled', '');
  await expect(openButton(page)).toHaveCSS('cursor', 'not-allowed');
  await expect(openButton(page)).toHaveAttribute('title', 'Paste a distribution id or link first');
  await box(page).fill('   ');
  await expect(openButton(page)).toBeDisabled();
  // Enter in an empty box does nothing either: no note, nothing opened.
  await box(page).press('Enter');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/status$/);
  await box(page).fill('3f1c2a9e');
  await expect(openButton(page)).toBeEnabled();
});

test('a short id shows the note; typing clears it; a new Open starts without it', async ({ page }) => {
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0); // nothing shown before anyone tries
  await box(page).fill('3f1c2a9e');
  await openButton(page).click();
  await expect(page.getByRole('alert')).toHaveText(NOTE);
  await box(page).press('x');
  await expect(page.getByRole('alert')).toHaveCount(0);
  // The note is gone as soon as a new attempt starts, so it never sits beside the answer to that attempt.
  await box(page).fill('3f1c2a9e');
  await openButton(page).click();
  await expect(page.getByRole('alert')).toHaveText(NOTE);
  await box(page).fill(randomUUID());
  await openButton(page).click();
  await expect(notFound(page)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a full unknown id and a full link show only the not-found panel', async ({ page }) => {
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  const unknown = randomUUID();
  await box(page).fill(unknown);
  await openButton(page).click();
  await expect(page).toHaveURL(new RegExp(`#/status/${unknown}$`));
  await expect(notFound(page)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const another = randomUUID();
  await box(page).fill(`http://localhost:5173/#/status/${another.toUpperCase()}`);
  await openButton(page).click();
  await expect(page).toHaveURL(new RegExp(`#/status/${another}$`));
  await expect(notFound(page)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a person with no distributions sees the empty state on first load, not "not found"', async ({ page }) => {
  await register(page);
  await page.getByRole('button', { name: 'Status' }).click();
  await expect(emptyState(page)).toBeVisible();
  await expect(notFound(page)).toHaveCount(0);
  await expect(page.getByText('You have not sent a distribution yet')).toBeVisible();
  await page.getByRole('button', { name: 'My teams' }).click();
  await expect(emptyState(page)).toBeVisible();
  await expect(notFound(page)).toHaveCount(0);
});

test('signing out leaves the open distribution, so the next person does not land on it', async ({ page }) => {
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  await page.locator('.dist-table tbody tr').first().click();
  await expect(page).toHaveURL(/#\/status\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page).not.toHaveURL(/#\/status\//);
  // Someone else signs in in the same tab and opens Status: an empty state, not Priya's distribution.
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Full name').fill('E2E Next');
  await page.getByLabel('Work email').fill(`e2e.${randomUUID().slice(0, 8)}@example.com`);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.getByRole('button', { name: 'Status' }).click();
  await expect(emptyState(page)).toBeVisible();
  await expect(notFound(page)).toHaveCount(0);
});

test('the Open-by-ID box is in the same place on Mine and My teams, with or without distributions', async ({ page }) => {
  const placed = async (): Promise<{ x: number; y: number }> => {
    await expect(box(page)).toBeVisible();
    await expect(box(page)).toBeInViewport(); // not pushed below a long list
    const tabs = (await page.getByRole('group', { name: 'Whose distributions' }).boundingBox())!;
    const field = (await box(page).boundingBox())!;
    expect(Math.abs(field.y + field.height / 2 - (tabs.y + tabs.height / 2)), 'the box is in the toolbar, level with the Mine / My teams switch').toBeLessThan(24);
    return { x: Math.round(field.x), y: Math.round(field.y) };
  };

  // Priya has many distributions on Mine.
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  await expect(page.locator('.dist-table tbody tr').first()).toBeVisible();
  expect(await page.locator('.dist-table tbody tr').count()).toBeGreaterThan(2);
  const mine = await placed();
  await page.getByRole('button', { name: 'My teams' }).click();
  expect(await placed()).toEqual(mine);
  await page.getByRole('button', { name: 'Sign out' }).click();

  // A person with none: the list is empty on both tabs.
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Full name').fill('E2E Empty');
  await page.getByLabel('Work email').fill(`e2e.${randomUUID().slice(0, 8)}@example.com`);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.getByRole('button', { name: 'Status' }).click();
  await expect(page.locator('.dist-table tbody tr')).toHaveCount(0);
  expect(await placed()).toEqual(mine);
  await page.getByRole('button', { name: 'My teams' }).click();
  expect(await placed()).toEqual(mine);
});
