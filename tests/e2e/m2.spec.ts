import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { env } from '../integration/helpers.js';
import { addPdfs, CARDIO_IRB, docx, makePdf, pdf, CARDIO_PROTOCOL, chip, PRIYA, RAJ, readCounts, send, signIn, tick } from './helpers.js';

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
  // Ready, but nowhere to send it yet: the words beside Clear say what is missing, tied to Send, with no tooltip (D-F1-20).
  await expect(page.locator('.send-reason')).toHaveText('Choose folders for 1 file');
  await expect(send0).toHaveAttribute('aria-describedby', (await page.locator('.send-reason').getAttribute('id')) as string);
  await expect(send0).not.toHaveAttribute('title', /.+/);
  await expect(page.locator('.send-summary')).toHaveCount(0); // the summary line is gone from the bar

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
  await expect(page.locator('.send-reason')).toHaveText(''); // the empty page says nothing: the drop area says what to do
  await expect(page.getByRole('region', { name: 'Destinations' }).locator('.card-hint')).toHaveCount(0); // nothing ticked: no words beside the title
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

test('a file type that is not allowed is listed in one calm "not added" box with one Close button; it stays until closed or the page is cleared (D-F1-35)', async ({ page }) => {
  await signIn(page, PRIYA);
  await page.getByLabel('Choose files').setInputFiles([{ name: 'setup.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') }]);
  const notAdded = page.locator('.not-added');
  await expect(notAdded).toContainText('1 file not added'); // singular
  await expect(notAdded.locator('.not-added-name')).toHaveText('setup.exe');
  await expect(notAdded.locator('.not-added-reason')).toHaveText('This type is not allowed. Use PDF, DOCX, XLSX, PNG or JPG.');
  await expect(page.locator('.frow:not(.thead)')).toHaveCount(0);
  await expect(notAdded.getByRole('button')).toHaveCount(1); // one button for the whole box, none per line
  // A second refused file is added to the same box (plural), and nothing dismisses it on its own.
  await page.getByLabel('Choose files').setInputFiles([{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }]);
  await expect(notAdded).toContainText('2 files not added');
  await page.waitForTimeout(1500);
  await expect(notAdded).toHaveCount(1);
  await notAdded.getByRole('button', { name: 'Close' }).click();
  await expect(notAdded).toHaveCount(0);
  // It also goes when the page is cleared.
  await page.getByLabel('Choose files').setInputFiles([{ name: 'setup.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') }]);
  await expect(notAdded).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(notAdded).toHaveCount(0);
});

test('a malware test file is refused by the scan, can never be sent, and only its owner has the audit event (in the API; the page shows none)', async ({ page }) => {
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
  await expect(page.locator('.send-reason')).toHaveText('Remove the file refused for malware'); // it is the only file
  await page.getByRole('button', { name: `Remove ${name}` }).click();
  await expect(row(page, name)).toHaveCount(0);

  // The web app has no audit view (D-F1-13): a refused file shows only in the Distribute file list, and Status has no Upload events.
  await page.getByRole('button', { name: 'Status' }).click();
  await expect(page.getByRole('button', { name: 'Upload events' })).toHaveCount(0);
  await expect(page.getByText('File refused')).toHaveCount(0);

  // The backend still writes the refusal to Priya's audit trail, and to nobody else's.
  const login = async (email: string): Promise<string> => {
    const res = await page.request.post('/api/auth/login', { data: { email, password: env.SEED_USER_PASSWORD } });
    expect(res.status()).toBe(200);
    return (await res.json()).accessToken as string;
  };
  const refusals = async (email: string): Promise<number> => {
    const res = await page.request.get('/api/audit?action=file.refused', { headers: { authorization: `Bearer ${await login(email)}` } });
    expect(res.status()).toBe(200);
    return ((await res.json()).events as Array<{ detail: { reason?: string } }>).filter((e) => JSON.stringify(e).includes(name)).length;
  };
  expect(await refusals(PRIYA)).toBeGreaterThan(0);
  expect(await refusals(RAJ)).toBe(0);
});

