import { expect, test, type Page } from '@playwright/test';
import { distRow, PRIYA, signIn } from './helpers.js';

// Status scrolling (D-F1-29). From 1024 px up the page does not scroll: the title and the filter row stay, the list scrolls in
// its own area under a sticky header, and the panel fills the same height beside it. Under 1024 px the page scrolls as usual.

// The code given to `evaluate` is a string: these tests are compiled without the DOM types.
const scrollInfo = async (page: Page, selector: string): Promise<{ top: number; max: number; client: number; scrollbar: number }> =>
  (await page.evaluate(`(() => {
    const el = document.querySelector('${selector}');
    return { top: el.scrollTop, max: el.scrollHeight - el.clientHeight, client: el.clientHeight, scrollbar: el.offsetWidth - el.clientWidth };
  })()`)) as { top: number; max: number; client: number; scrollbar: number };
const pageScroll = async (page: Page): Promise<{ top: number; max: number }> =>
  (await page.evaluate(`({ top: window.scrollY, max: document.documentElement.scrollHeight - window.innerHeight })`)) as { top: number; max: number };
const scrollList = (page: Page, top: number) => page.evaluate(`document.querySelector('.dist-scroll').scrollTop = ${top}`);

async function openStatus(page: Page, width: number, height = 800): Promise<void> {
  await page.setViewportSize({ width, height });
  await signIn(page, PRIYA);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Status' }).click();
  await expect(distRow(page).first()).toBeVisible();
}

test('1024 px and up: the page does not scroll; the title and filters stay; the list scrolls in its own area with a scrollbar and a sticky header', async ({ page }) => {
  await openStatus(page, 1440);
  for (const width of [1440, 1280, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    await scrollList(page, 0);
    await page.waitForTimeout(250);
    expect((await pageScroll(page)).max, `the page has nothing to scroll at ${width} px`).toBeLessThanOrEqual(1);
    const list = await scrollInfo(page, '.dist-scroll');
    expect(list.max, 'the list has more rows than fit').toBeGreaterThan(100);
    // A scrollbar only when there is something to scroll (`overflow-y: auto`, D-F1-81), with a stable gutter so the columns do not move, and the
    // app's one slim scrollbar. (The test browser is started with scrollbars hidden, so the bar itself cannot be measured here.)
    expect(await page.evaluate(`getComputedStyle(document.querySelector('.dist-scroll')).overflowY`)).toBe('auto');
    expect(await page.evaluate(`getComputedStyle(document.querySelector('.dist-scroll')).scrollbarGutter`)).toBe('stable');
    expect(await page.evaluate(`getComputedStyle(document.querySelector('.dist-scroll')).scrollbarWidth`)).toBe('thin');
    const heading = (await page.getByRole('heading', { name: 'Distributions' }).boundingBox())!;
    const filters = (await page.getByRole('group', { name: 'Filters' }).boundingBox())!;
    const head = (await page.locator('.dist-table thead th').first().boundingBox())!;
    const area = (await page.locator('.dist-scroll').boundingBox())!;

    await scrollList(page, 400);
    await page.waitForTimeout(150);
    expect((await scrollInfo(page, '.dist-scroll')).top).toBeGreaterThan(300);
    await page.mouse.wheel(0, 300); // a wheel over the list scrolls the list and not the page
    await page.waitForTimeout(150);
    expect((await pageScroll(page)).top).toBe(0);
    expect(await page.getByRole('heading', { name: 'Distributions' }).boundingBox()).toEqual(heading); // fixed
    expect(await page.getByRole('group', { name: 'Filters' }).boundingBox()).toEqual(filters);
    const stuck = (await page.locator('.dist-table thead th').first().boundingBox())!;
    expect(Math.abs(stuck.y - head.y), 'the header row stays at the top of the list').toBeLessThan(2);
    expect(stuck.y).toBeGreaterThanOrEqual(area.y - 1);
  }
});

test('the list loads the next page by itself when its scroll area nears the end: no "Show more", no "Showing N" (D-F1-49)', async ({ page }) => {
  await openStatus(page, 1280);
  await expect(page.getByRole('button', { name: 'Show more' })).toHaveCount(0);
  await expect(page.getByText(/^Showing \d+/)).toHaveCount(0);
  const before = await distRow(page).count();
  expect(before).toBe(20);
  await scrollList(page, 99999); // the end of the 20 rows: the sentinel comes within reach
  await expect.poll(() => distRow(page).count(), { timeout: 10_000 }).toBeGreaterThan(before);
  expect((await pageScroll(page)).top).toBe(0); // still the page does not move
  // No row twice.
  const ids = (await page.locator('.dist-table [data-job-id]').evaluateAll((els: unknown[]) => (els as Array<{ getAttribute(n: string): string }>).map((e) => e.getAttribute('data-job-id')))) as string[];
  expect(new Set(ids).size).toBe(ids.length);
});

test('scrolling to the very end ends with "That\'s everything"; Down on the last row asks for the next page too', async ({ page }) => {
  test.setTimeout(280_000); // the local database holds a thousand distributions: about 50 pages of 20
  await openStatus(page, 1280);
  for (let i = 0; i < 200 && (await page.getByText("That's everything").count()) === 0; i += 1) {
    await scrollList(page, 999999);
    await page.waitForTimeout(250);
  }
  await expect(page.getByText("That's everything")).toBeVisible();
  const ids = (await page.locator('.dist-table [data-job-id]').evaluateAll((els: unknown[]) => (els as Array<{ getAttribute(n: string): string }>).map((e) => e.getAttribute('data-job-id')))) as string[];
  expect(new Set(ids).size, 'every distribution once').toBe(ids.length);
});

test('Down on the last loaded row asks for the next page', async ({ page }) => {
  await openStatus(page, 1280);
  const before = await distRow(page).count();
  await page.locator('.dist-table [data-job-id]').nth(before - 1).focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => distRow(page).count(), { timeout: 10_000 }).toBeGreaterThan(before);
});

