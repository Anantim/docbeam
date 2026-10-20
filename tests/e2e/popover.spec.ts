import { expect, test, type Locator, type Page } from '@playwright/test';
import { addPdfs, CARDIO_DELEGATION, CARDIO_IRB, CARDIO_PROTOCOL, chip, ONC_ETHICS, PRIYA, send, signIn, tick } from './helpers.js';

// Every "+N" popover behaves the same (D-M3-2, D-M3-17): open on hover and stay open while the pointer is on the
// chip or the panel, with no gap between them; scroll inside without closing; a click pins it; Esc and a click
// outside close it; the keyboard opens it. Tried on the Documents table of Distribute and on the "Sent to" header
// of Status, with a list long enough to scroll.

const CARDIO_TRAINING = 'Cardio / CARDIO-301 Site files / Training records';
const ONC_CVS = 'Oncology / ONC-118 Regulatory / Investigator CVs';
const ONC_TEMPS = 'Oncology / ONC-118 Pharmacy / Temperature logs';
const CARDIO_2026 = 'Cardio / CARDIO-301 Regulatory / Protocol amendments / 2026';
const FOLDERS = [CARDIO_IRB, CARDIO_PROTOCOL, CARDIO_2026, CARDIO_DELEGATION, CARDIO_TRAINING, ONC_ETHICS, ONC_CVS, ONC_TEMPS];

const centre = async (locator: Locator): Promise<{ x: number; y: number }> => {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

async function exercise(page: Page, more: Locator, where: string, panelName: RegExp = /more folders$/): Promise<void> {
  const panel = page.getByRole('dialog', { name: panelName });
  const list = panel.locator('.popover-list');
  await expect(more).toBeVisible();
  await more.scrollIntoViewIfNeeded();

  // 1. Hover opens it, with no gap between the chip and the panel.
  await more.hover();
  await expect(panel).toBeVisible();
  const chipBox = (await more.boundingBox())!;
  const panelBox = (await panel.boundingBox())!;
  expect(panelBox.y - (chipBox.y + chipBox.height), `${where}: a gap between the chip and the panel`).toBeLessThanOrEqual(1);

  // 2. The pointer moves down into the panel, slowly. It stays open, past the close delay.
  const target = await centre(list);
  await page.mouse.move(target.x, target.y, { steps: 25 });
  await page.waitForTimeout(700);
  await expect(panel, `${where}: closed while the pointer was in the panel`).toBeVisible();

  // 3. The list scrolls inside the panel (wheel) and the panel stays open.
  const scrollable = await list.evaluate((el: unknown) => (el as { scrollHeight: number; clientHeight: number }).scrollHeight > (el as { clientHeight: number }).clientHeight);
  expect(scrollable, `${where}: the list should be long enough to scroll`).toBe(true);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(300);
  expect(await list.evaluate((el: unknown) => (el as { scrollTop: number }).scrollTop), `${where}: the list did not scroll`).toBeGreaterThan(0);
  await expect(panel, `${where}: closed while scrolling inside`).toBeVisible();

  // 4. Leaving both closes a hover.
  await page.mouse.move(5, 5, { steps: 5 });
  await expect(panel).toHaveCount(0);

  // 5. A click pins it. The pointer can go anywhere and it stays.
  await more.click();
  await page.mouse.move(5, 5, { steps: 5 });
  await page.waitForTimeout(700);
  await expect(panel, `${where}: a click did not pin it`).toBeVisible();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  // 6. Esc closes it and the focus is back on the chip.
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(more).toBeFocused();

  // 7. A click outside closes a pinned one.
  await more.click();
  await expect(panel).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(panel).toHaveCount(0);

  // 8. The keyboard: focus the chip, Enter opens, Esc closes.
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(more).toBeFocused();
}

test('the +N popover stays open for the chip and the panel, scrolls inside, is pinned by a click, on Distribute and on Status', async ({ page }) => {
  await signIn(page, PRIYA);
  const [name] = await addPdfs(page, 1, 'popscroll');
  for (const path of FOLDERS) await tick(page, path);

  // Distribute: the Files table shows "8 folders" for the file, and the button opens the list.
  const row = page.locator('.frow', { hasText: name as string });
  await exercise(page, row.getByRole('button', { name: /^Show the \d+ folders of/ }), 'Distribute', /^Folders of/);

  // Status: the "Sent to" header shows three chips and the rest.
  await send(page);
  await expect(chip(page)).toBeVisible();
  await exercise(page, page.locator('.jdest').getByRole('button', { name: /^Show \d+ more folders$/ }), 'Status');
});
