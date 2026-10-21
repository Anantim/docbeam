import { expect, test, type Page } from '@playwright/test';
import {
  addPdfs,
  CARDIO_IRB,
  CARDIO_PROTOCOL,
  chip,
  deleteStagedFiles,
  distRow,
  jobIdOf,
  ONC_ETHICS,
  pickFilter,
  PRIYA,
  RAJ,
  readCounts,
  SAM,
  sendFiles,
  signIn,
  sql,
  startLive,
  startWorkers,
  stopLive,
  tooltipOf,
  withWorkersStopped,
} from './helpers.js';

// Flow 3, Track a job, in a real browser against the local stack (D-M3-11).
//   Priya Shah: Cardio + Oncology.  Raj Mehta: Cardio only.  Sam Ito: Neuro only.
// Deliveries are held by stopping the `workers` container, so each test starts from a known state.
test.describe.configure({ mode: 'serial' });

test.afterAll(() => {
  // Never leave the stack stopped, whatever failed.
  startWorkers();
  startLive();
});

/** Sets a marker on the page. If the page is reloaded the marker is gone, so `stillThere` proves it was not. */
const noReload = (page: Page) => page.evaluate('window.__kept = 1');
const stillThere = async (page: Page): Promise<boolean> => (await page.evaluate('window.__kept === 1')) === true;

test('counts and rows change live, and a reload mid-run loses nothing', async ({ page }) => {
  await signIn(page, PRIYA);
  await withWorkersStopped(async ({ hold, start }) => {
    const { jobId } = await sendFiles(page, 2, [CARDIO_IRB, ONC_ETHICS], hold); // 2 files x 2 folders = 4 deliveries
    await expect(page.getByRole('heading', { name: jobId.slice(0, 8) })).toBeVisible();
    await expect(chip(page)).toHaveText('Pending');
    expect(await readCounts(page)).toEqual([0, 0, 0, 4]);
    await expect(page.locator('.ttable .status-chip', { hasText: 'Pending' })).toHaveCount(4);

    // The Status tab shows a badge for the running distribution.
    await expect(page.locator('.tab-badge')).toBeVisible();
    // Refresh the browser mid-run: the same distribution opens, with the same counts and rows.
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`#/status/${jobId}$`));
    await expect(chip(page)).toHaveText('Pending');
    expect(await readCounts(page)).toEqual([0, 0, 0, 4]);
    await expect(page.locator('.ttable .status-chip', { hasText: 'Pending' })).toHaveCount(4);

    // Deliveries start. The page is not reloaded: the numbers move because pushes arrive.
    await noReload(page);
    start();
    await expect(chip(page)).toHaveText('Completed', { timeout: 90_000 });
    expect(await readCounts(page)).toEqual([4, 0, 0, 0]);
    await expect(page.locator('.ttable .status-chip', { hasText: 'Completed' })).toHaveCount(4);
    expect(await stillThere(page)).toBe(true);

    // The chip explains itself.
    expect(await tooltipOf(page, chip(page))).toBe('Every delivery arrived.');
    expect(await tooltipOf(page, page.locator('.ttable .status-chip').first())).toMatch(/^Delivered to the folder in the platform\./);
  });
});