test('opening and closing a distribution keeps the list position; the selected row is brought into view; the panel fills the same height', async ({ page }) => {
  await openStatus(page, 1440, 900);
  await scrollList(page, 500);
  await page.waitForTimeout(150);
  const before = (await scrollInfo(page, '.dist-scroll')).top;
  const listBox = (await page.locator('.dist-scroll').boundingBox())!;
  const visibleRow = distRow(page).nth(Math.floor(before / 64) + 3); // a row that is in view
  await visibleRow.locator('.dist-id').click();
  const panel = page.getByRole('complementary');
  await expect(panel).toBeVisible();
  await page.waitForTimeout(200);
  const opened = await scrollInfo(page, '.dist-scroll');
  expect(Math.abs(opened.top - before), 'no jump when the panel opens').toBeLessThanOrEqual(64);
  const panelBox = (await panel.boundingBox())!;
  const listBox2 = (await page.locator('.dist-scroll').boundingBox())!;
  expect(Math.abs(panelBox.y + panelBox.height - (listBox2.y + listBox2.height)), 'the panel fills the same height as the list').toBeLessThan(40);
  expect(listBox2.y).toBe(listBox.y); // the list did not move down or up
  expect((await pageScroll(page)).max).toBeLessThanOrEqual(1); // the page still does not scroll with the panel open
  // The selected row is in view.
  const row = page.locator('.dist-table tbody tr.on');
  const rowBox = (await row.boundingBox())!;
  expect(rowBox.y).toBeGreaterThanOrEqual(listBox2.y);
  expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(listBox2.y + listBox2.height + 1);

  await page.keyboard.press('Escape'); // close
  await expect(panel).toHaveCount(0);
  await page.waitForTimeout(200);
  expect(Math.abs((await scrollInfo(page, '.dist-scroll')).top - opened.top), 'no jump when it closes').toBeLessThanOrEqual(64);
});

test('keyboard: Up and Down move through the rows and keep the focused row in view; one Tab stop for the list; Tab order is filters, list, panel', async ({ page }) => {
  await openStatus(page, 1280);
  const ids = page.locator('.dist-table tbody .dist-id');
  // Only one row is a Tab stop.
  expect(await page.locator('.dist-table tbody .dist-id[tabindex="0"]').count()).toBe(1);
  await ids.first().focus();
  for (let i = 0; i < 14; i += 1) await page.keyboard.press('ArrowDown');
  await expect(ids.nth(14)).toBeFocused();
  const area = (await page.locator('.dist-scroll').boundingBox())!;
  const rowBox = (await ids.nth(14).boundingBox())!;
  expect(rowBox.y).toBeGreaterThanOrEqual(area.y);
  expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(area.y + area.height + 1);
  expect((await scrollInfo(page, '.dist-scroll')).top).toBeGreaterThan(0); // it scrolled to keep it in view
  await page.keyboard.press('ArrowUp');
  await expect(ids.nth(13)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(ids.first()).toBeFocused();
  const loaded = await ids.count(); // 20, or 40 once the way down has brought the next page
  await page.keyboard.press('End'); // the last loaded row: End there also asks for the next page (D-F1-49)
  await expect(ids.nth(loaded - 1)).toBeFocused();

  // Tab goes filters, then the list (one stop), then the panel.
  await page.getByRole('group', { name: 'Filters' }).getByRole('button', { name: /^Status/ }).focus();
  const order: string[] = [];
  await page.keyboard.press('Enter');
  await page.getByRole('menuitemradio', { name: 'Any status' }).click(); // close the menu again
  await ids.nth(2).click();
  await expect(page.getByRole('complementary')).toBeVisible();
  await page.getByRole('group', { name: 'Filters' }).getByRole('button', { name: /^Team/ }).focus();
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Tab');
    order.push(await page.evaluate(`document.activeElement.closest('.filterbar') ? 'filters' : document.activeElement.closest('.dist') ? 'list' : document.activeElement.closest('.panel') ? 'panel' : 'other'`) as string);
  }
  const firstList = order.indexOf('list');
  const firstPanel = order.indexOf('panel');
  expect(firstList).toBeGreaterThanOrEqual(0);
  expect(firstPanel).toBeGreaterThan(firstList); // the list comes before the panel
  expect(order.slice(0, firstList).every((o) => o === 'filters' || o === 'other')).toBe(true);
});

test('under 1024 px the page scrolls as usual, the panel is below the list, and the list has no scroll area of its own', async ({ page }) => {
  await openStatus(page, 900, 700);
  const list = await scrollInfo(page, '.dist-scroll');
  expect(list.max, 'the list does not scroll inside').toBeLessThanOrEqual(1);
  const body = await pageScroll(page);
  expect(body.max, 'the page does').toBeGreaterThan(100);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(200);
  expect((await pageScroll(page)).top).toBeGreaterThan(0);
  await distRow(page).first().locator('.dist-id').click();
  const panel = page.getByRole('complementary');
  await expect(panel).toBeVisible();
  const listBox = (await page.locator('.dist').boundingBox())!;
  const panelBox = (await panel.boundingBox())!;
  expect(panelBox.y, 'the panel is below the list').toBeGreaterThanOrEqual(listBox.y + listBox.height - 1);
});
