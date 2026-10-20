import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { newAccount, PRIYA, signIn } from './helpers.js';

// "Open by ID": a small icon button on the Status page that opens a card with one field (D-F1-15), and the
// empty state of the Status page (found on dev, M3 browser check 13).

const NOTE = 'Paste the full distribution id or a link to it. The short 8-character id is not enough.';

const trigger = (page: Page) => page.getByRole('button', { name: 'Open by ID' });
const card = (page: Page) => page.getByRole('form', { name: 'Open a distribution by ID' });
const box = (page: Page) => card(page).getByLabel('Distribution ID or link');
const openButton = (page: Page) => card(page).getByRole('button', { name: 'Open', exact: true });
const notFound = (page: Page) => page.getByRole('heading', { name: 'Distribution not found' });
/** The list's own empty state (nothing sent yet, or nothing sent to my teams). */
const emptyState = (page: Page) => page.locator('.card.state');

async function openCard(page: Page): Promise<void> {
  await trigger(page).click();
  await expect(box(page)).toBeFocused();
}

test('there is no wide paste box: a small icon button opens a one-field card, and Esc closes it', async ({ page }) => {
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  await expect(page.getByText('Paste a distribution id or link')).toHaveCount(0);
  await expect(card(page)).toHaveCount(0);
  const size = (await trigger(page).boundingBox())!;
  expect(size.width).toBeLessThan(60);
  await openCard(page);
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(card(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
  // A click outside closes it too.
  await openCard(page);
  await page.getByRole('heading', { name: 'Distributions' }).click();
  await expect(card(page)).toHaveCount(0);
});

test('Open is off while the field is empty or only spaces, and says why', async ({ page }) => {
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  await openCard(page);
  await expect(openButton(page)).toBeDisabled();
  await expect(openButton(page)).toHaveCSS('cursor', 'not-allowed');
  await expect(openButton(page)).toHaveAttribute('title', 'Paste a distribution id or link first');
  await box(page).fill('   ');
  await expect(openButton(page)).toBeDisabled();
  // Enter in an empty field does nothing either: no note, nothing opened.
  await box(page).press('Enter');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/status$/);
  await box(page).fill('3f1c2a9e');
  await expect(openButton(page)).toBeEnabled();
});

test('a short id shows the note; typing clears it; a new Open starts without it', async ({ page }) => {
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  await openCard(page);
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
  await expect(card(page)).toHaveCount(0); // it closed on opening
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a full unknown id and a full link show only the not-found panel', async ({ page }) => {
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  const unknown = randomUUID();
  await openCard(page);
  await box(page).fill(unknown);
  await openButton(page).click();
  await expect(page).toHaveURL(new RegExp(`#/status/${unknown}$`));
  await expect(notFound(page)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const another = randomUUID();
  await openCard(page);
  await box(page).fill(`http://localhost:5173/#/status/${another.toUpperCase()}`);
  await box(page).press('Enter');
  await expect(page).toHaveURL(new RegExp(`#/status/${another}$`));
  await expect(notFound(page)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a person with no distributions sees the empty state on first load, not "not found"', async ({ page }) => {
  await newAccount(page);
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
  await newAccount(page, 'E2E Next');
  await page.getByRole('button', { name: 'Status' }).click();
  await expect(emptyState(page)).toBeVisible();
  await expect(notFound(page)).toHaveCount(0);
});

test('the Open by ID button is in the same place on every filter, with or without distributions', async ({ page }) => {
  const placed = async (): Promise<{ x: number; y: number }> => {
    await expect(trigger(page)).toBeVisible();
    await expect(trigger(page)).toBeInViewport(); // not pushed below a long list
    const at = (await trigger(page).boundingBox())!;
    return { x: Math.round(at.x), y: Math.round(at.y) };
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
  await newAccount(page, 'E2E Empty');
  await page.getByRole('button', { name: 'Status' }).click();
  await expect(page.locator('.dist-table tbody tr')).toHaveCount(0);
  expect(await placed()).toEqual(mine);
  await page.getByRole('button', { name: 'My teams' }).click();
  expect(await placed()).toEqual(mine);
});
