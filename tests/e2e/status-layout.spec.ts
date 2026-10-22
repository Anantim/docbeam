import { expect, test } from '@playwright/test';
import { CARDIO_IRB, chip, distRow, pickFilter, PRIYA, RAJ, removeSeeded, rgb, sendFiles, seedJob, signIn, tooltipOf } from './helpers.js';

// The last round of Status polish (D-F1-18): table alignment, one toast corner, Showing N, the copy icon, the dialog backdrop.

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const unauthorised = { status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Sign in again.' } }) };

test('the list: Status and Sent sit close, and the columns take what they need', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  await expect(distRow(page).first()).toBeVisible();
  const heads = await page.getByRole('columnheader').all();
  const status = (await heads[1]!.boundingBox())!;
  const sent = (await heads[2]!.boundingBox())!;
  expect(sent.x - (status.x + status.width)).toBeLessThan(4); // no wide gap: the columns take what they need
  expect(status.width).toBeLessThan(220);
});

test('the full-width list: ID, Status, Sent fit their content; Files and Destinations share the spare width, one line each with an ellipsis, every row the same height; the split view hides them (D-F1-40)', async ({ page }) => {
  await signIn(page, PRIYA);
  const longFile = 'A very long file name that cannot possibly fit in the column however wide the window is, version 12 final.pdf';
  const longFolder = 'Cardio / CARDIO-301 Regulatory / A binder with a name that is also far too long / A folder that is long too';
  const jobId = await seedJob(page, [longFile, 'second.pdf', 'third.pdf'], [longFolder, `${longFolder} two`, `${longFolder} three`, `${longFolder} four`]);
  try {
    await page.getByRole('button', { name: 'Status' }).click();
    const row = page.locator('tr', { has: page.locator(`[data-job-id="${jobId}"]`) });
    await expect(row).toBeVisible();
    for (const width of [1440, 1280, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(250);
      expect(await page.getByRole('columnheader').allTextContents()).toEqual(['ID', 'Status', 'Sent', 'Files', 'Destinations']); // no Sender column
      const edges = async (name: string): Promise<{ left: number; right: number }> => {
        const index = (await page.getByRole('columnheader').allTextContents()).findIndex((t) => t.trim() === name);
        const box = (await page.locator('.dist-table thead th').nth(index).boundingBox())!;
        return { left: box.x, right: box.x + box.width };
      };
      const sent = await edges('Sent');
      const files = await edges('Files');
      const dest = await edges('Destinations');
      expect(Math.abs(files.left - sent.right), `Files starts where Sent ends at ${width} px`).toBeLessThan(2);
      expect(Math.abs(dest.left - files.right), `Destinations starts where Files ends at ${width} px`).toBeLessThan(2);
      const share = (files.right - files.left) / (files.right - files.left + dest.right - dest.left);
      expect(share, `Files take about 40% of the pair at ${width} px`).toBeGreaterThan(0.35); // D-F1-57: 40 / 60
      expect(share).toBeLessThan(0.45);
      // One line, cut by an ellipsis: the text is wider than its box, and the "+N" stays whole.
      const text = row.locator('.cell-text').first();
      expect(await text.evaluate((el: unknown) => (el as { scrollWidth: number; clientWidth: number }).scrollWidth > (el as { clientWidth: number }).clientWidth), `the file name is cut at ${width} px`).toBe(true);
      await expect(text).toHaveCSS('text-overflow', 'ellipsis');
      await expect(row.getByRole('button', { name: /^Show 2 more files/ })).toHaveText('+2');
      await expect(row.getByRole('button', { name: /^Show 2 more folders/ })).toHaveText('+2');
      // Every row is as tall as the others.
      const heights = await page.locator('.dist-table tbody tr').evaluateAll((rows: unknown[]) => (rows as Array<{ getBoundingClientRect(): { height: number } }>).slice(0, 12).map((r) => Math.round(r.getBoundingClientRect().height)));
      expect(new Set(heights).size, `rows have one height at ${width} px: ${heights.join(',')}`).toBe(1);
    }
    // With the panel open the list is narrow and Files and Destinations are hidden.
    await row.locator('.dist-id').click();
    await expect(page.getByRole('complementary')).toBeVisible();
    await expect(page.locator('.dist-table thead th', { hasText: 'Destinations' })).toBeHidden();
    await expect(page.locator('.dist-table thead th', { hasText: /^Files$/ })).toBeHidden();
  } finally {
    await removeSeeded(jobId);
  }
});

test('spacing: 16 px from the title to the filter row and 12 px from the filter row to the table, at 1440, 1280 and 1024 px (D-F1-54, was equal gaps in D-F1-33)', async ({ page }) => {
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  await expect(distRow(page).first()).toBeVisible();
  for (const width of [1440, 1280, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(200);
    const title = (await page.locator('.page-head:visible').boundingBox())!; // the title row (the heading's own box is a little shorter)
    const filters = (await page.getByRole('group', { name: 'Filters' }).boundingBox())!;
    const list = (await page.locator('.dist').boundingBox())!;
    const above = filters.y - (title.y + title.height);
    const below = list.y - (filters.y + filters.height);
    expect(Math.round(above), `at ${width} px: above the filters`).toBe(16);
    expect(Math.round(below), `at ${width} px: below the filters`).toBe(12);
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

test('under 1024 px the page itself scrolls and the next page still loads on the way down; there is no "Show more" (D-F1-49)', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  await expect(distRow(page).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show more' })).toHaveCount(0);
  const first = await distRow(page).count();
  await page.evaluate(`window.scrollTo(0, document.documentElement.scrollHeight)`);
  await expect.poll(() => distRow(page).count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(first);
});

test('the copy icon: shown on row hover and focus, always in the panel; it copies the link, cross-fades to a green tick for 2 seconds with no label and no toast, and does not open or close the panel', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  const row = distRow(page).first();
  await expect(row).toBeVisible();
  const jobId = (await row.locator('.dist-id').getAttribute('data-job-id')) as string;
  await expect(page.getByRole('button', { name: 'Copy link', exact: true })).toHaveCount(await distRow(page).count()); // one per row, none in the header

  const icon = row.getByRole('button', { name: 'Copy link' });
  expect(await tooltipOf(page, icon)).toBe('Copy link');
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
  // No toast for a good copy (D-F1-43) and no visible label (D-F1-51): the icon cross-fades to a green tick for 2 seconds, then goes back.
  await expect(row.locator('.copy-icons.on')).toHaveCount(1);
  await expect(row.getByText('Copied', { exact: true })).toHaveCount(0); // the only words are the hidden "Link copied"
  await expect(icon).toHaveClass(/copied/);
  await expect(icon).toHaveCSS('color', rgb('#067647'));
  await expect(row.locator('.copy-wrap [role="status"]')).toHaveText('Link copied');
  await expect(page.locator('.toast')).toHaveCount(0);
  expect(await page.evaluate('navigator.clipboard.readText()')).toBe(`http://localhost:5173/#/status/${jobId}`);
  await expect(page).toHaveURL(/#\/status$/);
  await expect(page.getByRole('complementary')).toHaveCount(0);
  await expect(row.locator('.copy-icons.on')).toHaveCount(0, { timeout: 4000 }); // 2 seconds
  await expect(icon).not.toHaveClass(/copied/);

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
    await expect(panel.locator('.panel-note .sr')).toHaveText('Showing deliveries to Cardio'); // Raj is in Cardio only (D-F1-52, D-F1-77)
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
    for (let i = 0; i < 40 && (await page.getByText("That's everything").count()) === 0; i += 1) {
      await page.evaluate(`(document.querySelector('.dist-scroll') ?? document.scrollingElement).scrollTop = 999999`);
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
