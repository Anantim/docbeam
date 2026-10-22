import { expect, test } from '@playwright/test';
import { addPdfs, clearPage, PRIYA, signIn, tooltipOf } from './helpers.js';

// The tooltip rules (D-M3-10, D-F1-47) on the Distribute screen, in a real browser: one Tooltip component, no `title` attribute.
// The popover of folders is in m2.spec.ts and popover.spec.ts.

test('a Send that is off says why in text beside it (Clear explains itself even when off), and a button with only an icon says what it does in a tooltip', async ({ page }) => {
  await signIn(page, PRIYA);

  // Nothing added yet.
  const send = page.getByRole('button', { name: 'Send', exact: true });
  await expect(send).toBeDisabled();
  // No hover-only tooltip says why Send is off any more (D-F1-20): on the empty page there is no reason text either, the
  // drop area says what to do.
  expect(await tooltipOf(page, send)).toBeNull();
  await expect(page.locator('.send-reason')).toHaveText('');
  await expect(page.getByRole('button', { name: 'Clear' })).toBeDisabled();
  expect(await tooltipOf(page, page.getByRole('button', { name: 'Clear' }))).toBe('Remove all files and folder ticks'); // says what it does even while off (D-F1-72)
  await page.getByRole('button', { name: 'Expand Cardio', exact: true }).click();
  await page.getByRole('button', { name: 'Expand CARDIO-301 Regulatory' }).click();
  const tickBox = page.getByRole('checkbox', { name: /IRB approvals$/ });
  await expect(tickBox).toBeEnabled(); // a folder can be ticked before any file is added (D-F1-4)

  // A file is added and checked: Send is still off, and says what is missing.
  const [name] = await addPdfs(page, 1, 'tips');
  await expect(send).toBeDisabled();
  await expect(page.locator('.send-reason')).toHaveText('Choose folders for 1 file');
  expect(await tooltipOf(page, send)).toBeNull();
  await expect(tickBox).toBeEnabled();
  expect(await tooltipOf(page, tickBox)).toBeNull();

  // Icon-only buttons: the same text in the tooltip and in the name a screen reader gets.
  for (const label of [`Remove ${name}`, `Preview ${name}`, 'Sign out']) {
    const button = page.getByRole('button', { name: label, exact: true });
    expect(await tooltipOf(page, button), label).toBe(label);
  }
  // A file name that is cut short shows in full; the status explains itself.
  expect(await tooltipOf(page, page.locator('.fname-text', { hasText: name as string }))).toBe(name);
  expect(await tooltipOf(page, page.locator('.frow .status-chip', { hasText: 'Ready' }))).toBe('Stored, intact and scanned clean.');

  // Every button on the page that shows only a symbol has an aria-label and a tooltip (the Tooltip wrapper), and no title attribute.
  // (This script runs in the browser.)
  const broken = await page.evaluate(`(() => {
    const bad = [];
    for (const b of document.querySelectorAll('button')) {
      if (/[\\p{L}\\p{N}]/u.test(b.textContent ?? '')) continue;
      const label = b.getAttribute('aria-label') ?? '';
      if (!label) bad.push('no aria-label: ' + b.outerHTML.slice(0, 80));
      else if (b.getAttribute('role') !== 'checkbox' && !b.closest('.tip-wrap')) bad.push('no tooltip: ' + label);
    }
    for (const el of document.querySelectorAll('[title]')) bad.push('a title attribute: ' + el.outerHTML.slice(0, 80));
    return bad;
  })()`);
  expect(broken).toEqual([]);

  await clearPage(page);
});

test('a tooltip comes after 300 ms of resting, at once on keyboard focus, closes on Esc, and the Esc does not close the panel under it', async ({ page }) => {
  await signIn(page, PRIYA);
  const [name] = await addPdfs(page, 1, 'tipkeys');
  const remove = page.getByRole('button', { name: `Remove ${name}`, exact: true });
  await remove.hover();
  await page.waitForTimeout(120);
  await expect(page.getByRole('tooltip')).toHaveCount(0); // not before 300 ms
  await expect(page.getByRole('tooltip')).toHaveText(`Remove ${name}`);
  expect(await page.getByRole('tooltip').getAttribute('id')).toBeTruthy();
  await expect(remove.locator('xpath=ancestor::span[contains(@class,"tip-wrap")]')).toHaveAttribute('aria-describedby', /.+/);
  await page.mouse.move(0, 0);
  await expect(page.getByRole('tooltip')).toHaveCount(0);

  await remove.focus(); // keyboard focus: at once
  await expect(page.getByRole('tooltip')).toHaveText(`Remove ${name}`, { timeout: 500 });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await clearPage(page);
});

test('Clear, the file type tag and a binder heading explain themselves in a tooltip (D-F1-72)', async ({ page }) => {
  await signIn(page, PRIYA);
  await addPdfs(page, 1, 'tipdist');
  expect(await tooltipOf(page, page.getByRole('button', { name: 'Clear' }))).toBe('Remove all files and folder ticks');
  expect(await tooltipOf(page, page.locator('.typetile').first())).toBe("Type read from the file's contents");
  await page.getByRole('button', { name: 'Expand Cardio', exact: true }).click();
  expect(await tooltipOf(page, page.locator('.name.binder').first())).toBe('Binders hold folders. Open it to choose a folder.');
  await clearPage(page);
});