test('a team viewer sees only their team\'s rows, live; an outsider gets not found', async ({ browser, page }) => {
  const rajContext = await browser.newContext();
  const samContext = await browser.newContext();
  const raj = await rajContext.newPage();
  const sam = await samContext.newPage();
  try {
    await signIn(page, PRIYA);
    await signIn(raj, RAJ);
    await signIn(sam, SAM);

    await withWorkersStopped(async ({ hold, start }) => {
      const { jobId } = await sendFiles(page, 2, [CARDIO_IRB, ONC_ETHICS], hold);

      // Raj: Status shows everything he can see, so the distribution is there; open it.
      await raj.getByRole('button', { name: 'Status' }).click();
      await raj.getByRole('button', { name: `Open distribution ${jobId.slice(0, 8)}` }).click();
      await expect(raj.getByText(/Sent by Priya Shah · .*Showing deliveries to your team: Cardio\./)).toBeVisible();
      await expect(raj.locator('.ttable .status-chip')).toHaveCount(2);
      await expect(raj.locator('.ttable')).toContainText(CARDIO_IRB);
      await expect(raj.locator('.ttable')).not.toContainText('Oncology');
      await expect(raj.locator('.panel')).not.toContainText('Oncology');
      await expect(raj.getByRole('button', { name: 'Cancel distribution' })).toHaveCount(0);
      await expect(raj.getByRole('button', { name: 'Retry failed' })).toHaveCount(0);
      expect(await readCounts(raj)).toEqual([0, 0, 0, 2]);
      expect(await readCounts(page)).toEqual([0, 0, 0, 4]);

      // Both pages move without a reload.
      await noReload(raj);
      start();
      await expect(chip(raj)).toHaveText('Completed', { timeout: 90_000 });
      await expect(chip(page)).toHaveText('Completed', { timeout: 90_000 });
      expect(await readCounts(raj)).toEqual([2, 0, 0, 0]);
      expect(await readCounts(page)).toEqual([4, 0, 0, 0]);
      expect(await stillThere(raj)).toBe(true);

      // Sam is in neither team: the same "not found" as for an id that does not exist.
      await sam.evaluate(`window.location.hash = '#/status/${jobId}'`);
      await expect(sam.getByText('Distribution not found')).toBeVisible();
      await sam.evaluate("window.location.hash = '#/status/00000000-0000-4000-8000-000000000000'");
      await expect(sam.getByText('Distribution not found')).toBeVisible();
      await expect(sam.getByRole('button', { name: `Open distribution ${jobId.slice(0, 8)}` })).toHaveCount(0);

      // Raj's panel of the distribution: Cardio deliveries, nothing about Oncology. The web app shows no audit trail (D-F1-13).
      const panel = raj.getByRole('complementary');
      await expect(panel).toContainText('Cardio');
      await expect(panel).not.toContainText('Oncology');
      await expect(raj.getByText(/Upload events|Distribution sent\.|File refused/)).toHaveCount(0);
    });
  } finally {
    await rajContext.close();
    await samContext.close();
  }
});

