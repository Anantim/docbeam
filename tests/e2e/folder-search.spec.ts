import { expect, test } from '@playwright/test';
import { addPdfs, ONC_ETHICS, PRIYA, RAJ, signIn } from './helpers.js';

// The folder search of the Destinations card (D-F1-67): the server looks in every folder of the caller's teams, not only the
// rows already loaded; matches show their full path; picking one ticks it and opens the tree down to it.

test('typing 2 letters finds a folder that is not loaded, shows its full path, and picking it ticks it and opens the tree', async ({ page }) => {
  await signIn(page, PRIYA);
  await addPdfs(page, 1, 'search'); // a file to tick the folder for
  const box = page.getByRole('searchbox', { name: 'Filter folders' });
  await box.fill('ethics'); // nothing is expanded yet: the tree has only the teams
  const result = page.getByRole('button', { name: `Tick ${ONC_ETHICS} and show it in the tree` });
  await expect(result).toBeVisible();
  await expect(result.locator('.result-path')).toHaveText('Oncology / ONC-118 Regulatory');

  await result.click();
  // The box is empty, the tree is open down to the folder, and the folder is ticked.
  await expect(box).toHaveValue('');
  const folder = page.getByRole('checkbox', { name: new RegExp(` to ${ONC_ETHICS}$`) });
  await expect(folder).toBeVisible();
  await expect(folder).toBeChecked();
  await expect(page.getByRole('button', { name: 'Collapse Oncology', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse ONC-118 Regulatory', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
});

test('a folder two levels down shows its whole path, and the search is case-insensitive', async ({ page }) => {
  await signIn(page, PRIYA);
  await page.getByRole('searchbox', { name: 'Filter folders' }).fill('2026');
  await expect(page.getByRole('button', { name: 'Tick Cardio / CARDIO-301 Regulatory / Protocol amendments / 2026 and show it in the tree' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Filter folders' }).fill('PROTOCOL');
  await expect(page.getByRole('button', { name: /Protocol amendments and show it in the tree$/ }).first()).toBeVisible();
});

test('one letter only narrows the loaded rows; nothing is asked of the server', async ({ page }) => {
  const calls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/folders/search')) calls.push(r.url());
  });
  await signIn(page, PRIYA);
  await page.getByRole('searchbox', { name: 'Filter folders' }).fill('o');
  await expect(page.getByRole('button', { name: 'Expand Oncology', exact: true })).toBeVisible();
  await page.waitForTimeout(600);
  expect(calls).toEqual([]);
});

test('a person sees only folders of their own teams: Raj finds no Oncology folder', async ({ page }) => {
  await signIn(page, RAJ);
  await page.getByRole('searchbox', { name: 'Filter folders' }).fill('ethics');
  await expect(page.getByText('No matches', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear filter' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Filter folders' }).fill('approvals');
  await expect(page.getByRole('button', { name: /IRB approvals and show it in the tree$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Site approvals/ })).toHaveCount(0); // Neuro's
});
