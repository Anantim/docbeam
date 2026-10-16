import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  addPdfs,
  CARDIO_IRB,
  CARDIO_PROTOCOL,
  chip,
  columnReport,
  PRIYA,
  RAJ,
  readCounts,
  rgb,
  send,
  sendFiles,
  signIn,
  tick,
} from './helpers.js';
import { env } from '../integration/helpers.js';

// The look of the screens (D-M3-10, D-M3-12, D-M3-13), checked in a real browser.

// The functions given to `evaluate` run in the browser. These tests are compiled without the DOM types (the rest
// of the repo is Node code), so the few things they touch are declared here.
interface BrowserElement {
  tagName: string;
  className: string;
  scrollWidth: number;
  clientWidth: number;
  getAttribute(name: string): string | null;
  querySelector(selector: string): BrowserElement | null;
}
interface BrowserStyle {
  backgroundColor: string;
  color: string;
  borderRadius: string;
  fontSize: string;
}
declare function getComputedStyle(el: BrowserElement): BrowserStyle;

const PAUSE_NOTE = 'After 5 wrong passwords in a row, sign-in pauses for 15 minutes. Wait, then try again.';

test('a disabled button has the disabled attribute and the not-allowed cursor, and says why', async ({ page }) => {
  await signIn(page, PRIYA);
  for (const [name, title] of [
    [/^Send 0 deliver/, 'Add a file first'],
    ['Clear', 'Nothing to clear'],
  ] as const) {
    const button = page.getByRole('button', { name });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('disabled', '');
    await expect(button).toHaveCSS('cursor', 'not-allowed');
    await expect(button).toHaveAttribute('title', title);
    await expect(button).toHaveCSS('color', rgb('#98A2B3')); // greyed, not the live colour
  }
  // An enabled button of the same kind does not look like that.
  await addPdfs(page, 1, 'look');
  await expect(page.getByRole('button', { name: 'Clear' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Clear' })).toHaveCSS('cursor', 'pointer');
  await page.getByRole('button', { name: 'Clear' }).click();
});

test('on Status, Preview and Download are icon buttons that look off, say why, and do nothing', async ({ page }) => {
  await signIn(page, PRIYA);
  const { names } = await sendFiles(page, 1, [CARDIO_IRB]);
  await expect(chip(page)).toHaveText('Completed', { timeout: 90_000 });
  const name = names[0] as string;
  for (const kind of ['Preview', 'Download']) {
    const label = `${kind} ${name}. Available in the next version`;
    const button = page.getByRole('button', { name: label });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('title', label);
    await expect(button).toHaveCSS('cursor', 'not-allowed');
    await expect(button).toHaveClass(/\bicon\b/); // the same form as on Distribute
  }
});

test('there is no Cancel on a completed distribution', async ({ page }) => {
  await signIn(page, PRIYA);
  await sendFiles(page, 1, [CARDIO_IRB]);
  await expect(chip(page)).toHaveText('Completed', { timeout: 90_000 });
  expect(await readCounts(page)).toEqual([1, 0, 0, 0]);
  await expect(page.getByRole('button', { name: 'Cancel distribution' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry failed deliveries' })).toHaveCount(0); // nothing failed
});

test('a file state on Distribute and a delivery state on Status are the same chip, in the same colour', async ({ page }) => {
  await signIn(page, PRIYA);
  await addPdfs(page, 1, 'chip');
  await tick(page, CARDIO_IRB);
  // (These functions run in the browser.)
  const look = (selector: string): Promise<Record<string, string>> =>
    page.locator(selector).first().evaluate((el: BrowserElement) => {
      const dot = el.querySelector('.status-dot');
      const s = getComputedStyle(el);
      return {
        tag: el.tagName,
        tone: el.getAttribute('data-tone') ?? '',
        classes: el.className,
        background: s.backgroundColor,
        color: s.color,
        dot: dot ? getComputedStyle(dot).backgroundColor : 'none',
        radius: s.borderRadius,
        fontSize: s.fontSize,
      };
    });

  const verified = await look('.frow .status-chip');
  await send(page);
  await expect(chip(page)).toHaveText('Completed', { timeout: 90_000 });
  const delivered = await look('.ttable .status-chip');

  // Verified (a file) and Delivered (a delivery) both mean "done": one component, one colour.
  expect(verified.classes).toBe(delivered.classes);
  expect(verified).toEqual(delivered);
  expect(verified.tone).toBe('ok');
  expect(verified.dot).not.toBe('none');
  // The distribution's own chip is the same component, in the big size.
  expect(await page.locator('.status-chip.big').getAttribute('data-tone')).toBe('ok');
});

test('file type badges are coloured by type and keep their text', async ({ page }) => {
  await signIn(page, PRIYA);
  const bytes = Buffer.from('x');
  const files = [
    { name: 'a.pdf', mimeType: 'application/pdf', type: 'PDF', bg: '#FEE4E2', fg: '#B42318' },
    { name: 'b.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', type: 'DOCX', bg: '#D1E0FF', fg: '#1849A9' },
    { name: 'c.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', type: 'XLSX', bg: '#D1FADF', fg: '#05603A' },
    { name: 'd.png', mimeType: 'image/png', type: 'PNG', bg: '#E9D7FE', fg: '#6941C6' },
    { name: 'e.jpg', mimeType: 'image/jpeg', type: 'JPG', bg: '#E9D7FE', fg: '#6941C6' },
  ];
  const unique = files.map((f) => ({ ...f, name: `${randomUUID().slice(0, 6)}-${f.name}` }));
  await page.getByLabel('Choose files').setInputFiles(unique.map((f) => ({ name: f.name, mimeType: f.mimeType, buffer: bytes })));
  for (const f of unique) {
    const badge = page.locator('.frow', { hasText: f.name }).locator('.typetile');
    await expect(badge).toHaveText(f.type);
    await expect(badge).toHaveCSS('background-color', rgb(f.bg));
    await expect(badge).toHaveCSS('color', rgb(f.fg));
  }
  // PDF red, DOCX blue, XLSX green, PNG and JPG purple: three of the five pairs differ, and PNG equals JPG.
  const colours = await page.locator('.frow .typetile').evaluateAll((els: BrowserElement[]) => els.map((e) => getComputedStyle(e).color));
  expect(new Set(colours).size).toBe(4);
  await page.getByRole('button', { name: 'Clear' }).click();
});

test('after one wrong password the same fixed pause note appears; a right password signs in', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByTestId('pause-note')).toHaveCount(0);

  // An address that has no account: the note is the same, so it shows nothing about which accounts exist.
  await page.getByLabel('Work email').fill(`nobody.${randomUUID().slice(0, 8)}@example.com`);
  await page.getByLabel('Password').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  const unknown = await page.getByTestId('pause-note').textContent();

  // One wrong password for a real account (only one: five in a row would pause it), then the right one.
  await page.getByLabel('Work email').fill(RAJ);
  await page.getByLabel('Password').fill('wrong-password-once');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('pause-note')).toHaveText(PAUSE_NOTE);
  expect(unknown).toBe(PAUSE_NOTE);
  await expect(page.getByRole('alert')).toContainText('Email or password is incorrect.');

  await page.getByLabel('Password').fill(env.SEED_USER_PASSWORD as string);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(page.getByTestId('pause-note')).toHaveCount(0);
});

test('the tables size to their content at 1280 and 1920 px, with long text cut short and shown in full', async ({ page }) => {
  await signIn(page, PRIYA);
  const longName = `quarterly-regulatory-binder-update-for-the-cardio-study-${'x'.repeat(30)}-${randomUUID().slice(0, 6)}.pdf`;
  await page.getByLabel('Choose files').setInputFiles([{ name: longName, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.7\n${randomUUID()}\n%%EOF\n`) }]);
  await expect(page.getByText('Verified', { exact: true })).toHaveCount(1, { timeout: 90_000 });
  await tick(page, CARDIO_IRB);
  await tick(page, CARDIO_PROTOCOL);

  const check = async (head: string, rows: string, nameCell: string, label: string): Promise<void> => {
    for (const width of [1280, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(300);
      const report = await columnReport(page, head, rows);
      const where = `${label} at ${width}: ${JSON.stringify(report.columns)}`;
      expect(report.overflow, `${where}: scrolls sideways`).toBeLessThanOrEqual(1);
      // Every column but the file name is no wider than its content needs (a little room for gaps).
      for (const [i, c] of report.columns.entries()) {
        if (i === 1 && label === 'Documents') continue; // the name column takes the spare room
        if (i === 0 && label === 'Deliveries') continue;
        if (c.header === '') continue; // the checkbox column
        expect(c.width, `${where}: "${c.header}" is wider than its content`).toBeLessThanOrEqual(c.need + 48);
      }
      // The file name takes the room that is left: it is at least as wide as every other column but one.
      const widths = report.columns.map((c) => c.width).sort((a, b) => b - a);
      const nameWidth = report.columns[label === 'Documents' ? 1 : 0]?.width ?? 0;
      expect(nameWidth, `${where}: the file column should take the spare room`).toBeGreaterThanOrEqual(widths[1] ?? 0);

      // A long name ends with an ellipsis and its full text is in the title.
      const cell = page.locator(nameCell).first();
      await expect(cell).toHaveCSS('text-overflow', 'ellipsis');
      expect(await cell.getAttribute('title'), `${label} at ${width}`).toContain(longName);
      if (width === 1280) expect(await cell.evaluate((el: BrowserElement) => el.scrollWidth > el.clientWidth), `${label} at 1280 should be cut short`).toBe(true);
    }
  };

  await check('.ftable .frow.thead', '.ftable .frow:not(.thead)', '.fname .link.plain', 'Documents');

  await page.setViewportSize({ width: 1280, height: 900 });
  await send(page);
  await expect(chip(page)).toHaveText('Completed', { timeout: 90_000 });
  await check('.ttable .trow.thead', '.ttable .tscroll .trow', '.ttable .tfile', 'Deliveries');
});
