import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { newAccount, openListedDistribution, pickFilter, PRIYA, removeSeeded, seedJob, signIn, tooltipOf } from './helpers.js';

// "Open by ID": a small icon button on the Status page that opens a card with one field (D-F1-15), and the
// empty state of the Status page (found on dev, M3 browser check 13).

const NOTE = 'Enter the 8-character ID from the list, the full ID, or a link.';

test('Open by ID on another distribution, and a link to one, scroll its row into view and highlight it (D-F1-74)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, PRIYA);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Status' }).click();
  const rows = page.locator('.dist-table tbody tr [data-job-id]');
  await expect(rows.nth(15)).toBeAttached(); // at least 16 distributions are loaded
  const jobId = (await rows.nth(15).getAttribute('data-job-id')) as string;
  const rowId = page.locator(`[data-job-id="${jobId}"]`);
  await expect(rowId).not.toBeInViewport(); // the 16th row is below the visible part of the list

  // The highlight lasts one second, and a slow machine can look after it has gone: a watcher in the page notes that it came.
  await page.evaluate(`window.__sawFresh = false; new MutationObserver(() => {
    if (document.querySelector('.dist-table tbody tr.fresh')) window.__sawFresh = true;
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });`);
  await trigger(page).click();
  await box(page).fill(jobId.slice(0, 8)); // the 8 characters the list shows
  await box(page).press('Enter');
  await expect(page).toHaveURL(new RegExp(`#/status/${jobId}$`));
  await expect(rowId).toBeInViewport(); // the list scrolled to it
  const tr = page.locator('tr', { has: rowId });
  await expect(tr).toHaveClass(/\bon\b/); // selected
  await expect.poll(() => page.evaluate('window.__sawFresh')).toBe(true); // and highlighted for a second
  await expect(tr).not.toHaveClass(/\bfresh\b/, { timeout: 3000 });

  // A link: the same distribution opened by the address, with the list scrolled away from it first.
  await page.getByRole('button', { name: 'Close' }).click();
  await page.evaluate(`document.querySelector('.dist-scroll').scrollTop = 0`);
  await page.goto(`/#/status/${jobId}`);
  await page.reload();
  await expect(page.getByRole('complementary')).toBeVisible();
  await expect(page.locator(`[data-job-id="${jobId}"]`)).toBeInViewport();
});

test('Open by ID on the distribution that is already open closes the card, scrolls its row into view and highlights it for a second (D-F1-51)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, PRIYA);
  const jobId = await seedJob(page, ['One.pdf'], ['Cardio / CARDIO-301 Regulatory / IRB approvals']);
  try {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Status' }).click();
    const rowId = page.locator(`[data-job-id="${jobId}"]`);
    await rowId.click(); // open it: the newest distribution, at the top of the list
    await expect(page.getByRole('complementary')).toBeVisible();
    await page.evaluate(`document.querySelector('.dist-scroll').scrollTop = 1500`); // the row is now above the visible part of the list
    await expect(rowId).not.toBeInViewport();

    await trigger(page).click();
    await box(page).fill(jobId);
    await box(page).press('Enter');
    await expect(card(page)).toHaveCount(0); // the popover is closed
    await expect(rowId).toBeInViewport(); // its row is scrolled into view
    const tr = page.locator('tr', { has: rowId });
    await expect(tr).toHaveClass(/\bfresh\b/); // and highlighted, as a just-sent row is
    await expect(tr).not.toHaveClass(/\bfresh\b/, { timeout: 3000 }); // the highlight fades out after a second
    await expect(page).toHaveURL(new RegExp(`#/status/${jobId}$`)); // nothing else changed: the same distribution is open
    await expect(page.getByRole('complementary')).toBeVisible();
  } finally {
    await removeSeeded(jobId);
  }
});

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
  expect(await tooltipOf(page, openButton(page))).toBe('Enter a distribution ID or link first');
  await box(page).fill('   ');
  await expect(openButton(page)).toBeDisabled();
  // Enter in an empty field does nothing either: no note, nothing opened.
  await box(page).press('Enter');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/status$/);
  await box(page).fill('3f1c2a');
  await expect(openButton(page)).toBeEnabled();
});

test('the 8 characters from the list open the distribution; an unknown one and a bad one say so; typing clears the note (D-F1-32)', async ({ page }) => {
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  await expect(page.locator('.dist-table tbody tr').first()).toBeVisible();
  const shortId = (await page.locator('.dist-table tbody tr .dist-id').nth(2).textContent())!.trim(); // as the list shows it
  expect(shortId).toMatch(/^[0-9a-f]{8}$/);
  await openCard(page);
  await expect(page.getByRole('alert')).toHaveCount(0); // nothing shown before anyone tries
  await expect(box(page)).toHaveAttribute('placeholder', 'Distribution ID or link');

  // Bad input: neither 8 characters, a full id nor a link.
  await box(page).fill('3f1c2a');
  await openButton(page).click();
  await expect(page.getByRole('alert')).toHaveText(NOTE);
  await box(page).press('x');
  await expect(page.getByRole('alert')).toHaveCount(0); // typing clears the note
  // 8 characters that match nothing the person can see.
  await box(page).fill('00000000');
  await openButton(page).click();
  await expect(page.getByRole('alert')).toHaveText('No distribution with that ID that you can see.');
  await expect(page).toHaveURL(/#\/status$/);

  // The 8 characters of a row: it opens (one match), in upper case too.
  await box(page).fill(shortId.toUpperCase());
  await openButton(page).click();
  await expect(page).toHaveURL(new RegExp(`#/status/${shortId}-`));
  await expect(page.getByRole('complementary')).toBeVisible();
  await expect(card(page)).toHaveCount(0); // it closed on opening

  // A full unknown id still gets the not-found panel.
  await openCard(page);
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
  await expect(page.getByText('No distributions yet')).toBeVisible();
  await pickFilter(page, 'Sender', 'Me'); // with a filter set the empty list says no distribution matches
  await expect(page.getByText('No distribution matches these filters')).toBeVisible();
  await expect(notFound(page)).toHaveCount(0);
});

test('signing out leaves the open distribution, so the next person does not land on it', async ({ page }) => {
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  await openListedDistribution(page);
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

  // Priya has many distributions.
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  await expect(page.locator('.dist-table tbody tr').first()).toBeVisible();
  expect(await page.locator('.dist-table tbody tr').count()).toBeGreaterThan(2);
  const full = await placed();
  await pickFilter(page, 'Sender', 'Me');
  expect(await placed()).toEqual(full);
  await page.getByRole('button', { name: 'Sign out' }).click();

  // A person with none: the list is empty, with and without a filter.
  await newAccount(page, 'E2E Empty');
  await page.getByRole('button', { name: 'Status' }).click();
  await expect(page.locator('.dist-table tbody tr')).toHaveCount(0);
  expect(await placed()).toEqual(full);
  await pickFilter(page, 'Sent', 'Today');
  expect(await placed()).toEqual(full);
});
