import { expect, test, type Locator, type Page } from '@playwright/test';
import { addPdfs, CARDIO_DELEGATION, CARDIO_IRB, CARDIO_PROTOCOL, ONC_ETHICS, PRIYA, removeSeeded, seedJob, signIn, tick } from './helpers.js';

// The count link and its popover (D-F1-42, D-F1-41), tried in a real browser on Distribute and on Status: hover opens it
// after 300 ms and it stays while the pointer is on the link or the panel; it is drawn on the page body and kept inside
// the window; a click or Enter pins it; Esc, a click outside, or the link scrolling out of view closes it; a list of more
// than 15 has a "Filter…" box that pins it.

const CARDIO_TRAINING = 'Cardio / CARDIO-301 Site files / Training records';
const ONC_CVS = 'Oncology / ONC-118 Regulatory / Investigator CVs';
const ONC_TEMPS = 'Oncology / ONC-118 Pharmacy / Temperature logs';
const CARDIO_2026 = 'Cardio / CARDIO-301 Regulatory / Protocol amendments / 2026';
const FOLDERS = [CARDIO_IRB, CARDIO_PROTOCOL, CARDIO_2026, CARDIO_DELEGATION, CARDIO_TRAINING, ONC_ETHICS, ONC_CVS, ONC_TEMPS];

const centre = async (locator: Locator): Promise<{ x: number; y: number }> => {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const inside = async (page: Page, panel: Locator): Promise<void> => {
  const box = (await panel.boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.x, 'inside on the left').toBeGreaterThanOrEqual(7);
  expect(box.y, 'inside at the top').toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width, 'inside on the right').toBeLessThanOrEqual(view.width - 7);
  expect(box.y + box.height, 'inside at the bottom').toBeLessThanOrEqual(view.height + 1);
};

test('the count link on Distribute: opens after 300 ms, stays for the link and the panel, pinned by a click, closed by Esc or a click outside', async ({ page }) => {
  await signIn(page, PRIYA);
  const [name] = await addPdfs(page, 1, 'popscroll');
  for (const path of FOLDERS) await tick(page, path);
  const more = page.locator('.frow', { hasText: name as string }).getByRole('button', { name: /^Show the \d+ folders of/ });
  const panel = page.getByRole('dialog', { name: /^Folders of/ });
  await more.scrollIntoViewIfNeeded();

  // Hover: nothing before 300 ms, open after it.
  await more.hover();
  await page.waitForTimeout(120);
  await expect(panel, 'it should not open before 300 ms').toHaveCount(0);
  await expect(panel).toBeVisible();
  // It is on the page body, below the link with no gap, and inside the window.
  expect(await panel.evaluate((el: unknown) => (el as { parentElement: { tagName: string } }).parentElement.tagName)).toBe('BODY');
  const link = (await more.boundingBox())!;
  const open = (await panel.boundingBox())!;
  expect(Math.abs(open.y - (link.y + link.height)) < 2 || Math.abs(open.y + open.height - link.y) < 2, 'next to the link, below or above it').toBe(true);
  await inside(page, panel);

  // The pointer moves into the panel, slowly, and it stays open past the close delay.
  const target = await centre(panel.locator('.popover-list'));
  await page.mouse.move(target.x, target.y, { steps: 25 });
  await page.waitForTimeout(600);
  await expect(panel, 'closed while the pointer was in it').toBeVisible();
  expect(await panel.locator('.popover-filter').count(), 'eight folders: no filter box').toBe(0);

  // Leaving both closes a hover after 200 ms.
  await page.mouse.move(5, 5, { steps: 5 });
  await expect(panel).toHaveCount(0);

  // A click pins it; the pointer can go anywhere. Esc closes it and the focus is back on the link.
  await more.click();
  await page.mouse.move(5, 5, { steps: 5 });
  await page.waitForTimeout(600);
  await expect(panel, 'a click did not pin it').toBeVisible();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(more).toBeFocused();

  // A click outside closes a pinned one.
  await more.click();
  await expect(panel).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(panel).toHaveCount(0);

  // The keyboard: Tab onto the link opens it, Enter pins it, Esc closes it.
  await more.focus();
  await expect(panel).toBeVisible();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(more).toBeFocused();
});

test('on Status: a long "+N" has a Filter… box that pins it, scrolls inside, stays inside the window near the right edge, and closes when its link scrolls out of view', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await signIn(page, PRIYA);
  const names = Array.from({ length: 40 }, (_, i) => `${i % 2 === 0 ? 'Consent' : 'Lab results'} ${String(i + 1).padStart(2, '0')}.pdf`);
  const folders = Array.from({ length: 5 }, (_, i) => `Cardio / CARDIO-301 Regulatory / Binder with a long name ${i + 1} / Folder ${i + 1}`);
  const jobId = await seedJob(page, names, folders);
  try {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Status' }).click();
    const row = page.locator('tr', { has: page.locator(`[data-job-id="${jobId}"]`) });
    await expect(row).toBeVisible();

    // Files: "+39". Hover, then the box above 15 items, then filtering in any case.
    const files = row.getByRole('button', { name: /^Show 39 more files/ });
    await expect(files).toHaveText('+39');
    await files.hover();
    const panel = page.getByRole('dialog', { name: /^More files of/ });
    await expect(panel).toBeVisible();
    const box = panel.getByRole('textbox');
    await expect(box).toBeVisible();
    await box.click(); // clicking the box pins it
    await page.mouse.move(5, 5, { steps: 5 });
    await page.waitForTimeout(500);
    await expect(panel, 'the box did not pin it').toBeVisible();
    await box.fill('LAB RESULTS 1');
    const listed = await panel.locator('li').allTextContents();
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.every((t) => t.toLowerCase().includes('lab results 1'))).toBe(true);
    await box.fill('zzz');
    await expect(panel.getByText('No matches')).toBeVisible();
    await page.keyboard.press('Escape'); // empties the box
    await expect(box).toHaveValue('');
    await expect(panel).toBeVisible();
    await inside(page, panel);
    // The list scrolls inside the panel and the panel stays.
    await panel.locator('.popover-list').evaluate((el: unknown) => ((el as { scrollTop: number }).scrollTop = 200));
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);

    // Destinations: the first two names and "+3", with full paths in the popover, near the right edge of the card.
    const dest = row.getByRole('button', { name: /^Show 3 more folders/ });
    await expect(dest).toHaveText('+3');
    await dest.click();
    const folderPanel = page.getByRole('dialog', { name: /^More folders of/ });
    await expect(folderPanel).toBeVisible();
    expect(await folderPanel.locator('li').allTextContents()).toEqual(folders.slice(2));
    expect(await folderPanel.getByRole('textbox').count(), '3 folders: no box').toBe(0);
    await inside(page, folderPanel);
    await page.keyboard.press('Escape');

    // The link scrolls out of the list's scroll area: the panel closes.
    await files.hover();
    await expect(panel).toBeVisible();
    await page.evaluate("document.querySelector('.dist-scroll').scrollTop = 100000");
    await expect(panel).toHaveCount(0);
  } finally {
    await removeSeeded(jobId);
  }
});
