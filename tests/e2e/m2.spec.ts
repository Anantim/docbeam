import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { env } from '../integration/helpers.js';
import { addPdfs, CARDIO_IRB, pdf, CARDIO_PROTOCOL, chip, PRIYA, RAJ, readCounts, send, signIn, tick } from './helpers.js';

// M2, Upload and distribute, as a regression pack (flow 2): pick, upload, scan, map, review, send.
// (The 101 MiB multipart upload, the platform stopped mid-run and the SIGTERM drain are covered by the
// integration suite: tests/integration/web-upload.test.ts, delivery.test.ts and platform-drain.test.ts.)
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const row = (page: Page, name: string) => page.locator('.frow', { hasText: name });

test('a file is uploaded and scanned, mapped to a folder, and sent', async ({ page }) => {
  await signIn(page, PRIYA);
  const send0 = page.getByRole('button', { name: 'Send', exact: true });
  await expect(send0).toBeDisabled();

  const [name] = await addPdfs(page, 1, 'm2');
  await expect(row(page, name as string).locator('.status-chip')).toHaveText('Ready');
  // Ready, but nowhere to send it yet: Send says what is missing.
  await expect(send0).toHaveAttribute('title', '1 file has no folder. Tick a folder');
  await expect(page.locator('.send-reason')).toHaveText('1 file has no folder. Tick a folder');

  await tick(page, CARDIO_IRB);
  const sendBtn = page.getByRole('button', { name: 'Send', exact: true });
  await expect(sendBtn).toBeEnabled();
  await expect(page.locator('.send-reason')).toHaveText(''); // nothing is missing

  await send(page);
  await expect(chip(page)).toHaveText('Completed', { timeout: 90_000 });
  expect(await readCounts(page)).toEqual([1, 0, 0, 0]);
  // Sending cleared the page.
  await page.getByRole('button', { name: 'Distribute' }).click();
  await expect(page.locator('.frow:not(.thead)')).toHaveCount(0);
});

test('folders can be ticked before any file is added, and every file added while they stay ticked goes to them (D-F1-5)', async ({ page }) => {
  await signIn(page, PRIYA);
  await tick(page, CARDIO_IRB);
  await tick(page, CARDIO_PROTOCOL);
  await expect(page.locator('.send-reason')).toHaveText('Add a file first');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();

  await addPdfs(page, 2, 'order');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await expect(page.locator('.send-reason')).toHaveText('');
  // The folders stay ticked while the selection stands: a file added later goes to them too (D-F1-5).
  await page.getByLabel('Choose files').setInputFiles([pdf('later.pdf')]);
  await expect(page.getByText('Ready', { exact: true })).toHaveCount(3, { timeout: 90_000 });
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await expect(page.locator('.send-reason')).toHaveText('');
  await page.getByRole('button', { name: 'Clear' }).click();
});

test('a file type that is not allowed is listed under Not added, and can be dismissed', async ({ page }) => {
  await signIn(page, PRIYA);
  await page.getByLabel('Choose files').setInputFiles([{ name: 'setup.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') }]);
  const notAdded = page.locator('.not-added');
  await expect(notAdded).toContainText('setup.exe');
  await expect(notAdded).toContainText('This type is not allowed. Use PDF, DOCX, XLSX, PNG or JPG.');
  await expect(page.locator('.frow:not(.thead)')).toHaveCount(0);
  await page.getByRole('button', { name: 'Dismiss setup.exe' }).click();
  await expect(notAdded).toHaveCount(0);
});

test('a malware test file is refused by the scan, can never be sent, and only its owner sees the audit event', async ({ browser, page }) => {
  await signIn(page, PRIYA);
  const name = `eicar-${randomUUID().slice(0, 6)}.pdf`;
  await page.getByLabel('Choose files').setInputFiles([{ name, mimeType: 'application/pdf', buffer: Buffer.from(EICAR) }]);
  const eicar = row(page, name);
  await expect(eicar.locator('.status-chip')).toHaveText('Refused', { timeout: 90_000 });
  await expect(eicar).toContainText('Malware was found');
  await expect(eicar.locator('.status-chip')).toHaveAttribute('data-tone', 'bad');
  await expect(eicar.locator('.struck')).toBeVisible(); // its name is struck through
  await expect(eicar.getByRole('checkbox')).toHaveCount(0); // it cannot be selected
  await expect(eicar).toContainText('Will not be sent');
  const sendBtn = page.getByRole('button', { name: 'Send', exact: true });
  await expect(sendBtn).toBeDisabled();
  await expect(sendBtn).toHaveAttribute('title', 'Remove the file refused for malware first'); // it is the only file
  await page.getByRole('button', { name: `Remove ${name}` }).click();
  await expect(row(page, name)).toHaveCount(0);

  // The refusal is in Priya's audit trail, and nobody else's.
  await page.getByRole('button', { name: 'Status' }).click();
  await page.getByRole('button', { name: 'Upload events' }).click();
  await expect(page.getByRole('complementary', { name: 'Upload events' }).locator('.arow', { hasText: 'File refused' }).first()).toContainText('malware found by the scan');

  const rajContext = await browser.newContext();
  const raj = await rajContext.newPage();
  try {
    await signIn(raj, RAJ);
    await raj.getByRole('button', { name: 'Status' }).click();
    await raj.getByRole('button', { name: 'Upload events' }).click();
    await expect(raj.getByRole('complementary', { name: 'Upload events' }).getByText('No upload events.')).toBeVisible();
  } finally {
    await rajContext.close();
  }
});