test('ticking a folder applies to the selected file only, until none is selected (the "for N selected files" words beside Destinations)', async ({ page }) => {
  await signIn(page, PRIYA);
  const dest = page.getByRole('region', { name: 'Destinations' });
  const [a, b] = await addPdfs(page, 2, 'scope');
  await expect(dest.locator('.card-hint')).toHaveCount(0); // none selected: nothing beside the title
  await row(page, a as string).locator('.fname').click(); // a click on a row selects it
  await expect(dest.locator('.card-hint')).toHaveText('for 1 selected file');
  await expect(page.getByRole('button', { name: 'Use all files' })).toHaveCount(0); // the strip is gone
  await tick(page, CARDIO_IRB);
  await expect(row(page, a as string).locator('.chips')).toContainText('1 folder');
  await expect(row(page, b as string)).toContainText('None yet');
  await expect(page.locator('.send-reason')).toHaveText('Choose folders for 1 file');

  // The Files header checkbox selects all, and a second click selects none: a tick then goes to all files.
  await page.getByLabel('Select all to choose their folders').click();
  await expect(dest.locator('.card-hint')).toHaveText('for 2 selected files');
  await page.getByLabel('Select all to choose their folders').click();
  await expect(dest.locator('.card-hint')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.locator('.frow:not(.thead)')).toHaveCount(0);
});

test('a file shows how many folders it goes to, with the list on demand; Preview opens its own copy; Send asks first', async ({ page }) => {
  await signIn(page, PRIYA);
  const [a] = await addPdfs(page, 2, 'review');
  await tick(page, CARDIO_IRB);
  await tick(page, CARDIO_PROTOCOL);
  await expect(page.locator('.send-summary')).toHaveCount(0); // the full summary is in the question that Send asks
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
  await expect(dialog.locator('.pv-meta')).toHaveText(/^[\d.,]+ (B|KB|MB|GB)$/); // the size only (D-F1-27)
  await expect(dialog).not.toContainText('not sent yet');
  await expect(dialog).not.toContainText('Shown from the copy in your browser'); // and there is no footer line (D-F1-23)
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // Send asks first; Cancel is the default, and Esc sends nothing.
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const ask = page.getByRole('dialog', { name: 'Send 2 files to 2 folders?' });
  await expect(ask).not.toContainText('deliveries'); // the title says what goes where; no count of deliveries or teams (D-F1-23)
  await expect(ask.locator('p')).toHaveText(["Delivered files can't be recalled."]); // one line
  await expect(ask).toContainText("Delivered files can't be recalled.");
  await expect(ask.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(ask).toHaveCount(0);
  await expect(page.locator('.frow[data-id]')).toHaveCount(2); // nothing was sent
  await page.getByRole('button', { name: 'Clear' }).click();
});

test('before sending, the preview shows a real multi-page PDF, a DOCX and an image, with no footer line (D-F1-23)', async ({ page }) => {
  await signIn(page, PRIYA);
  const id = randomUUID().slice(0, 6);
  const PDF = `multi-${id}.pdf`;
  const DOCX = `letter-${id}.docx`;
  const PNG = `scan-${id}.png`;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
  await page.getByLabel('Choose files').setInputFiles([
    { name: PDF, mimeType: 'application/pdf', buffer: makePdf(`Consent ${id}`, 3) },
    { name: DOCX, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await docx(`Letter of intent ${id}`) },
    { name: PNG, mimeType: 'image/png', buffer: png },
  ]);
  await expect(page.getByText('Ready', { exact: true })).toHaveCount(3, { timeout: 90_000 });
  const dialog = page.getByRole('dialog', { name: 'File preview' });

  // The PDF is the browser's own copy in the viewer's frame: three pages, each with its text.
  await page.getByRole('button', { name: `Preview ${PDF}`, exact: true }).click();
  const frame = page.getByTitle(`Preview of ${PDF}`);
  await expect(frame).toBeVisible();
  const text = (await page.evaluate(`fetch(document.querySelector('iframe[title="Preview of ${PDF}"]').src).then((r) => r.text())`)) as string;
  expect(text).toContain('/Count 3');
  for (const n of [1, 2, 3]) expect(text).toContain(`(Page ${n} of 3)`);
  expect(text).toContain(`Consent ${id}`);
  await expect(dialog).not.toContainText('Shown from the copy in your browser');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: `Preview ${DOCX}`, exact: true }).click();
  await expect(page.frameLocator(`iframe[title="Preview of ${DOCX}"]`).locator('body')).toContainText(`Letter of intent ${id}`);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: `Preview ${PNG}`, exact: true }).click();
  const image = dialog.getByRole('img', { name: PNG });
  await expect(image).toBeVisible();
  expect(await image.evaluate((el) => (el as unknown as { naturalWidth: number }).naturalWidth)).toBeGreaterThan(0); // it decoded
  await page.keyboard.press('Escape');
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
