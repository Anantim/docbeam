import { expect, test, type Page } from '@playwright/test';
import { addPdfs, CARDIO_IRB, ONC_ETHICS, PRIYA, RAJ, removeSeeded, seedJob, signIn } from './helpers.js';

// The main screens at the three widths of the extra Playwright projects (phone 375, tablet 768, desktop 1440): the page never
// scrolls sideways, and what must be reachable is inside the window (D-F1-78). The projects set the width; this spec runs in all of them.

const NEURO = 'Neuro / NEURO-204 Regulatory / Ethics committee';

/** The page is not wider than the window. (A strip may scroll inside its own box; the page may not.) */
async function noSidewaysScroll(page: Page, where: string): Promise<void> {
  const over = (await page.evaluate('document.documentElement.scrollWidth - window.innerWidth')) as number;
  expect(over, `${where}: the page is ${over}px wider than the window`).toBeLessThanOrEqual(1);
  const body = (await page.evaluate('document.body.scrollWidth - window.innerWidth')) as number;
  expect(body, `${where}: the body is ${body}px wider than the window`).toBeLessThanOrEqual(1);
}

/** Every one of these is inside the window, left to right. */
async function insideWindow(page: Page, selectors: string[], where: string): Promise<void> {
  const width = page.viewportSize()!.width;
  for (const selector of selectors) {
    const box = await page.locator(selector).first().boundingBox();
    expect(box, `${where}: ${selector} is not on the page`).not.toBeNull();
    expect(box!.x, `${where}: ${selector} starts left of the window`).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width, `${where}: ${selector} ends right of the window`).toBeLessThanOrEqual(width + 1);
  }
}

test('sign-in', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await noSidewaysScroll(page, 'sign-in');
  await insideWindow(page, ['#em', '#pw', 'button[type="submit"]'], 'sign-in');
  // A refused sign-in shows the note: it fits too.
  await page.getByLabel('Work email').fill('nobody@example.com');
  await page.getByLabel('Password', { exact: true }).fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await noSidewaysScroll(page, 'sign-in with a note');
  await insideWindow(page, ['.notice'], 'sign-in with a note');
});

test('Distribute: empty, with files and a note, and with the folders open', async ({ page }) => {
  await signIn(page, PRIYA);
  await expect(page.getByRole('heading', { name: 'New distribution' })).toBeVisible();
  await noSidewaysScroll(page, 'Distribute, empty');
  await addPdfs(page, 2, 'width');
  await page.getByLabel('Choose files').setInputFiles([{ name: 'setup.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') }]);
  await expect(page.getByText('1 file not added.')).toBeVisible();
  await noSidewaysScroll(page, 'Distribute, with files and a note');
  await insideWindow(page, ['.files .card-head', '.sendbar-row', 'button:has-text("Send")'], 'Distribute');
  await page.getByRole('button', { name: 'Expand Cardio', exact: true }).click();
  await noSidewaysScroll(page, 'Distribute, folders open');
  await page.getByRole('button', { name: 'Clear' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear' }).click();
});

test('Status with the panel as the sender, and as a team member', async ({ page }) => {
  await signIn(page, PRIYA);
  const jobId = await seedJob(page, ['width-note.pdf'], [CARDIO_IRB, ONC_ETHICS, NEURO]);
  try {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Status' }).click();
    await expect(page.locator('.dist-table tbody tr:not(.sk-row)').first()).toBeVisible();
    await noSidewaysScroll(page, 'Status list');
    await page.locator('tr', { has: page.locator(`[data-job-id="${jobId}"]`) }).locator('.dist-id').click();
    await expect(page.getByRole('complementary')).toBeVisible();
    await expect(page.locator('.tfilters')).toBeVisible();
    await noSidewaysScroll(page, 'the panel as the sender');
    await insideWindow(page, ['.panel-top .panel-tools button[aria-label="Close"]', '.panel-section-head .deliveries-filter', '.tfilters'], 'the panel as the sender');
    await page.getByRole('button', { name: 'Open by ID' }).click();
    await noSidewaysScroll(page, 'Open by ID open');
    await insideWindow(page, ['.openid-card'], 'Open by ID open');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Sign out' }).click();

    // A team member with 3 teams: the panel's "Showing only deliveries to" part is on its own line below 640 px, as one unit.
    await signIn(page, RAJ);
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Status' }).click();
    await page.locator('tr', { has: page.locator(`[data-job-id="${jobId}"]`) }).locator('.dist-id').click();
    await expect(page.locator('.panel-note')).toBeVisible();
    await noSidewaysScroll(page, 'the panel as a team member');
    await insideWindow(page, ['.panel-note', '.panel-lead'], 'the panel as a team member');
    const width = page.viewportSize()!.width;
    const lead = (await page.locator('.panel-lead').boundingBox())!;
    const note = (await page.locator('.panel-note').boundingBox())!;
    if (width < 640) expect(note.y, 'the note is on its own line below the time').toBeGreaterThan(lead.y + lead.height - 2);
    else expect(Math.abs(note.y + note.height / 2 - (lead.y + lead.height / 2)), 'the note shares the line with the time').toBeLessThan(14);
  } finally {
    await removeSeeded(jobId);
  }
});
