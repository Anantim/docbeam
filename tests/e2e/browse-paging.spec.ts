import { expect, test } from '@playwright/test';
import { signIn } from './helpers.js';

// Browse paging (F1 part B, D-F1-6): a folder of 60 children (the seed's "Paging Team") loads 20 at a time as the
// list is scrolled, and nothing is loaded before it is opened.
const PAGING = 'paging.user@example.com';

test('a folder of 60 children loads a page when it opens and the next page when the list is scrolled', async ({ page }) => {
  const calls: Array<{ url: string; ms: number }> = [];
  page.on('requestfinished', async (r) => {
    if (/\/api\/(teams|binders|folders)(\/|\?|$)/.test(r.url())) calls.push({ url: r.url(), ms: r.timing().responseEnd });
  });
  await signIn(page, PAGING);
  await expect(page.locator('.row .name.team')).toHaveText(['Paging Team']);
  expect(calls.filter((c) => /\/(binders|folders)\/[^/]+\/contents/.test(c.url))).toHaveLength(0); // nothing before opening

  await page.getByRole('button', { name: 'Expand Paging Team', exact: true }).click();
  await page.getByRole('button', { name: 'Expand PAGING-1 Archive', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Expand Archive 2026', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Expand Archive 2026', exact: true }).click();

  const batches = page.getByRole('checkbox', { name: /Batch \d{3}$/ });
  await expect(batches).toHaveCount(20); // the first page only
  const archive = (): number => calls.filter((c) => /\/folders\/[^/]+\/contents/.test(c.url)).length;
  expect(archive()).toBe(1);

  const tree = page.locator('.tree');
  await tree.evaluate((el) => el.scrollTo(0, el.scrollHeight)); // the end of the list comes into view
  await expect(batches).toHaveCount(40);
  await tree.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(batches).toHaveCount(60);
  await expect(page.getByRole('checkbox', { name: /Batch 060$/ })).toBeVisible();
  // The last page has no "more" row, and each page was asked for once.
  await expect(page.getByRole('button', { name: 'Show more' })).toHaveCount(0);
  expect(archive()).toBe(3);
  const cursors = calls.filter((c) => /\/folders\/[^/]+\/contents/.test(c.url)).map((c) => new URL(c.url).searchParams.get('cursor'));
  expect(cursors[0]).toBeNull();
  expect(new Set(cursors).size).toBe(3);
  // A page of 20 answers well inside the target (the blueprint's 1 second for a level).
  for (const c of calls) expect(c.ms, c.url).toBeLessThan(1000);

  // A ticked folder on a later page can be sent: the tick works like any other.
  const last = page.getByRole('checkbox', { name: /Batch 060$/ });
  await last.click();
  await expect(last).toBeChecked();
});
