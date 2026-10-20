import { expect, test } from '@playwright/test';
import { CARDIO_IRB, chip, distRow, pickFilter, PRIYA, RAJ, sendFiles, signIn } from './helpers.js';

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

test('the full-width list sizes its columns to content: ID, Status, Sent, Files, Folders; Files and Folders are narrow and the spare width is at the end of the row (D-F1-28, D-F1-33)', async ({ page }) => {
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  await expect(distRow(page).first()).toBeVisible();
  for (const width of [1440, 1280, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(250);
    const edges = async (name: string): Promise<{ left: number; right: number }> => {
      const index = (await page.getByRole('columnheader').allTextContents()).findIndex((t) => t.trim() === name);
      const box = (await page.locator('.dist-table thead th').nth(index).boundingBox())!;
      return { left: box.x, right: box.x + box.width };
    };
    expect(await page.getByRole('columnheader').allTextContents()).toEqual(['ID', 'Status', 'Sent', 'Files', 'Folders']); // no Sender column
    const sent = await edges('Sent');
    const files = await edges('Files');
    const folders = await edges('Folders');
    expect(Math.abs(files.left - sent.right), `Files starts where Sent ends at ${width} px`).toBeLessThan(2);
    expect(Math.abs(folders.left - files.right), `Folders starts where Files ends at ${width} px`).toBeLessThan(2);
    expect(files.right - files.left, `Files is narrow at ${width} px`).toBeLessThan(110);
    expect(folders.right - folders.left, `Folders is narrow at ${width} px`).toBeLessThan(110);
    // The spare width is the empty last column.
    const spacer = (await page.locator('.dist-table thead th.dist-spacer').boundingBox())!;
    expect(Math.abs(spacer.x - folders.right)).toBeLessThan(2);
    expect(spacer.width).toBeGreaterThan(40);
    // Files and Folders are right-aligned: the numbers end at the column's right edge (less its padding).
    const number = (await distRow(page).first().locator('td').nth(3).boundingBox())!;
    expect(Math.abs(number.x + number.width - files.right)).toBeLessThan(2);
  }
});

test('spacing: the gap between the filter row and the table equals the gap between the title and the filter row, at 1440, 1280 and 1024 px (D-F1-33)', async ({ page }) => {
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  await expect(distRow(page).first()).toBeVisible();
  for (const width of [1440, 1280, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(200);
    const title = (await page.getByRole('heading', { name: 'Distributions' }).boundingBox())!;
    const filters = (await page.getByRole('group', { name: 'Filters' }).boundingBox())!;
    const list = (await page.locator('.dist').boundingBox())!;
    const above = filters.y - (title.y + title.height);
    const below = list.y - (filters.y + filters.height);
    expect(Math.abs(above - below), `at ${width} px: ${above} above the filters, ${below} below`).toBeLessThanOrEqual(1);
  }
});

test('the list gets the fade and the thin shadow of the deliveries table while more rows are below, and one slim scrollbar style is used everywhere (D-F1-33)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  await expect(distRow(page).first()).toBeVisible();
  const wrap = page.locator('.dist-fade');
  await expect(wrap).toHaveClass(/more-below/);
  await page.evaluate(`document.querySelector('.dist-scroll').scrollTop = 99999`);
  await expect(wrap).not.toHaveClass(/more-below/); // gone at the end
  await page.evaluate(`document.querySelector('.dist-scroll').scrollTop = 0`);
  await expect(wrap).toHaveClass(/more-below/);
  // Every scrolling area has the same thin scrollbar (the standard properties, set once on every element).
  for (const selector of ['.dist-scroll', '.tree', 'body', 'html']) {
    expect(await page.evaluate(`getComputedStyle(document.querySelector('${selector}')).scrollbarWidth`), selector).toBe('thin');
  }
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

  // The toast is at the bottom centre of the window, above everything, and takes no click (D-F1-33).
  const toast = (await page.locator('.toast').boundingBox())!;
  const view = page.viewportSize()!;
  expect(Math.abs(toast.x + toast.width / 2 - view.width / 2)).toBeLessThan(40);
  expect(toast.y + toast.height).toBeGreaterThan(view.height - 60);
  expect(await page.evaluate(`getComputedStyle(document.querySelector('.toasts')).pointerEvents`)).toBe('none');
  expect(Number(await page.evaluate(`getComputedStyle(document.querySelector('.toasts')).zIndex`))).toBeGreaterThan(81); // above dialogs too

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

test('the panel is sticky and at most as tall as the screen; a team member scrolls 12 deliveries inside it, with a fade and focus that follows (D-F1-26)', async ({ browser }) => {
  const priyaCtx = await browser.newContext();
  const rajCtx = await browser.newContext();
  const priya = await priyaCtx.newPage();
  const raj = await rajCtx.newPage();
  try {
    await priya.setViewportSize({ width: 1440, height: 900 });
    await raj.setViewportSize({ width: 1440, height: 800 });
    await signIn(priya, PRIYA);
    const { jobId } = await sendFiles(priya, 12, [CARDIO_IRB]); // 12 deliveries to Cardio, which Raj is in
    await expect(chip(priya)).toHaveText('Completed', { timeout: 120_000 });

    await signIn(raj, RAJ);
    await raj.getByRole('button', { name: 'Status' }).click();
    await raj.getByRole('button', { name: `Open distribution ${jobId.slice(0, 8)}` }).click();
    const panel = raj.getByRole('complementary');
    await expect(panel).toContainText('Only the deliveries to your teams are shown.'); // kept
    await expect(panel).toContainText('Sent by Priya Shah');
    await expect(raj.locator('.ttable .tscroll .trow').first()).toBeVisible();

    // At most the screen under the top bar, and it stays in view when the page scrolls.
    const box = (await panel.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(800 - 57); // the viewport minus the top bar
    await raj.evaluate(`window.scrollTo(0, 300)`);
    await raj.waitForTimeout(300);
    const after = (await panel.boundingBox())!;
    expect(after.y).toBeGreaterThanOrEqual(0);
    expect(after.y + after.height).toBeLessThanOrEqual(800);

    // The 12 deliveries scroll inside the panel; a fade says there are more rows below, and goes at the end.
    const scroller = raj.getByRole('region', { name: 'Delivery rows, scrolls' });
    const room = await scroller.evaluate((el) => (el as unknown as { scrollHeight: number; clientHeight: number }).scrollHeight - (el as unknown as { clientHeight: number }).clientHeight);
    expect(room).toBeGreaterThan(0);
    await expect(raj.locator('.tbody-wrap.more-below')).toHaveCount(1);
    await scroller.evaluate((el) => ((el as unknown as { scrollTop: number }).scrollTop = 99999));
    await expect(raj.locator('.tbody-wrap.more-below')).toHaveCount(0);
    await scroller.evaluate((el) => ((el as unknown as { scrollTop: number }).scrollTop = 0));
    await expect(raj.locator('.tbody-wrap.more-below')).toHaveCount(1);

    // Keyboard focus that moves into a row below the box scrolls it into view, clear of the fade.
    const buttons = scroller.getByRole('button', { name: /^Preview / });
    const lastShown = buttons.nth(7); // rows are 64 px: the 8th is beyond a box that shows about 6
    await lastShown.focus();
    const boxRect = (await scroller.boundingBox())!;
    const button = (await lastShown.boundingBox())!;
    expect(button.y).toBeGreaterThanOrEqual(boxRect.y);
    expect(button.y + button.height).toBeLessThanOrEqual(boxRect.y + boxRect.height - 20);
  } finally {
    await priyaCtx.close();
    await rajCtx.close();
  }
});

test('the Status tab badge counts pending and in-progress distributions of everything I can see, whatever the filters (D-F1-21)', async ({ page }) => {
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  await expect(distRow(page).first()).toBeVisible();
  const tab = page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Status/ });
  const badge = async (): Promise<number> => ((await tab.locator('.tab-badge').count()) === 0 ? 0 : Number(/\d+/.exec((await tab.locator('.tab-badge').textContent()) ?? '0')?.[0] ?? 0));
  const before = await badge();
  // The number equals the rows under the Pending and In progress filters together, over every page of the list: it counted
  // only the first 20 rows before, and missed older running distributions (D-F1-34).
  const rowsFor = async (status: string): Promise<number> => {
    await pickFilter(page, 'Status', status);
    await page.waitForTimeout(600);
    for (let i = 0; i < 20 && (await page.getByRole('button', { name: 'Show more' }).count()) > 0; i += 1) {
      await page.getByRole('button', { name: 'Show more' }).click();
      await page.waitForTimeout(400);
    }
    return distRow(page).count();
  };
  const pending = await rowsFor('Pending');
  const inProgress = await rowsFor('In progress');
  expect(before).toBe(pending + inProgress);
  // A filter that leaves only finished distributions, and then one that leaves nothing: the badge does not move.
  await pickFilter(page, 'Status', 'Completed');
  await expect(distRow(page).first()).toBeVisible();
  expect(await badge()).toBe(before);
  await pickFilter(page, 'Sent', 'Today');
  await pickFilter(page, 'Sender', 'Me');
  await page.waitForTimeout(1000);
  expect(await badge()).toBe(before);
});

test('the dialog backdrop covers the strip where the scrollbar was: no lighter strip at the right edge, at 1440, 1280 and 1024 px, top to bottom', async ({ page }) => {
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  await expect(distRow(page).first()).toBeVisible();
  await page.route('**/api/jobs**', (route) => route.fulfill(unauthorised));
  await page.route('**/api/auth/refresh', (route) => route.fulfill(unauthorised));
  // The filter reads the list; the badge's own read may meet the 401 first: either opens the dialog.
  const dialog = page.getByRole('dialog', { name: 'Sign in again' });
  await Promise.race([pickFilter(page, 'Sender', 'Me').catch(() => undefined), dialog.waitFor()]);
  await expect(dialog).toBeVisible();
  for (const [width, height] of [[1440, 900], [1280, 800], [1024, 768]] as const) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(250);
    const shot = await page.screenshot();
    // Read the picture in the browser: down the last column (where the scrollbar was) and down a column 30 px inside the
    // page, in the margin. (The code is a string because these tests are compiled without the DOM types.)
    const worst = (await page.evaluate(`(async () => {
      const img = new Image();
      img.src = 'data:image/png;base64,${shot.toString('base64')}';
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      // Rows where the edge is clearly lighter than the page beside it.
      let lighterRows = 0;
      let rows = 0;
      for (let y = 0; y < img.height; y += 2) {
        const edge = ctx.getImageData(img.width - 1, y, 1, 1).data;
        const inside = ctx.getImageData(img.width - 30, y, 1, 1).data;
        rows += 1;
        if (Math.max(edge[0] - inside[0], edge[1] - inside[1], edge[2] - inside[2]) >= 8) lighterRows += 1;
      }
      return [lighterRows, rows];
    })()`)) as [number, number];
    expect(worst[0], `at ${width} px the edge column is lighter in ${worst[0]} of ${worst[1]} rows`).toBeLessThanOrEqual(12); // a lighter strip would be most of the 400 rows; hairlines (the top bar's border, the table's row lines) are a few
  }
});
