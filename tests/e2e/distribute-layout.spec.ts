import { expect, test, type Page } from '@playwright/test';
import { addPdfs, PRIYA, signIn } from './helpers.js';

// Distribute is a fixed screen from 1024 px up (D-F1-39): the page does not scroll, the Files and Destinations cards fill the
// height between the title and the Send bar, and the file rows and the folder tree scroll inside their cards. Under 1024 px
// the cards are stacked and the page scrolls as usual.

// The code given to `evaluate` is a string: these tests are compiled without the DOM types.
const num = async (page: Page, code: string): Promise<number> => (await page.evaluate(code)) as number;
const pageMax = (page: Page) => num(page, 'document.documentElement.scrollHeight - window.innerHeight');
const scrollMax = (page: Page, selector: string) => num(page, `(() => { const e = document.querySelector('${selector}'); return e.scrollHeight - e.clientHeight; })()`);
const overflowY = async (page: Page, selector: string): Promise<string> =>
  (await page.evaluate(`getComputedStyle(document.querySelector('${selector}')).overflowY`)) as string;

async function expandAll(page: Page): Promise<void> {
  const expand = page.getByRole('button', { name: /^Expand / });
  for (let i = 0; i < 20 && (await expand.count()) > 0; i += 1) {
    await expand.first().click();
    await page.waitForTimeout(150);
  }
}

async function open(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await signIn(page, PRIYA);
  await expect(page.getByRole('heading', { name: 'New distribution' })).toBeVisible();
}

async function cardsAreLevel(page: Page): Promise<void> {
  const files = (await page.getByRole('region', { name: 'Documents' }).boundingBox())!;
  const dest = (await page.getByRole('region', { name: 'Destinations' }).boundingBox())!;
  expect(Math.abs(files.y - dest.y), 'the tops are level').toBeLessThanOrEqual(1);
  expect(Math.abs(files.y + files.height - (dest.y + dest.height)), 'the bottoms are level').toBeLessThanOrEqual(1);
}

test('1280 px, few files and a deeply expanded tree: no page scroll, the tree scrolls in its card, Send stays in view, the height does not move', async ({ page }) => {
  await open(page, 1280, 600);
  await addPdfs(page, 2, 'lay');
  const before = (await page.getByRole('region', { name: 'Destinations' }).boundingBox())!;
  await expandAll(page);
  const after = (await page.getByRole('region', { name: 'Destinations' }).boundingBox())!;

  expect(await pageMax(page), 'the page has nothing to scroll').toBeLessThanOrEqual(1);
  expect(after.height, 'opening folders does not change the card').toBe(before.height);
  await cardsAreLevel(page);
  expect(await scrollMax(page, '.tree'), 'the tree has more rows than fit').toBeGreaterThan(20);
  expect(await overflowY(page, '.tree')).toBe('auto');
  // The level that was opened last is scrolled into view inside the card.
  const lastFolder = (await page.locator('.tree .ck').last().boundingBox())!;
  const area = (await page.locator('.tree').boundingBox())!;
  expect(lastFolder.y + lastFolder.height, 'the last opened folder is in view').toBeLessThanOrEqual(area.y + area.height + 1);
  await page.evaluate("document.querySelector('.tree').scrollTop = 0");
  await expect(page.locator('.tree-wrap.more-below'), 'the fade and shadow show while more is below').toHaveCount(1);

  // The search box stays above the tree while the tree scrolls.
  const search = (await page.getByRole('searchbox', { name: 'Filter folders' }).boundingBox())!;
  await page.evaluate("document.querySelector('.tree').scrollTop = 100000");
  await page.waitForTimeout(250);
  expect((await page.getByRole('searchbox', { name: 'Filter folders' }).boundingBox())!.y).toBe(search.y);
  await expect(page.locator('.tree-wrap.more-below'), 'no shadow at the very end').toHaveCount(0);
  const send = (await page.getByRole('button', { name: 'Send', exact: true }).boundingBox())!;
  expect(send.y + send.height, 'Send is in the window').toBeLessThanOrEqual(600);
  expect(await pageMax(page)).toBeLessThanOrEqual(1);
});

