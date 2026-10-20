import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';
import { env } from '../integration/helpers.js';
import { addPdfs, CARDIO_IRB, docx, CARDIO_PROTOCOL, pdf, pickFilter, PRIYA, RAJ, send, signIn, sql, tick } from './helpers.js';

// Takes a screenshot of every screen and dialog at 1440, 1280 and 1024 px wide (F1). It does not assert anything and
// only runs when SHOT_DIR is set: SHOT_DIR=docs/testing/f1-evidence/after npx playwright test screens
const dir = process.env.SHOT_DIR;
const sizes = [
  { w: 1440, h: 900 },
  { w: 1280, h: 800 },
  { w: 1024, h: 768 },
];
const unauthorised = { status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Sign in again.' } }) };

test.describe('screens', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });
  test.skip(dir === undefined, 'set SHOT_DIR to take screenshots');
  test.setTimeout(300_000);

  test('every screen at three widths', async ({ page }) => {
    mkdirSync(dir as string, { recursive: true });
    // A whole-page picture, or (for a scrolled page) what the viewport shows right now.
    const shot = async (name: string, viewportOnly = false): Promise<void> => {
      for (const s of sizes) {
        await page.setViewportSize({ width: s.w, height: s.h });
        await page.waitForTimeout(250);
        await page.screenshot({ path: `${dir}/${name}-${s.w}.png`, fullPage: !viewportOnly });
      }
    };

    await page.goto('/');
    await shot('01-sign-in');
    await page.getByLabel('Work email').fill('nobody@example.com');
    await page.getByLabel('Password').fill('wrong-password-here');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('alert').waitFor();
    await shot('02-sign-in-error');

    // Distribute: empty, folders chosen before any file, files with no folders, some files ticked, ready to send.
    await signIn(page, PRIYA);
    await shot('03-distribute-empty');
    await tick(page, CARDIO_IRB);
    await tick(page, CARDIO_PROTOCOL);
    await shot('04-distribute-folders-before-files');
    await page.getByRole('button', { name: 'Clear' }).click();

    // The file states: Scanning, Failed (a scan that could not run, with Retry), Refused (malware: final).
    const state = (name: string) => page.locator('.frow', { hasText: name }).locator('.status-chip');
    await page.getByLabel('Choose files').setInputFiles([pdf('scanning-now.pdf')]);
    await state('scanning-now.pdf').filter({ hasText: 'Scanning' }).waitFor({ timeout: 60_000 });
    await shot('05a-file-scanning', true);
    await page.getByRole('button', { name: 'Clear' }).click();
    await page.route('**/api/files?**', async (route) => {
      const ids = (new URL(route.request().url()).searchParams.get('ids') ?? '').split(',').filter(Boolean);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ids.map((fileId) => ({ fileId, uploaded: true, scanStatus: 'failed' }))) });
    });
    await page.getByLabel('Choose files').setInputFiles([pdf('could-not-scan.pdf')]);
    await state('could-not-scan.pdf').filter({ hasText: 'Failed' }).waitFor({ timeout: 60_000 });
    await shot('05b-file-failed-with-retry', true);
    await page.unroute('**/api/files?**');
    await page.getByRole('button', { name: 'Clear' }).click();
    await page.getByLabel('Choose files').setInputFiles([{ name: 'eicar-test.pdf', mimeType: 'application/pdf', buffer: Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*') }]);
    await state('eicar-test.pdf').filter({ hasText: 'Refused' }).waitFor({ timeout: 90_000 });
    await shot('05c-file-refused-malware', true);
    // A refused file that was not added at all (a type that is not allowed): the calm "not added" box.
    await page.getByLabel('Choose files').setInputFiles([{ name: 'setup.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') }]);
    await page.locator('.not-added').waitFor();
    await shot('05d-not-added-box', true);
    await page.getByRole('button', { name: 'Clear' }).click();
    await addPdfs(page, 3, 'shot');
    await shot('05-distribute-files-no-folders');
    const rows = page.locator('.frow:not(.thead) .fname');
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Control'] });
    await shot('06-distribute-two-files-ticked');
    await page.getByLabel('Select all to choose their folders').click();
    await page.getByLabel('Select all to choose their folders').click(); // none selected: a tick goes to all files
    await tick(page, CARDIO_IRB);
    await tick(page, CARDIO_PROTOCOL);
    await shot('07-distribute-ready-to-send');
    // Several files ticked with a folder only for some of them: "2 of 3 files", and the popover that lists them.
    await rows.nth(0).click();
    await rows.nth(1).click();
    await page.getByRole('checkbox', { name: /to Cardio \/ CARDIO-301 Regulatory \/ IRB approvals/ }).click(); // off for the two
    await page.getByRole('checkbox', { name: /to Cardio \/ CARDIO-301 Regulatory \/ IRB approvals/ }).click(); // on for the two
    await shot('07a-two-files-ticked-folder-counts', true);
    await rows.nth(0).click();
    await rows.nth(1).click(); // none ticked again: the counts are over all three
    await page.locator('.folder-files').first().click();
    await page.getByRole('dialog', { name: /^Files for / }).waitFor();
    await shot('07b-folder-count-popover', true);
    await page.keyboard.press('Escape');
    await page.mouse.move(2, 2);

    await page.getByRole('button', { name: /^Preview/ }).first().click();
    await page.waitForTimeout(800);
    await shot('08-preview-dialog');
    await page.keyboard.press('Escape');
    // A DOCX and an image too, so the previews of each kind are in the pictures.
    const letter = 'Letter of intent.docx';
    const scan = 'Site photo.png';
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
    await page.getByLabel('Choose files').setInputFiles([
      { name: letter, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await docx('Letter of intent for the Cardio-301 study') },
      { name: scan, mimeType: 'image/png', buffer: png },
    ]);
    await page.getByText('Ready', { exact: true }).nth(4).waitFor({ timeout: 90_000 });
    await page.getByRole('button', { name: `Preview ${letter}`, exact: true }).click();
    await page.getByTitle(`Preview of ${letter}`).waitFor();
    await page.waitForTimeout(600);
    await shot('08b-preview-docx', true);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: `Preview ${scan}`, exact: true }).click();
    await page.getByRole('img', { name: scan }).waitFor();
    await shot('08c-preview-image', true);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await shot('09-send-question');
    await page.getByRole('dialog').getByRole('button', { name: 'Send', exact: true }).click();
    await page.waitForURL(/#\/status\//);
    await page.waitForTimeout(500);
    await shot('10a-moment-after-send', true); // Status on the new distribution, the toast "Sent", the heading in focus
    await page.waitForTimeout(3500);
    const sentId = (page.url().split('/status/')[1] ?? '').split('?')[0] as string;
    await shot('10-status-panel-open');
    await page.getByRole('complementary').getByRole('button', { name: 'Copy link' }).click();
    await page.waitForTimeout(300);
    await shot('11-toast');

    // Status: no filters, the filter menu, two filters set.
    await page.getByRole('button', { name: 'Close' }).click();
    await page.waitForTimeout(500);
    await shot('12-status-no-filters');
    // The fixed screen: the list scrolls in its own area; then with the panel open, scrolled halfway.
    await page.evaluate(`document.querySelector('.dist-scroll').scrollTop = 500`);
    await page.waitForTimeout(250);
    await shot('12b-status-list-scrolled', true);
    await page.locator('.dist-table tbody tr .dist-id').nth(9).click();
    await page.getByRole('complementary').waitFor();
    await page.waitForTimeout(700);
    await page.evaluate(`document.querySelector('.dist-scroll').scrollTop = 300`);
    await page.waitForTimeout(250);
    await shot('12c-status-split-view-scrolled-halfway', true);
    await page.keyboard.press('Escape');
    await page.evaluate(`document.querySelector('.dist-scroll').scrollTop = 0`);
    await page.waitForTimeout(250);
    await page.locator('.dist-table tbody tr').nth(2).hover(); // the copy icon shows on the hovered row
    await shot('13-copy-icon-on-row-hover', true);
    await page.mouse.move(2, 2);
    await page.getByRole('group', { name: 'Filters' }).getByRole('button', { name: /^Sender/ }).click();
    await page.waitForTimeout(300);
    await shot('14-filter-menu-open', true);
    await page.keyboard.press('Escape');
    await pickFilter(page, 'Sender', 'Me');
    await pickFilter(page, 'Sent', 'Last 7 days');
    await page.waitForTimeout(800);
    await shot('15-status-two-filters-set');
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await page.getByRole('button', { name: 'Open by ID' }).click();
    await page.waitForTimeout(300);
    await shot('16-open-by-id', true);
    // Two distributions whose ids start the same: the card lists them to choose from (the 8 characters of the list).
    const [mine] = await sql<{ submitted_by_user_id: string }>("SELECT submitted_by_user_id FROM jobs WHERE submitted_by_name = 'Priya Shah' LIMIT 1");
    for (const n of [1, 2]) {
      await sql(
        "INSERT INTO jobs (id, submitted_by_user_id, submitted_by_name, task_count, idempotency_key) VALUES ($1, $2, 'Priya Shah', 0, gen_random_uuid()::text) ON CONFLICT DO NOTHING",
        [`abcd1234-0000-4000-8000-00000000000${n}`, mine?.submitted_by_user_id],
      );
    }
    await page.getByLabel('Distribution ID or link').fill('abcd1234');
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await page.getByRole('list', { name: 'Distributions with that ID' }).waitFor();
    await shot('16b-open-by-id-several-matches', true);
    await page.keyboard.press('Escape');
    await sql("DELETE FROM jobs WHERE id::text LIKE 'abcd1234-%'");

    // The same dialog on a long page, scrolled down: the backdrop still covers the whole viewport.
    await page.getByRole('button', { name: 'Distribute' }).click();
    await addPdfs(page, 12, 'long');
    await page.getByLabel('Select all to choose their folders').click();
    await tick(page, CARDIO_IRB);
    await page.evaluate(`window.scrollTo(0, document.body.scrollHeight)`);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await shot('17-send-question-on-long-scrolled-page', true);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Clear' }).click();
    await page.getByRole('button', { name: 'Status' }).click();
    await page.locator('.dist-table tbody tr').first().waitFor();

    // The sign-in-again dialog: the server stops accepting the token.
    await page.route('**/api/jobs**', (route) => route.fulfill(unauthorised));
    await page.route('**/api/auth/refresh', (route) => route.fulfill(unauthorised));
    // The filter reads the list; the badge's own read may meet the 401 first: either opens the dialog.
    await Promise.race([pickFilter(page, 'Sender', 'Me').catch(() => undefined), page.getByRole('dialog', { name: 'Sign in again' }).waitFor()]);
    await page.getByRole('dialog', { name: 'Sign in again' }).waitFor();
    await shot('18-session-dialog');

    // And on a long page scrolled to the bottom: the backdrop covers the viewport, whatever the page height.
    await page.unroute('**/api/jobs**');
    await page.unroute('**/api/auth/refresh');
    await page.getByRole('dialog').getByLabel('Password').fill(process.env.DEV_SEED_PASSWORD ?? (env.SEED_USER_PASSWORD as string));
    await page.getByRole('dialog').getByRole('button', { name: 'Sign in again' }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await page.locator('.dist-table tbody tr').first().waitFor();
    await page.evaluate(`window.scrollTo(0, document.documentElement.scrollHeight)`);
    await page.route('**/api/jobs**', (route) => route.fulfill(unauthorised));
    await page.route('**/api/auth/refresh', (route) => route.fulfill(unauthorised));
    // Open the Sender menu and choose "Me" without scrolling the page up to them (a click would).
    await Promise.race([
      (async () => {
        await page.getByRole('group', { name: 'Filters' }).getByRole('button', { name: /^Sender/ }).dispatchEvent('click');
        await page.getByRole('menuitemradio', { name: 'Me', exact: true }).dispatchEvent('click');
      })().catch(() => undefined),
      page.getByRole('dialog', { name: 'Sign in again' }).waitFor(),
    ]);
    await page.getByRole('dialog', { name: 'Sign in again' }).waitFor();
    await shot('19-session-dialog-long-scrolled-page', true);
    await page.unroute('**/api/jobs**');
    await page.unroute('**/api/auth/refresh');
    await page.getByRole('dialog').getByLabel('Password').fill(process.env.DEV_SEED_PASSWORD ?? (env.SEED_USER_PASSWORD as string));
    await page.getByRole('dialog').getByRole('button', { name: 'Sign in again' }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });

    // A distribution of 12 deliveries to Cardio, for the panel that a team member sees at the end.
    await page.getByRole('button', { name: 'Distribute' }).click();
    await addPdfs(page, 12, 'many');
    await tick(page, CARDIO_IRB);
    await send(page);
    await page.locator('.status-chip.big', { hasText: 'Completed' }).waitFor({ timeout: 120_000 });

    // The loading state: the real header, grey bars the shape of the rows. First the list alone, then with the panel open
    // (the compact list and the panel's own loading state), by holding the requests that would fill them.
    await page.route(/\/api\/jobs\?/, () => undefined); // never answered
    await page.route(new RegExp(`/api/jobs/${sentId}$`), () => undefined);
    await page.route(new RegExp(`/api/jobs/${sentId}/tasks`), () => undefined);
    await page.goto('/#/status');
    await page.reload();
    await page.getByLabel('Loading distributions').waitFor();
    await shot('20-status-loading');
    await page.goto(`/#/status/${sentId}`);
    await page.reload();
    await page.getByLabel('Loading the distribution').waitFor();
    await shot('21-status-loading-with-panel');
    await page.unroute(/\/api\/jobs\?/);
    await page.unroute(new RegExp(`/api/jobs/${sentId}$`));
    await page.unroute(new RegExp(`/api/jobs/${sentId}/tasks`));

    // The loading state behind the sign-in dialog: the requests wait, so the placeholders stay under the dialog.
    await page.route('**/api/jobs**', (route) => route.fulfill(unauthorised));
    await page.route('**/api/auth/refresh', (route) => route.fulfill(unauthorised));
    await page.goto('/#/status');
    await page.reload();
    await page.getByRole('dialog', { name: 'Sign in again' }).waitFor();
    await shot('22-loading-behind-session-dialog');
    await page.unroute('**/api/jobs**');
    await page.unroute('**/api/auth/refresh');

    // Someone else's distribution: the panel says "Sent by Priya Shah" with no "(you)".
    await page.getByRole('dialog').getByRole('button', { name: 'Sign out' }).click();
    await signIn(page, RAJ);
    await page.getByRole('button', { name: 'Status' }).click();
    await page.locator('.dist-table tbody tr', { hasText: 'Priya Shah' }).first().click();
    await page.locator('.panel-body > .lead').waitFor();
    await page.waitForTimeout(800);
    // What the screen shows (the panel is at most as tall as it, sticky, and its 12 deliveries scroll inside with a fade).
    await shot('23-panel-team-member-12-deliveries', true);
    await page.getByRole('region', { name: 'Delivery rows, scrolls' }).evaluate((el) => ((el as unknown as { scrollTop: number }).scrollTop = 99999));
    await page.waitForTimeout(300);
    await shot('24-panel-team-member-scrolled-to-the-end', true);
  });

  // Distribute is a fixed screen from 1024 px up (D-F1-39): the cards fill the height; the lists scroll inside them.
  test('distribute layout: few files with a deep tree, many files with a short tree', async ({ page }) => {
    mkdirSync(dir as string, { recursive: true });
    const shot = async (name: string): Promise<void> => {
      for (const s of sizes) {
        await page.setViewportSize({ width: s.w, height: s.h - 200 });
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${dir}/${name}-${s.w}.png` });
      }
    };
    await page.setViewportSize({ width: 1440, height: 700 });
    await signIn(page, PRIYA);
    await addPdfs(page, 2, 'deep');
    const expand = page.getByRole('button', { name: /^Expand / });
    for (let i = 0; i < 20 && (await expand.count()) > 0; i += 1) {
      await expand.first().click();
      await page.waitForTimeout(150);
    }
    await page.evaluate("document.querySelector('.tree').scrollTop = 0");
    await shot('05e-distribute-deep-tree-few-files');
    await page.reload(); // the tree is short again
    await page.getByRole('heading', { name: 'New distribution' }).waitFor();
    await addPdfs(page, 14, 'many');
    await shot('05f-distribute-many-files-tree');
  });
});
