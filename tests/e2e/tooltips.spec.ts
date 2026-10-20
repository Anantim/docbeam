import { expect, test } from '@playwright/test';
import { addPdfs, PRIYA, signIn } from './helpers.js';

// The tooltip rules (D-M3-10) on the Distribute screen, in a real browser. The popover of folders is in m2.spec.ts and popover.spec.ts.

test('a button that is off says why, and a button with only an icon says what it does', async ({ page }) => {
  await signIn(page, PRIYA);

  // Nothing added yet.
  const send = page.getByRole('button', { name: 'Send', exact: true });
  await expect(send).toBeDisabled();
  // No hover-only tooltip says why Send is off any more (D-F1-20): on the empty page there is no reason text either, the
  // drop area says what to do.
  await expect(send).toBeDisabled();
  await expect(send).not.toHaveAttribute('title', /.+/);
  await expect(page.locator('.send-reason')).toHaveText('');
  await expect(page.getByRole('button', { name: 'Clear' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Clear' })).not.toHaveAttribute('title', /.+/);
  await page.getByRole('button', { name: 'Expand Cardio', exact: true }).click();
  await page.getByRole('button', { name: 'Expand CARDIO-301 Regulatory' }).click();
  const tickBox = page.getByRole('checkbox', { name: /IRB approvals$/ });
  await expect(tickBox).toBeEnabled(); // a folder can be ticked before any file is added (D-F1-4)

  // A file is added and checked: Send is still off, and says what is missing.
  const [name] = await addPdfs(page, 1, 'tips');
  await expect(send).toBeDisabled();
  await expect(page.locator('.send-reason')).toHaveText('Choose folders for 1 file');
  await expect(send).not.toHaveAttribute('title', /.+/);
  await expect(tickBox).toBeEnabled();
  await expect(tickBox).not.toHaveAttribute('title', /.+/);

  // Icon-only buttons: the same text in the title and in the name a screen reader gets.
  for (const label of [`Remove ${name}`, `Preview ${name}`, 'Sign out']) {
    const button = page.getByRole('button', { name: label, exact: true });
    await expect(button).toHaveAttribute('title', label);
  }
  // A file name that is cut short shows in full; the status explains itself.
  await expect(page.locator('.fname-text', { hasText: name as string })).toHaveAttribute('title', name as string);
  await expect(page.locator('.frow .status-chip', { hasText: 'Ready' })).toHaveAttribute('title', 'Stored, intact and scanned clean.');

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