test('1280 px, many files and a short tree: the file rows scroll under a fixed header row, the page does not', async ({ page }) => {
  await open(page, 1280, 700);
  await addPdfs(page, 14, 'many');
  expect(await pageMax(page)).toBeLessThanOrEqual(1);
  await cardsAreLevel(page);
  expect(await scrollMax(page, '.files-scroll'), 'the file list has more rows than fit').toBeGreaterThan(50);
  await expect(page.locator('.files-wrap.more-below')).toHaveCount(1);

  const head = page.locator('.frow.thead');
  const top = (await head.boundingBox())!.y;
  await page.evaluate("document.querySelector('.files-scroll').scrollTop = 100000");
  await page.waitForTimeout(250);
  expect((await head.boundingBox())!.y, 'the header row stays at the top of the list').toBe(top);
  await expect(page.locator('.files-wrap.more-below')).toHaveCount(0);
  expect(await pageMax(page)).toBeLessThanOrEqual(1);
  const send = (await page.getByRole('button', { name: 'Send', exact: true }).boundingBox())!;
  expect(send.y + send.height).toBeLessThanOrEqual(700);
});

test('the "files not added" box is at the top of the Files card scroll area', async ({ page }) => {
  await open(page, 1280, 700);
  await page.getByLabel('Choose files').setInputFiles([{ name: 'setup.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') }]);
  await expect(page.getByText('1 file not added')).toBeVisible();
  expect(await page.evaluate("document.querySelector('.not-added').parentElement.className")).toBe('files-scroll');
  expect(await page.evaluate("document.querySelector('.files-scroll').firstElementChild.className")).toBe('not-added');
});

test('1024 px: the same fixed screen', async ({ page }) => {
  await open(page, 1024, 640);
  await addPdfs(page, 2, 'w1024');
  await expandAll(page);
  expect(await pageMax(page)).toBeLessThanOrEqual(1);
  await cardsAreLevel(page);
  expect(await scrollMax(page, '.tree')).toBeGreaterThan(20);
});

test('under 1024 px the cards are stacked: the page scrolls and there are no inner scroll areas', async ({ page }) => {
  await open(page, 900, 700);
  await addPdfs(page, 8, 'stack');
  await expandAll(page);
  expect(await pageMax(page), 'the page scrolls').toBeGreaterThan(100);
  expect(await overflowY(page, '.tree')).toBe('visible');
  expect(await overflowY(page, '.files-scroll')).toBe('visible');
  expect(await scrollMax(page, '.tree'), 'the tree shows all its rows').toBeLessThanOrEqual(1);
  expect(await page.locator('.fadewrap.more-below').count(), 'no fade without an inner scroll').toBe(0);
});

test('every tick box is a 16 x 16 square at 1440, 1280 and 1024 px: the header, the file rows and the folders of the tree (D-F1-48)', async ({ page }) => {
  await signIn(page, PRIYA);
  await addPdfs(page, 3, 'tick');
  await page.getByRole('button', { name: 'Expand Cardio', exact: true }).click();
  await page.getByRole('button', { name: 'Expand CARDIO-301 Regulatory' }).click();
  await page.getByRole('checkbox', { name: /IRB approvals$/ }).click(); // one ticked, one not
  await page.locator('.frow[data-id]').first().click(); // and one file row selected
  for (const [width, height] of [[1440, 900], [1280, 800], [1024, 768]] as const) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(300);
    const sizes = (await page.evaluate(`[...document.querySelectorAll('.box')].map((b) => { const r = b.getBoundingClientRect(); return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, where: b.closest('.frow.thead') ? 'header' : b.closest('.frow') ? 'file row' : 'tree' }; })`)) as Array<{ w: number; h: number; where: string }>;
    expect(sizes.length, `tick boxes at ${width} px`).toBeGreaterThanOrEqual(6); // the header, three files, two folders
    for (const s of sizes) expect({ w: s.w, h: s.h }, `a ${s.where} tick box at ${width} px`).toEqual({ w: 16, h: 16 });
    expect(new Set(sizes.map((s) => s.where))).toEqual(new Set(['header', 'file row', 'tree']));
  }
});
