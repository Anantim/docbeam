import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { expect, test } from '@playwright/test';
import {
  addPdfs,
  CARDIO_IRB,
  CARDIO_PROTOCOL,
  chip,
  clearPage,
  columnReport,
  docx,
  makePdf,
  PRIYA,
  RAJ,
  readCounts,
  rgb,
  send,
  sendFiles,
  signIn,
  tick,
  tooltipOf,
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

test('a disabled button has the disabled attribute and the not-allowed cursor, and looks off; no tooltip says why (D-F1-20)', async ({ page }) => {
  await signIn(page, PRIYA);
  for (const name of ['Send', 'Clear'] as const) {
    const button = page.getByRole('button', { name });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('disabled', '');
    await expect(button).toHaveCSS('cursor', 'not-allowed');
    // The reason, when there is one, is text beside the buttons: Send has no tooltip. Clear says what it does, even while off (D-F1-72).
    expect(await tooltipOf(page, button)).toBe(name === 'Clear' ? 'Remove all files and folder ticks' : null);
    await expect(button).toHaveCSS('color', rgb('#98A2B3')); // greyed, not the live colour
  }
  // An enabled button of the same kind does not look like that.
  await addPdfs(page, 1, 'look');
  await expect(page.getByRole('button', { name: 'Clear' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Clear' })).toHaveCSS('cursor', 'pointer');
  await clearPage(page);
});

test('on Status, a delivered file has live Preview and Download icon buttons', async ({ page }) => {
  await signIn(page, PRIYA);
  const { names } = await sendFiles(page, 1, [CARDIO_IRB]);
  await expect(chip(page)).toHaveText('Completed', { timeout: 90_000 });
  const name = names[0] as string;
  for (const kind of ['Preview', 'Download']) {
    const label = `${kind} ${name}`;
    const button = page.getByRole('button', { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(in `) }); // the name says which folder (D-F1-81)
    await expect(button).toBeEnabled();
    expect(await tooltipOf(page, button)).toBe(label);
    await expect(button).toHaveCSS('cursor', 'pointer');
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

  // Ready (a file) and Completed (a delivery) both mean "done": one component, one colour.
  expect(verified.classes).toBe(delivered.classes);
  expect(verified).toEqual(delivered);
  expect(verified.tone).toBe('ok');
  expect(verified.dot).not.toBe('none');
  // The distribution's own chip is the same component, in the big size.
  expect(await page.locator('.status-chip.big').getAttribute('data-tone')).toBe('ok');
});

test('file type badges show the type as text, in one neutral style: colour is kept for status (D-F1-5)', async ({ page }) => {
  await signIn(page, PRIYA);
  // Real contents of each type: the page reads the bytes and adds only a file that is what its name says (D-F1-44).
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
  const xlsx = new JSZip();
  xlsx.file('[Content_Types].xml', '<Types/>');
  xlsx.file('xl/workbook.xml', '<workbook/>');
  const files = [
    { name: 'a.pdf', mimeType: 'application/pdf', type: 'PDF', bytes: makePdf('badge') },
    { name: 'b.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', type: 'DOCX', bytes: await docx('badge') },
    { name: 'c.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', type: 'XLSX', bytes: await xlsx.generateAsync({ type: 'nodebuffer' }) },
    { name: 'd.png', mimeType: 'image/png', type: 'PNG', bytes: png },
    { name: 'e.jpg', mimeType: 'image/jpeg', type: 'JPG', bytes: jpg },
  ];
  const unique = files.map((f) => ({ ...f, name: `${randomUUID().slice(0, 6)}-${f.name}` }));
  await page.getByLabel('Choose files').setInputFiles(unique.map((f) => ({ name: f.name, mimeType: f.mimeType, buffer: f.bytes })));
  for (const f of unique) await expect(page.locator('.frow', { hasText: f.name }).locator('.typetile')).toHaveText(f.type);
  const colours = await page.locator('.frow .typetile').evaluateAll((els: BrowserElement[]) => els.map((e) => getComputedStyle(e).color + getComputedStyle(e).backgroundColor));
  expect(new Set(colours).size).toBe(1);
  await clearPage(page);
});

test('after one wrong password the same fixed pause note appears; a right password signs in', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByTestId('pause-note')).toHaveCount(0);

  // An address that has no account: the note is the same, so it shows nothing about which accounts exist.
  await page.getByLabel('Work email').fill(`nobody.${randomUUID().slice(0, 8)}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('not-a-real-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  const unknown = await page.getByTestId('pause-note').textContent();

  // One wrong password for a real account (only one: five in a row would pause it), then the right one.
  await page.getByLabel('Work email').fill(RAJ);
  await page.getByLabel('Password', { exact: true }).fill('wrong-password-once');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('pause-note')).toHaveText(PAUSE_NOTE);
  expect(unknown).toBe(PAUSE_NOTE);
  await expect(page.getByRole('alert')).toContainText('Email or password is incorrect.');

  await page.getByLabel('Password', { exact: true }).fill(env.SEED_USER_PASSWORD as string);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(page.getByTestId('pause-note')).toHaveCount(0);
});

test('the Documents table sizes to its content and the deliveries panel does not scroll sideways, at 1280 and 1920 px, with long text cut short and shown in full', async ({ page }) => {
  await signIn(page, PRIYA);
  const longName = `quarterly-regulatory-binder-update-for-the-cardio-study-${'x'.repeat(30)}-${randomUUID().slice(0, 6)}.pdf`;
  await page.getByLabel('Choose files').setInputFiles([{ name: longName, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.7\n${randomUUID()}\n%%EOF\n`) }]);
  await expect(page.getByText('Ready', { exact: true })).toHaveCount(1, { timeout: 90_000 });
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
        if (i === 2 && label === 'Documents') continue; // the state column has a minimum width for its chip and a reason line
        if (i === 1 && label === 'Deliveries') continue; // Destination takes the spare room (D-M3-17)
        if (c.header === '') continue; // the checkbox column
        expect(c.width, `${where}: "${c.header}" is wider than its content`).toBeLessThanOrEqual(c.need + 48);
      }
      // The file name takes the room that is left: it is at least as wide as every other column but one.
      const widths = report.columns.map((c) => c.width).sort((a, b) => b - a);
      const nameWidth = report.columns[1]?.width ?? 0; // Documents: the name; Deliveries: the destination
      expect(nameWidth, `${where}: the column that takes the spare room is not the widest`).toBeGreaterThanOrEqual(widths[1] ?? 0);

      // A long name ends with an ellipsis and its full text is in the title.
      const cell = page.locator(nameCell).first();
      await expect(cell).toHaveCSS('text-overflow', 'ellipsis');
      expect(await tooltipOf(page, cell), `${label} at ${width}`).toContain(longName);
      if (width === 1280) expect(await cell.evaluate((el: BrowserElement) => el.scrollWidth > el.clientWidth), `${label} at 1280 should be cut short`).toBe(true);
    }
  };

  await check('.ftable .frow.thead', '.ftable .frow:not(.thead)', '.fname .fname-text', 'Documents');

  await page.setViewportSize({ width: 1280, height: 900 });
  await send(page);
  await expect(chip(page)).toHaveText('Completed', { timeout: 90_000 });
  // The deliveries sit in the side panel: no sideways scroll, and a long file name ends with an ellipsis (full text in its title).
  for (const width of [1280, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(300);
    const cell = page.locator('.ttable .tfile').first();
    await expect(cell).toHaveCSS('text-overflow', 'ellipsis');
    expect(await tooltipOf(page, cell), `Deliveries at ${width}`).toContain(longName);
    expect(await page.locator('.panel').evaluate((el: BrowserElement) => el.scrollWidth <= el.clientWidth + 1), `the panel scrolls sideways at ${width}`).toBe(true);
  }
});

// Words on each line of a text, from the position of every word. Runs in the browser.
interface BrowserRange {
  setStart(node: unknown, offset: number): void;
  setEnd(node: unknown, offset: number): void;
  getBoundingClientRect(): { top: number };
}
interface BrowserText {
  data: string;
}
declare const document: { createRange(): BrowserRange };

const wordsPerLine = (el: BrowserElement & { firstChild: BrowserText }): number[] => {
  const text = el.firstChild;
  const lines = new Map<number, number>();
  for (const m of text.data.matchAll(/\S+/g)) {
    const range = document.createRange();
    range.setStart(text, m.index);
    range.setEnd(text, m.index + m[0].length);
    const top = Math.round(range.getBoundingClientRect().top);
    lines.set(top, (lines.get(top) ?? 0) + 1);
  }
  return [...lines.entries()].sort((a, b) => a[0] - b[0]).map((l) => l[1]);
};

test('the sign-in heading and subtext wrap in balance: no line ends with a single word', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'One upload, every binder that needs it.' })).toBeVisible();
  await expect(page.getByText('Clinical trial document distribution for study teams')).toBeVisible();
  await expect(page).toHaveTitle(/Clinical trial document distribution for study teams/);
  for (const width of [375, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const selector of ['.auth-brand h1', '.auth-brand p']) {
      await expect(page.locator(selector)).toHaveCSS('text-wrap-style', 'balance');
      const lines = await page.locator(selector).evaluate(wordsPerLine as (el: BrowserElement) => number[]);
      const where = `${selector} at ${width}: words per line ${JSON.stringify(lines)}`;
      console.log(where);
      if (lines.length > 1) expect(lines.at(-1), where).toBeGreaterThanOrEqual(2);
    }
  }
});