test('ticking a folder applies to the selected file only, until "Use all files"', async ({ page }) => {
  await signIn(page, PRIYA);
  const [a, b] = await addPdfs(page, 2, 'scope');
  await row(page, a as string).locator('.fname').click(); // a click on a row selects it
  await expect(page.locator('.scope.scoped')).toContainText('1 selected file');
  await tick(page, CARDIO_IRB);
  await expect(row(page, a as string).locator('.chips')).toContainText('1 folder');
  await expect(row(page, b as string)).toContainText('None yet');

  await page.getByRole('button', { name: 'Use all files' }).click();
  await expect(page.locator('.scope')).toContainText('all 2 files');
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.locator('.frow:not(.thead)')).toHaveCount(0);
});

test('a file shows how many folders it goes to, with the list on demand; Preview opens its own copy; Send asks first', async ({ page }) => {
  await signIn(page, PRIYA);
  const [a] = await addPdfs(page, 2, 'review');
  await tick(page, CARDIO_IRB);
  await tick(page, CARDIO_PROTOCOL);
  await expect(page.locator('.send-summary')).toHaveText('2 files to 2 folders: 4 deliveries');
  await expect(row(page, a as string).locator('.chips')).toContainText('2 folders');
  // The folders are on demand, in a popover, not on the page.
  await row(page, a as string).getByRole('button', { name: /^Show the 2 folders of/ }).click();
  const list = page.getByRole('dialog', { name: `Folders of ${a}` });
  await expect(list).toContainText('IRB approvals');
  await expect(list).toContainText('Protocol amendments');
  await page.keyboard.press('Escape');

  // Preview shows the file from the browser's own copy.
  await page.getByRole('button', { name: `Preview ${a}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'File preview' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Shown from the copy in your browser. Nothing has been sent yet.');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // Send asks first; Cancel is the default, and Esc sends nothing.
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const ask = page.getByRole('dialog', { name: 'Send 2 files to 2 folders?' });
  await expect(ask).toContainText('4 deliveries to 1 team.');
  await expect(ask).toContainText("Delivered files can't be recalled.");
  await expect(ask.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(ask).toHaveCount(0);
  await expect(page.locator('.frow[data-id]')).toHaveCount(2); // nothing was sent
  await page.getByRole('button', { name: 'Clear' }).click();
});

test('a distribution can have at most 20 destinations', async ({ page }) => {
  await signIn(page, 'load.user@example.com'); // in 50 teams (the load seed)
  await page.getByLabel('Choose files').setInputFiles([{ name: `limit-${randomUUID().slice(0, 6)}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.7\n${randomUUID()}\n%%EOF\n`) }]);
  await expect(page.getByText('Ready', { exact: true })).toHaveCount(1, { timeout: 90_000 }); // the reason names the first problem
  const team = (n: number) => `Load Team ${String(n).padStart(2, '0')}`;
  // Only folders can be ticked: open the team, then the binder inside it, then tick the folder.
  const tickFolder = async (n: number, binder: string, folder: string): Promise<void> => {
    const box = page.getByRole('checkbox', { name: new RegExp(` to ${team(n)} / ${binder} / ${folder}$`) });
    if (!(await box.isVisible())) {
      const teamBlock = page.getByRole('button', { name: new RegExp(`^(Expand|Collapse) ${team(n)}$`) }).locator('xpath=ancestor::div[2]');
      if ((await teamBlock.getByRole('button', { name: `Expand ${binder}` }).count()) === 0) {
        await page.getByRole('button', { name: `Expand ${team(n)}` }).click();
      }
      await teamBlock.getByRole('button', { name: `Expand ${binder}` }).click();
    }
    await box.click();
  };
  for (let n = 1; n <= 10; n += 1) {
    await tickFolder(n, 'Regulatory', 'RA');
    await tickFolder(n, 'Operations', 'OA');
  }
  // The 21st can be ticked. The limit is checked at Send: Send is off and says why (D-F1-4).
  await tickFolder(11, 'Regulatory', 'RA');
  await expect(page.getByRole('checkbox', { name: new RegExp(` to ${team(11)} / Regulatory / RA$`) })).toBeChecked();
  await expect(page.locator('.send-reason')).toHaveText('A distribution can have at most 20 destinations.');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();

  await tickFolder(11, 'Regulatory', 'RA'); // untick it: valid again
  await expect(page.locator('.send-reason')).not.toHaveText('A distribution can have at most 20 destinations.');
  await page.getByRole('button', { name: 'Clear' }).click();
});

test('the browser asks before a page that holds files is closed', async ({ page }) => {
  await signIn(page, PRIYA);
  await addPdfs(page, 1, 'leave');
  await page.locator('body').click(); // the browser only asks after the page has been used
  const asked = page.waitForEvent('dialog', { timeout: 10_000 });
  void page.close({ runBeforeUnload: true });
  const dialog = await asked;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss(); // stay
  expect(page.isClosed()).toBe(false);

  // With nothing on the page there is nothing to lose, so no question.
  await page.getByRole('button', { name: 'Clear' }).click();
  let again = false;
  page.on('dialog', (d) => {
    again = true;
    void d.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  expect(again).toBe(false);
});

test('signing out with files on the page leaves nothing for the next person', async ({ page }) => {
  await signIn(page, PRIYA);
  await addPdfs(page, 1, 'bye');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Work email').fill(PRIYA);
  await page.getByLabel('Password').fill(env.SEED_USER_PASSWORD as string);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(page.locator('.frow:not(.thead)')).toHaveCount(0);
});
