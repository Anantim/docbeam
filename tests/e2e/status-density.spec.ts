import { expect, test, type Page } from '@playwright/test';
import { PRIYA, removeSeeded, seedJob, signIn } from './helpers.js';

// Status at 1440 x 900 with the panel open is dense (D-F1-46): at least 11 distributions in the list and 9 deliveries in the
// panel are fully in view without scrolling; the panel header is one line plus a small sent-by line and a 3 px progress line;
// the panel fills the full height whatever the number of deliveries.

// The code given to `evaluate` is a string: these tests are compiled without the DOM types.
async function visibleRows(page: Page, rowSelector: string, areaSelector: string): Promise<number> {
  return (await page.evaluate(`(() => {
    const area = document.querySelector('${areaSelector}').getBoundingClientRect();
    return [...document.querySelectorAll('${rowSelector}')].filter((r) => {
      const b = r.getBoundingClientRect();
      return b.top >= area.top - 1 && b.bottom <= area.bottom + 1;
    }).length;
  })()`)) as number;
}

test('1440 x 900, panel open: 11 or more distributions and 9 or more deliveries in view; the header is dense; the panel is as tall as the list', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, PRIYA);
  const names = Array.from({ length: 29 }, (_, i) => `Delivery file ${String(i + 1).padStart(2, '0')}.pdf`);
  const big = await seedJob(page, names, ['Cardio / CARDIO-301 Regulatory / IRB approvals']);
  try {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Status' }).click();
    await page.locator(`[data-job-id="${big}"]`).click();
    await expect(page.getByRole('table', { name: 'Deliveries, 29' })).toBeVisible();
    await page.waitForTimeout(500);

    const jobs = await visibleRows(page, '.dist-table tbody tr', '.dist-scroll');
    const deliveries = await visibleRows(page, '.tscroll [role="row"][aria-rowindex]', '.tscroll');
    const area = (await page.locator('.dist-scroll').boundingBox())!;
    const head = (await page.locator('.dist-table thead').boundingBox())!;
    const firstRow = (await page.locator('.dist-table tbody tr').first().boundingBox())!;
    console.log(`1440x900, panel open: ${jobs} distributions and ${deliveries} deliveries fully in view (list area ${Math.round(area.height)} px, header ${Math.round(head.height)} px, row ${firstRow.height} px)`);
    expect(jobs, 'distributions in view').toBeGreaterThanOrEqual(11);
    expect(deliveries, 'deliveries in view').toBeGreaterThanOrEqual(9);

    // One row height, --row-h (52 px), for a distribution and a delivery, in every state (D-F1-56), and the same two type sizes.
    const heights = await page.locator('.dist-table tbody tr').evaluateAll((rows: unknown[]) => (rows as Array<{ getBoundingClientRect(): { height: number } }>).map((r) => Math.round(r.getBoundingClientRect().height)));
    const deliveryHeights = await page.locator('.tscroll [role="row"][aria-rowindex]').evaluateAll((rows: unknown[]) => (rows as Array<{ getBoundingClientRect(): { height: number } }>).map((r) => Math.round(r.getBoundingClientRect().height)));
    expect([...new Set(heights)], 'every distribution row').toEqual([52]);
    expect([...new Set(deliveryHeights)], 'every delivery row').toEqual([52]);
    const size = async (selector: string): Promise<string> => (await page.evaluate(`getComputedStyle(document.querySelector('${selector}')).fontSize`)) as string;
    expect(await size('.dist-id'), 'main line, list').toBe(await size('.tfile'));
    expect(await size('.dist-sender'), 'second line, list').toBe(await size('.dest-text'));
    expect(await size('.dist-sender')).toBe('12px');
    expect(await size('.dist-id')).toBe('13px');

    // The header: the id, the copy icon, the status and Close on one line; the sent-by line under it; the progress line last.
    const y = async (selector: string): Promise<number> => {
      const b = (await page.locator(selector).first().boundingBox())!;
      return b.y + b.height / 2;
    };
    const line = await y('.panel-top h2');
    for (const s of ['.panel-top .copy-link', '.panel-top .status-chip', '.panel-top button[aria-label="Close"]']) expect(Math.abs((await y(s)) - line), s).toBeLessThan(4);
    const sub = (await page.locator('.panel-sub').boundingBox())!;
    const top = (await page.locator('.panel-top').boundingBox())!;
    expect(sub.y).toBeGreaterThanOrEqual(top.y + top.height - 1);
    expect(await page.locator('.panel .chip').count(), 'no folder chips in the panel').toBe(0);
    expect((await page.locator('.panel-head .jbar').boundingBox())!.height).toBeLessThanOrEqual(3.5);
    // One Deliveries row with no title: the status tabs on the left, the Filter… box (29 deliveries) on the right, level, and the
    // box exactly as tall as the tab strip (D-F1-50).
    await expect(page.locator('.panel-section-head h3')).toHaveCount(0);
    const tabs = (await page.locator('.panel-section-head .tfilters').boundingBox())!;
    const filter = (await page.locator('.panel-section-head .deliveries-filter .field').boundingBox())!;
    expect(Math.abs(tabs.y + tabs.height / 2 - (filter.y + filter.height / 2)), 'level').toBeLessThan(2);
    expect(Math.abs(tabs.height - filter.height), 'the same height').toBeLessThan(1);
    expect(tabs.x).toBeLessThan(filter.x); // tabs on the left, box on the right
    // The column heading says "Deliveries", and there is no Attempts column.
    await expect(page.getByRole('columnheader', { name: 'Deliveries' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Attempts' })).toHaveCount(0);

    // The panel is as tall as the list beside it, and the table runs to its bottom edge.
    const panel = (await page.getByRole('complementary').boundingBox())!;
    const list = (await page.locator('.dist').boundingBox())!;
    expect(Math.abs(panel.y + panel.height - (list.y + list.height))).toBeLessThan(2);
    const table = (await page.locator('.ttable').boundingBox())!;
    expect(panel.y + panel.height - (table.y + table.height), 'no empty band under the table').toBeLessThan(24);
  } finally {
    await removeSeeded(big);
  }
});

test('a panel with 2 deliveries still fills the full height, with no box and no empty band under it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, PRIYA);
  const small = await seedJob(page, ['One.pdf', 'Two.pdf'], ['Cardio / CARDIO-301 Regulatory / IRB approvals']);
  try {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Status' }).click();
    await page.locator(`[data-job-id="${small}"]`).click();
    await expect(page.getByRole('table', { name: 'Deliveries, 2' })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.getByRole('textbox', { name: 'Filter deliveries' })).toHaveCount(0);
    const panel = (await page.getByRole('complementary').boundingBox())!;
    const list = (await page.locator('.dist').boundingBox())!;
    expect(Math.abs(panel.y + panel.height - (list.y + list.height)), 'the panel is as tall as the list').toBeLessThan(2);
    const table = (await page.locator('.ttable').boundingBox())!;
    expect(Math.abs(panel.y + panel.height - (table.y + table.height)), 'the table fills the panel').toBeLessThan(24);
  } finally {
    await removeSeeded(small);
  }
});
