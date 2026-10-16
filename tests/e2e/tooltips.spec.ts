import { expect, test } from '@playwright/test';
import { addPdfs, CARDIO_DELEGATION, CARDIO_IRB, CARDIO_PROTOCOL, ONC_ETHICS, PRIYA, signIn, tick } from './helpers.js';

// The tooltip rules (D-M3-10) and the "+N" popover (D-M3-2) on the Distribute screen, in a real browser.
const CARDIO_TRAINING = 'Cardio / CARDIO-301 Site files / Training records';

test('a button that is off says why, and a button with only an icon says what it does', async ({ page }) => {
  await signIn(page, PRIYA);

  // Nothing added yet.
  const send = page.getByRole('button', { name: /^Send 0 deliver/ });
  await expect(send).toBeDisabled();
  await expect(send).toHaveAttribute('title', 'Add a file first');
  await expect(page.getByRole('button', { name: 'Clear' })).toHaveAttribute('title', 'Nothing to clear');
  await page.getByRole('button', { name: 'Expand CARDIO-301 Regulatory' }).click();
  const tickBox = page.getByRole('checkbox', { name: /IRB approvals$/ });
  await expect(tickBox).toBeDisabled();
  await expect(tickBox).toHaveAttribute('title', 'Add a file first');

  // A file is added and checked: Send is still off, and says what is missing.
  const [name] = await addPdfs(page, 1, 'tips');
  await expect(send).toBeDisabled();
  await expect(send).toHaveAttribute('title', '1 file has no destination yet. Tick a folder');
  await expect(tickBox).toBeEnabled();
  await expect(tickBox).not.toHaveAttribute('title', /.+/);

  // Icon-only buttons: the same text in the title and in the name a screen reader gets.
  for (const label of [`Remove ${name}`, `Preview ${name}`, 'Sign out']) {
    const button = page.getByRole('button', { name: label, exact: true });
    await expect(button).toHaveAttribute('title', label);
  }
  // A file name that is cut short shows in full; the status explains itself.
  await expect(page.getByRole('button', { name: name as string, exact: true })).toHaveAttribute('title', new RegExp(`^${name}\\.`));
  await expect(page.locator('.frow .status-chip', { hasText: 'Verified' })).toHaveAttribute('title', 'Stored, intact and scanned clean.');

  // Every button on the page that shows only a symbol has an aria-label and a matching title.
  // (This script runs in the browser.)
  const broken = await page.evaluate(`(() => {
    const bad = [];
    for (const b of document.querySelectorAll('button')) {
      if (/[\\p{L}\\p{N}]/u.test(b.textContent ?? '')) continue;
      const label = b.getAttribute('aria-label') ?? '';
      if (!label) bad.push('no aria-label: ' + b.outerHTML.slice(0, 80));
      else if (b.getAttribute('role') !== 'checkbox' && b.getAttribute('title') !== label) bad.push('title differs: ' + label);
    }
    return bad;
  })()`);
  expect(broken).toEqual([]);

  await page.getByRole('button', { name: 'Clear' }).click();
});

test('the +N chip opens a popover with only the hidden folders', async ({ page }) => {
  await signIn(page, PRIYA);
  const [name] = await addPdfs(page, 1, 'pop');
  const shown = [CARDIO_IRB, CARDIO_PROTOCOL];
  const hidden = [CARDIO_DELEGATION, CARDIO_TRAINING, ONC_ETHICS];
  for (const path of [...shown, ...hidden]) await tick(page, path);

  const row = page.locator('.frow', { hasText: name as string });
  const chips = row.locator('.chips .chip:not(.more)');
  await expect(chips).toHaveCount(2);
  // Each visible chip's title is its own full path, and nothing repeats the whole list.
  await expect(chips.nth(0)).toHaveAttribute('title', shown[0] as string);
  await expect(chips.nth(1)).toHaveAttribute('title', shown[1] as string);
  await expect(row.locator('.chips')).not.toHaveAttribute('title', /.+/);

  const more = row.getByRole('button', { name: 'Show 3 more folders' });
  await expect(more).toHaveText('+3');
  await expect(more).not.toHaveAttribute('title', /.+/);

  // Hover opens it. It lists only the three hidden folders, grouped by team.
  await more.hover();
  const panel = page.getByRole('dialog', { name: '3 more folders' });
  await expect(panel).toBeVisible();
  await expect(panel.locator('.popover-team')).toHaveText([/Cardio/, /Oncology/]);
  await expect(panel).toContainText('CARDIO-301 Site files / Delegation logs');
  await expect(panel).toContainText('CARDIO-301 Site files / Training records');
  await expect(panel).toContainText('ONC-118 Regulatory / Ethics committee');
  await expect(panel).not.toContainText('IRB approvals');
  await expect(panel).not.toContainText('Protocol amendments');

  // Moving away closes a hover.
  await page.getByRole('heading', { name: 'New distribution' }).hover();
  await expect(panel).toHaveCount(0);

  // A click keeps it open, even when the pointer leaves.
  await more.click();
  await page.getByRole('heading', { name: 'New distribution' }).hover();
  await page.waitForTimeout(400);
  await expect(panel).toBeVisible();
  // Esc closes it and the focus goes back to the button.
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(more).toBeFocused();

  // A click outside closes it.
  await more.click();
  await expect(panel).toBeVisible();
  await page.getByRole('heading', { name: 'New distribution' }).click();
  await expect(panel).toHaveCount(0);

  // From the keyboard: Enter opens it; Tab goes into the list, a second Tab leaves and closes it.
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(panel).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(panel).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(panel).toHaveCount(0);

  await page.getByRole('button', { name: 'Clear' }).click();
});