test('Cancel: waiting deliveries stop, with a question first', async ({ page }) => {
  await signIn(page, PRIYA);
  await withWorkersStopped(async ({ hold, start }) => {
    const { jobId } = await sendFiles(page, 3, [CARDIO_IRB, CARDIO_PROTOCOL], hold); // 6 deliveries
    expect(await readCounts(page)).toEqual([0, 0, 0, 6]);

    await page.getByRole('button', { name: 'Cancel distribution' }).click();
    const dialog = page.getByRole('dialog', { name: 'Cancel this distribution?' });
    await expect(dialog).toContainText('The deliveries still waiting will stop. Deliveries already running finish. This cannot be undone.');
    await dialog.getByRole('button', { name: 'Keep it going' }).click();
    await expect(dialog).toHaveCount(0);
    expect(await readCounts(page)).toEqual([0, 0, 0, 6]);

    await page.getByRole('button', { name: 'Cancel distribution' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel distribution' }).click();
    await expect(page.getByText(/6 deliveries cancelled\./)).toBeVisible();
    await expect(chip(page)).toHaveText('Cancelled');
    expect(await readCounts(page)).toEqual([0, 0, 0, 0, 6]); // Completed, Failed, In progress, Pending, Cancelled
    const why = page.locator('.ttable').getByRole('button', { name: 'Why this delivery was cancelled' });
    await expect(why).toHaveCount(6);
    expect(await tooltipOf(page, why.first())).toBe('Cancelled by the sender before it was delivered.');

    // A cancelled distribution has no Cancel button (D-M3-10). Nothing failed, so there is no Retry button either.
    await expect(page.getByRole('button', { name: 'Retry failed' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cancel distribution' })).toHaveCount(0);

    // The workers start: the queued messages stop at the claim and nothing is delivered.
    start();
    await page.waitForTimeout(6_000);
    expect(await readCounts(page)).toEqual([0, 0, 0, 0, 6]); // Completed, Failed, In progress, Pending, Cancelled
    const rows = await sql<{ n: number }>("SELECT count(*)::int AS n FROM tasks WHERE job_id = $1 AND status = 'completed'", [jobId]);
    expect(rows[0]?.n).toBe(0);

  });
});

test('a failure shows its reason in the row, with what the code means', async ({ page }) => {
  await signIn(page, PRIYA);
  await withWorkersStopped(async ({ hold, start }) => {
    const { jobId, names } = await sendFiles(page, 2, [CARDIO_IRB], hold);
    expect(await deleteStagedFiles(jobId)).toBe(2); // the files are gone before any delivery starts
    start();

    await expect(chip(page)).toHaveText('Completed with errors', { timeout: 90_000 });
    expect(await readCounts(page)).toEqual([0, 2, 0, 0]);
    const why = page.locator('.ttable').getByRole('button', { name: 'Why this delivery failed' });
    await expect(why).toHaveCount(2);
    // The reason is the tooltip of the info icon, from the one reason map; no raw code, and no "after N attempts" for a permanent failure.
    expect(await tooltipOf(page, why.first())).toBe('The file never finished uploading, so it could not be delivered.');
    await expect(page.locator('.ttable')).not.toContainText('FILE_NOT_UPLOADED');
    // Each row still names its file and folder once, in its own lines.
    // (Rows sort by file name, and the names have a random part, so look each one up.)
    for (const fileName of names) await expect(page.locator('.ttable .tfile', { hasText: fileName })).toHaveCount(1);

    // Filter by Failed, then All.
    await page.getByRole('button', { name: /^Failed, 2 deliveries/ }).click();
    await expect(page.locator('.ttable .status-chip')).toHaveCount(2);
    await page.getByRole('button', { name: /^Completed, 0 deliveries/ }).click();
    await expect(page.getByText('No deliveries with this status.')).toBeVisible();
    await page.getByRole('button', { name: /^All, 2 deliveries/ }).click();
    await expect(page.locator('.ttable .status-chip')).toHaveCount(2);

    // A permanent failure cannot be retried, and Retry says so.
    const retry = page.getByRole('button', { name: 'Retry failed' });
    await expect(retry).toBeDisabled();
    expect(await tooltipOf(page, retry)).toMatch(/No failed delivery can be retried/);
  });
});

test('Retry sends a failed delivery again', async ({ page }) => {
  await signIn(page, PRIYA);
  const { jobId } = await sendFiles(page, 1, [CARDIO_IRB]);
  await expect(chip(page)).toHaveText('Completed', { timeout: 90_000 });

  // Make the delivery look like one that ran out of retries (a state a short test cannot reach by waiting).
  await sql(
    `UPDATE tasks SET status = 'failed', failure_code = 'RETRIES_EXHAUSTED', attempt_count = 5,
            failure_reason = 'x.pdf to Cardio: the platform did not answer', updated_at = now() WHERE job_id = $1`,
    [jobId],
  );
  await page.reload();
  await expect(chip(page)).toHaveText('Completed with errors');
  await expect(page.getByRole('button', { name: 'Retry failed' })).toBeEnabled();
  const failedChip = page.locator('.ttable .tscroll .status-chip');
  await expect(failedChip).toHaveText('Failed');
  expect(await tooltipOf(page, failedChip)).toBe('The platform did not respond after 5 attempts.');
  await expect(page.locator('.ttable')).not.toContainText('RETRIES_EXHAUSTED');

  await noReload(page);
  await page.getByRole('button', { name: 'Retry failed' }).click();
  await expect(page.getByText(/1 delivery queued again\./)).toBeVisible();
  await expect(chip(page)).toHaveText('Completed', { timeout: 90_000 });
  expect(await readCounts(page)).toEqual([1, 0, 0, 0]);
  expect(await stillThere(page)).toBe(true);
  expect(jobIdOf(page)).toBe(jobId);
});

test('the live connection drops mid-run and the page catches up without a reload', async ({ page }) => {
  await signIn(page, PRIYA);
  await withWorkersStopped(async ({ hold, start }) => {
    const { jobId } = await sendFiles(page, 2, [CARDIO_IRB], hold);
    expect(await readCounts(page)).toEqual([0, 0, 0, 2]);
    await noReload(page);

    // The live connection goes away, then the deliveries run: their pushes cannot reach the page.
    stopLive();
    start();
    await expect
      .poll(async () => (await sql<{ n: number }>("SELECT count(*)::int AS n FROM tasks WHERE job_id = $1 AND status = 'completed'", [jobId]))[0]?.n, {
        timeout: 90_000,
      })
      .toBe(2);
    expect(await readCounts(page)).toEqual([0, 0, 0, 2]); // the page has not heard

    // The connection returns. The page connects again, subscribes again, and fetches once: it is right.
    startLive();
    await expect(chip(page)).toHaveText('Completed', { timeout: 60_000 });
    expect(await readCounts(page)).toEqual([2, 0, 0, 0]);
    expect(await stillThere(page)).toBe(true);
  });
});

test('the list shows everything I can see with their counts, and no Mine / My teams switch', async ({ page }) => {
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  const cards = page.locator('.dist-table tbody tr');
  await expect(cards.first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Destinations' })).toBeVisible();
  for (const gone of ['Mine', 'My teams', 'All I can see']) await expect(page.getByRole('button', { name: gone })).toHaveCount(0);
  await expect(page.getByRole('combobox')).toHaveCount(0); // and no status dropdown
  await expect(page.locator('.dist-sender').first()).toHaveText(/\S/); // the sender is on every row
  // Something that is not an id opens nothing; the short id, a full id or a link do (D-F1-32).
  await page.getByRole('button', { name: 'Open by ID' }).click();
  const idField = page.getByLabel('Distribution ID or link');
  await idField.fill('3f1c2a');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('8-character ID');
  const firstTitle = (await cards.first().locator('.dist-id').getAttribute('data-job-id')) as string;
  await idField.fill(`http://localhost:5173/#/status/${firstTitle.toUpperCase()}`);
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/status/${firstTitle}$`));
});

test('a distribution opens in a side panel on the same page; the list narrows beside it; Esc closes; no audit view anywhere', async ({ page }) => {
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  await expect(page.getByRole('heading', { name: 'Distributions' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload events' })).toHaveCount(0);
  await expect(page.getByRole('complementary')).toHaveCount(0);
  const wide = (await page.locator('.dist-table').boundingBox())!.width;

  await page.locator('.dist-table tbody tr').first().click();
  const panel = page.getByRole('complementary');
  await expect(panel.getByRole('region', { name: 'Deliveries' })).toBeVisible();
  await expect(panel.getByText('History')).toHaveCount(0);
  await expect(page.locator('.dist-table')).toBeVisible(); // the list stays beside it, narrower
  expect((await page.locator('.dist-table').boundingBox())!.width).toBeLessThan(wide * 0.6);
  const list = (await page.locator('.dist-table').boundingBox())!.width;
  const side = (await panel.boundingBox())!.width;
  expect(side).toBeGreaterThan(list); // the panel takes the larger part
  await expect(page).toHaveURL(/#\/status\/[0-9a-f-]{36}$/);

  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/#\/status$/);
  await expect(page.getByRole('complementary')).toHaveCount(0);
  expect((await page.locator('.dist-table').boundingBox())!.width).toBeGreaterThan(list); // the full list is back

  // Old audit addresses open the first screens and the web app never asks for the audit trail.
  const audit: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/audit')) audit.push(r.url());
  });
  await page.evaluate("window.location.hash = '#/audit'");
  await expect(page.getByRole('heading', { name: 'Distributions' }).or(page.getByRole('button', { name: 'Distribute' }))).toBeVisible();
  await page.evaluate("window.location.hash = '#/status/uploads'");
  await expect(page.getByRole('heading', { name: 'Distributions' })).toBeVisible();
  expect(audit).toEqual([]);
});

test('the two tabs are on, Copy link copies the address, and a prepared batch survives a look at Status', async ({ browser }) => {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  try {
    await signIn(page, PRIYA);
    for (const tab of ['Distribute', 'Status']) await expect(page.getByRole('button', { name: new RegExp(`^${tab}`) })).toBeEnabled();

    const [name] = await addPdfs(page, 1, 'keep');
    await page.getByRole('button', { name: /^Status/ }).click();
    await page.locator('.dist-table tbody tr').first().click();
    await expect(page.locator('.status-chip.big')).toBeVisible();
    const jobId = jobIdOf(page);

    await page.getByRole('complementary').getByRole('button', { name: 'Copy link' }).click();
    await expect(page.getByRole('complementary').locator('.copy-icons.on')).toHaveCount(1); // the green tick, in the panel header too
    expect(await page.evaluate('navigator.clipboard.readText()')).toBe(`http://localhost:5173/#/status/${jobId}`);

    // Back on Distribute the file is still there: it was hidden, not closed.
    await page.getByRole('button', { name: /^Distribute/ }).click();
    await expect(page.locator('.frow', { hasText: name as string })).toHaveCount(1);
    await expect(page.locator('.frow', { hasText: name as string }).locator('.status-chip')).toHaveText('Ready');
    await page.getByRole('button', { name: 'Clear' }).click();
  } finally {
    await context.close();
  }
});

test('the list updates its counts by itself, every 30 seconds, with no live push for it', async ({ page }) => {
  await signIn(page, PRIYA);
  await withWorkersStopped(async ({ hold, start }) => {
    const { jobId } = await sendFiles(page, 1, [CARDIO_IRB], hold);
    // Leave the distribution: the list alone is on the page, and the list has no live connection (D-M3 / TDD Step 3.4).
    await page.evaluate("window.location.hash = '#/status'");
    const card = page.locator('.dist-table tbody tr', { hasText: jobId.slice(0, 8) });
    await expect(card).toContainText('Pending');
    await noReload(page);
    start();
    await expect(card).toContainText('Completed', { timeout: 60_000 }); // the next refresh, at most 30 seconds later
    expect(await stillThere(page)).toBe(true);
  });
});

test('the filter row: Status, Sender, Sent, Team; set filters show on their buttons, live in the address, survive a reload, and clear together', async ({ page }) => {
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Status' }).click();
  await expect(distRow(page).first()).toBeVisible();
  const bar = page.getByRole('group', { name: 'Filters' });
  await expect(bar.getByRole('button', { name: 'Team' })).toBeVisible(); // Priya is in two teams
  await expect(bar.getByRole('button', { name: 'Clear filters' })).toHaveCount(0); // nothing is set

  // A status narrows the list: every row has it, or the list says none matches.
  await pickFilter(page, 'Status', 'Cancelled');
  await expect(bar.getByRole('button', { name: 'Status: Cancelled' })).toHaveClass(/on/);
  await expect(page).toHaveURL(/#\/status\?status=cancelled$/);
  const rows = distRow(page);
  const none = page.getByText('No distribution matches these filters');
  await expect(rows.first().or(none)).toBeVisible();
  if ((await none.count()) === 0) for (const text of await rows.locator('.status-chip').allTextContents()) expect(text).toBe('Cancelled');

  // Two filters at once; the address keeps both and a reload opens the same list.
  await pickFilter(page, 'Sender', 'Me');
  await expect(bar.getByRole('button', { name: 'Sender: Me' })).toHaveClass(/on/);
  await expect(page).toHaveURL(/#\/status\?status=cancelled&sender=me$/);
  await page.reload();
  await expect(bar.getByRole('button', { name: 'Status: Cancelled' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Sender: Me' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Clear filters' })).toBeVisible();

  // Sent: Today, and the Team menu has the person's teams.
  await pickFilter(page, 'Sent', 'Today');
  await expect(bar.getByRole('button', { name: 'Sent: Today' })).toBeVisible();
  await bar.getByRole('button', { name: /^Team/ }).click();
  await expect(page.getByRole('menuitemradio')).toHaveText(['Any team', 'Cardio', 'Oncology']);
  await page.keyboard.press('Escape');

  await bar.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page).toHaveURL(/#\/status$/);
  await expect(bar.getByRole('button', { name: 'Clear filters' })).toHaveCount(0);
  await expect(distRow(page).first()).toBeVisible();
});

test('an old address with a scope opens the full list, and a team viewer sees what was sent to their team without any switch', async ({ page }) => {
  await signIn(page, RAJ);
  await page.goto('/#/status?scope=team&status=sleeping');
  await expect(page.getByRole('heading', { name: 'Distributions' })).toBeVisible();
  const bar = page.getByRole('group', { name: 'Filters' });
  await expect(bar.getByRole('button', { name: 'Clear filters' })).toHaveCount(0); // nothing of it is a filter
  await expect(distRow(page).first()).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Team' })).toHaveCount(0); // Raj is in one team: no Team filter
  await bar.getByRole('button', { name: /^Sender/ }).click();
  const names = await page.getByRole('menuitemradio').allTextContents();
  expect(names.slice(0, 2)).toEqual(['Anyone', 'Me']);
  expect(names).toContain('Priya Shah'); // a member of his team, from the platform
  expect(names).not.toContain('Sam Ito'); // not in his teams
  await page.getByRole('menuitemradio', { name: 'Priya Shah' }).click();
  await expect(page).toHaveURL(/#\/status\?sender=[0-9a-f-]{36}$/);
  for (const sender of await page.locator('.dist-table tbody tr .dist-sender').allTextContents()) expect(sender).toBe('Priya Shah');
});
