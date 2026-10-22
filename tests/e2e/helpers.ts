import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { expect, type Locator, type Page } from '@playwright/test';
import JSZip from 'jszip';
import pg from 'pg';
import { env, s3 } from '../integration/helpers.js';

// Helpers for the browser tests (D-M3-11). They drive the real page and use the Compose containers, the
// database and LocalStack only to hold a job in a known state or to read what the page cannot show.

export const PRIYA = 'priya.shah@example.com'; // Cardio and Oncology
export const ANANTIM = 'anantim.patil@example.com'; // Cardio, Neuro and Oncology: the account the screenshots are taken with
export const RAJ = 'raj.mehta@example.com'; // Cardio only
export const SAM = 'sam.ito@example.com'; // Neuro only

export const CARDIO_IRB = 'Cardio / CARDIO-301 Regulatory / IRB approvals';
export const CARDIO_PROTOCOL = 'Cardio / CARDIO-301 Regulatory / Protocol amendments';
export const CARDIO_DELEGATION = 'Cardio / CARDIO-301 Site files / Delegation logs';
export const ONC_ETHICS = 'Oncology / ONC-118 Regulatory / Ethics committee';

const compose = (...args: string[]): void => {
  execFileSync('docker', ['compose', ...args], { stdio: 'pipe', cwd: new URL('../..', import.meta.url).pathname });
};

/** Holds every delivery: the queue is not read while the workers are stopped. */
export const stopWorkers = (): void => compose('stop', 'workers');
export const startWorkers = (): void => compose('start', 'workers');
/** Takes the live connection away, as a dropped network would, and gives it back. */
export const stopLive = (): void => compose('stop', 'ws-local');
export const startLive = (): void => compose('start', 'ws-local');

/**
 * Runs a test body that holds deliveries, and always starts the workers again. The workers also scan uploads
 * (the Upload Events queue), so they must run while files are added and stop only just before Send:
 * the body calls `hold()` for that (`sendFiles` does it) and `start()` to let deliveries go.
 */
export async function withWorkersStopped<T>(body: (control: { hold: () => Promise<void>; start: () => void }) => Promise<T>): Promise<T> {
  let state: 'running' | 'held' = 'running';
  const hold = async (): Promise<void> => {
    stopWorkers();
    state = 'held';
    // A stopped worker's last long-poll (10 s) can still be open in LocalStack, which would hand it the next
    // message and leave that message invisible for the queue's whole visibility timeout. Wait it out.
    await new Promise((resolve) => setTimeout(resolve, 11_000));
  };
  const start = (): void => {
    if (state === 'held') {
      startWorkers();
      state = 'running';
    }
  };
  try {
    return await body({ hold, start });
  } finally {
    start();
  }
}

/**
 * Set when the browser tests run against dev on AWS (`npm run test:e2e:dev`): the CloudFront address of dev.
 * Then there is no local stack, no database and no container to stop, and the password comes from DEV_SEED_PASSWORD.
 */
export const DEV_APP_URL = process.env.DEV_APP_URL;
export const ON_DEV = DEV_APP_URL !== undefined;

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill((process.env.DEV_SEED_PASSWORD ?? env.SEED_USER_PASSWORD) as string);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

/** A real DOCX (a zip with the three parts Word needs) holding one paragraph of `text`. */
export async function docx(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

/**
 * A real PDF of `pages` pages (a valid cross-reference table), each page with visible text: the file's name, "Page n of
 * N", and a few lines, so a preview or a screenshot shows content and not a blank page (D-F1-23). The id inside makes
 * every file different, so it is never a duplicate of an earlier test's.
 */
export function makePdf(title: string, pages = 3): Buffer {
  const unique = randomUUID();
  const objects: string[] = [];
  const kids = Array.from({ length: pages }, (_, i) => `${4 + i * 2} 0 R`).join(' ');
  objects.push('<</Type/Catalog/Pages 2 0 R>>');
  objects.push(`<</Type/Pages/Kids[${kids}]/Count ${pages}>>`);
  objects.push('<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'); // object 3
  for (let i = 0; i < pages; i += 1) {
    const text = (s: string) => s.replace(/[\\()]/g, '');
    const stream = [
      'BT /F1 26 Tf 56 720 Td (' + text(title) + ') Tj ET',
      'BT /F1 16 Tf 56 680 Td (Page ' + (i + 1) + ' of ' + pages + ') Tj ET',
      'BT /F1 12 Tf 56 640 Td 16 TL (DocBeam test document.) Tj T* (Clinical trial regulatory paperwork, shown in the preview.) Tj T* (' + unique + ') Tj ET',
      '0.17 0.35 0.76 rg 56 600 300 4 re f',
    ].join('\n');
    objects.push(`<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents ${5 + i * 2} 0 R/Resources<</Font<</F1 3 0 R>>>>>>`); // object 4, 6, ...
    objects.push(`<</Length ${stream.length}>>\nstream\n${stream}\nendstream`); // object 5, 7, ...
  }
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/**
 * A real DOCX that holds the EICAR antivirus test string as one more entry of its ZIP. The page reads a file's first bytes and
 * only adds a real one (D-F1-44), so the bare string named .pdf is not added any more; inside a DOCX the scanner still finds
 * it and refuses the file.
 */
export async function eicarDocx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('word/document.xml', `<w:document>${Math.random()}</w:document>`);
  zip.file('eicar.com', 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** A new, real, three-page PDF each time. */
export const pdf = (name: string): { name: string; mimeType: string; buffer: Buffer } => ({
  name,
  mimeType: 'application/pdf',
  buffer: makePdf(name.replace(/\.pdf$/, '')),
});

/** Adds `count` new PDFs and waits until every one is Ready (uploaded and scanned clean). */
export async function addPdfs(page: Page, count: number, prefix = 'e2e'): Promise<string[]> {
  const files = Array.from({ length: count }, (_, i) => pdf(`${prefix}-${randomUUID().slice(0, 6)}-${i + 1}.pdf`));
  await page.getByLabel('Choose files').setInputFiles(files);
  await expect(page.getByText('Ready', { exact: true })).toHaveCount(count, { timeout: 90_000 });
  return files.map((f) => f.name);
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Ticks a folder in the Destinations tree by its full path, opening its binder first. */
export async function tick(page: Page, path: string): Promise<void> {
  const box = page.getByRole('checkbox', { name: new RegExp(` to ${escape(path)}$`) });
  // The tree starts with the teams only (D-F1-4): open the team, the binder and any folder above the one to tick, top
  // down. A level that is already open shows Collapse.
  const parts = path.split(' / ');
  for (let i = 0; i < parts.length - 1 && !(await box.isVisible()); i += 1) {
    const expand = page.getByRole('button', { name: `Expand ${parts[i]}`, exact: true });
    await expect(expand.or(page.getByRole('button', { name: `Collapse ${parts[i]}`, exact: true }))).toBeVisible();
    if (await expand.isVisible()) await expand.click();
  }
  await box.click();
  await expect(box).toBeChecked();
}

/** Sends the distribution and waits for the Status page to open it. Returns the full job id. */
export async function send(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send', exact: true }).click(); // the question before it goes
  await expect(page).toHaveURL(/#\/status\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  return jobIdOf(page);
}

export const jobIdOf = (page: Page): string => page.url().split('/status/')[1] as string;

/** Distribute: add `files` new PDFs and tick the folders, then send. */
export async function sendFiles(page: Page, files: number, folders: string[], beforeSend?: () => Promise<void>): Promise<{ jobId: string; names: string[] }> {
  await page.getByRole('button', { name: 'Distribute' }).click();
  const names = await addPdfs(page, files);
  for (const folder of folders) await tick(page, folder);
  await beforeSend?.(); // for example: hold the deliveries
  const jobId = await send(page);
  return { jobId, names };
}

/** `#rrggbb` as the browser reports a computed colour, for example `rgb(180, 35, 24)`. */
export function rgb(hex: string): string {
  const n = (i: number): number => parseInt(hex.slice(i, i + 2), 16);
  return `rgb(${n(1)}, ${n(3)}, ${n(5)})`;
}

export interface ColumnReport {
  /** How far the table scrolls sideways, in pixels. Zero or one means it does not. */
  overflow: number;
  /** Per column: the header, the width it has, and the width its widest content needs. */
  columns: Array<{ header: string; width: number; need: number }>;
}

/** Measures a table's columns in the page: what each has, and what its content needs (even when it is cut short). */
export async function columnReport(page: Page, head: string, rows: string): Promise<ColumnReport> {
  return (await page.evaluate(`((head, rows) => {
    const h = document.querySelector(head);
    const body = [...document.querySelectorAll(rows)];
    const scroller = h.closest('.table-scroll');
    const columns = [...h.children].map((cell, i) => {
      let need = 0;
      for (const r of body) {
        const c = r.children[i];
        if (!c) continue;
        const range = document.createRange();
        range.selectNodeContents(c);
        need = Math.max(need, range.getBoundingClientRect().width);
      }
      return { header: cell.textContent.trim(), width: Math.round(cell.getBoundingClientRect().width), need: Math.round(need) };
    });
    return { overflow: scroller.scrollWidth - scroller.clientWidth, columns };
  })(${JSON.stringify(head)}, ${JSON.stringify(rows)})`)) as ColumnReport;
}

/** The filter row of the open distribution's panel: one button per status, each with its number. */
export const counts = (page: Page) => page.getByRole('group', { name: 'Filter deliveries by status' });

/**
 * The numbers of the open distribution: Completed, Failed, In progress, Pending and, once something was cancelled,
 * Cancelled. They are read from the filter buttons ("Completed, 4 deliveries"), which carry the live counts.
 */
export async function readCounts(page: Page): Promise<number[]> {
  await counts(page).waitFor({ timeout: 20_000 }); // the panel may still be loading
  const labels = await counts(page).getByRole('button').evaluateAll((els: Array<{ getAttribute(name: string): string | null }>) => els.map((e) => e.getAttribute('aria-label') ?? ''));
  const by = new Map(labels.map((l) => [l.split(',')[0], Number(/(\d+) deliver/.exec(l)?.[1])]));
  // A status with no delivery has no tab (D-F1-77), so it reads as 0; Cancelled is only there once something was cancelled.
  const order = ['Completed', 'Failed', 'In progress', 'Pending'];
  const read = order.map((name) => by.get(name) ?? 0);
  return by.has('Cancelled') ? [...read, by.get('Cancelled') as number] : read;
}

/**
 * A new account in no team, made through the Auth Service (the web app has no register page, D-F1-17), then signed in.
 * It has no distributions and no one to share any with.
 */
export async function newAccount(page: Page, name = 'E2E Newcomer'): Promise<string> {
  const email = `e2e.${randomUUID().slice(0, 8)}@example.com`;
  const password = 'correct-horse-battery-staple';
  const made = await page.request.post('/api/auth/register', { data: { email, password, name } });
  expect(made.status()).toBe(201);
  await page.goto('/');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  return email;
}

/** Sets one filter of the Status list from its menu (D-F1-21): `pickFilter(page, 'Sender', 'Me')`, `pickFilter(page, 'Sender', 'Anyone')` to clear it. */
export async function pickFilter(page: Page, filter: 'Status' | 'Sender' | 'Sent' | 'Team', option: string): Promise<void> {
  await page.getByRole('group', { name: 'Filters' }).getByRole('button', { name: new RegExp(`^${filter}`) }).click();
  await page.getByRole('menuitemradio', { name: option, exact: true }).click();
}

/**
 * Clears the Distribute page the way a person does (D-F1-78): with files on it, Clear asks first and the question is answered
 * with its "Clear"; with none, it clears at once. For the clean-up at the end of a test.
 */
export async function clearPage(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  const ask = page.getByRole('dialog', { name: /^Remove (this file and its|all [\d,]+ files and their) folder ticks\?$/ });
  if (await ask.isVisible().catch(() => false)) await ask.getByRole('button', { name: 'Clear' }).click();
}

/** A distribution's row in the list. */
export const distRow = (page: Page, shortId?: string) =>
  shortId ? page.locator('.dist-table tbody tr:not(.sk-row)', { hasText: shortId }) : page.locator('.dist-table tbody tr:not(.sk-row)');

/**
 * Opens a distribution from the list by clicking the ID button of the first real row, the one with the matching text if
 * `hasText` is given. Not the middle of the row: that can be the "+N" of the Files cell, which opens a list of its own, and
 * while the list loads the rows are grey placeholders (D-F1-76).
 */
export async function openListedDistribution(page: Page, hasText?: string): Promise<void> {
  const row = (hasText ? page.locator('.dist-table tbody tr:not(.sk-row)', { hasText }) : distRow(page)).first();
  await expect(row).toBeVisible();
  await row.locator('.dist-id').click();
}

/**
 * The text of the tooltip an element shows when the pointer rests on it (D-F1-47), or null when none shows. It waits for the 300 ms
 * the tooltip takes, reads the one `role="tooltip"` and moves the pointer away.
 */
export async function tooltipOf(page: Page, target: Locator): Promise<string | null> {
  await page.mouse.move(0, 0);
  await page.getByRole('tooltip').waitFor({ state: 'detached', timeout: 1500 }).catch(() => undefined); // an earlier one is gone
  // A disabled button gets no pointer events of its own: the wrapper around it has the tooltip.
  const wrapper = target.locator('xpath=ancestor::span[contains(@class,"tip-wrap")][1]');
  await ((await wrapper.count()) > 0 ? wrapper : target).hover();
  const tip = page.locator('.tooltip:not(.leaving)');
  const shown = await tip.first().waitFor({ state: 'visible', timeout: 1500 }).then(() => true, () => false);
  const text = shown ? await tip.first().textContent() : null;
  await page.mouse.move(0, 0);
  await page.getByRole('tooltip').waitFor({ state: 'detached', timeout: 1500 }).catch(() => undefined);
  return text;
}

/** The status chip in the header of the open distribution. */
export const chip = (page: Page) => page.locator('.status-chip.big');

// --- the database and storage, for states the page cannot make ---

const conn = (database: string): string => `postgres://postgres:${env.POSTGRES_PASSWORD}@localhost:5432/${database}`;

export async function sql<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: conn('docbeam_db') });
  await client.connect();
  try {
    return (await client.query(text, values)).rows as T[];
  } finally {
    await client.end();
  }
}

/**
 * A finished distribution by the signed-in person, with `files` files each delivered to every folder in `folders`, made
 * directly in the database: a long list to try the "+N" popovers and the filters on, without uploading and scanning
 * dozens of files. Every delivery is completed, so no worker has anything to do with it. `removeSeeded` deletes it.
 */
export async function seedJob(page: Page, files: string[], folders: string[], typeOf: (name: string) => string = () => 'application/pdf', states?: (fileIndex: number) => { status: 'completed' | 'in_progress' | 'failed'; attempts: number; code?: string }): Promise<string> {
  const token = (await page.evaluate("sessionStorage.getItem('docbeam.accessToken')")) as string;
  const claims = JSON.parse(Buffer.from(token.split('.')[1] as string, 'base64url').toString('utf8')) as { sub: string; name?: string };
  const userId = claims.sub;
  const jobId = randomUUID();
  const now = new Date();
  // A folder in a real team goes to that team, so people in the team can see the delivery; any other name gets a team of its own.
  const platform = new pg.Client({ connectionString: conn('platform_db') });
  await platform.connect();
  const teamIds = new Map((await platform.query('SELECT id, name FROM teams')).rows.map((r: { id: string; name: string }) => [r.name, r.id] as const));
  await platform.end();
  // The job, its files and its deliveries go in together or not at all (D-F1-62): a run that stops half way must not leave a
  // distribution with no deliveries, which the page shows as "Completed" with no rows.
  const db = new pg.Client({ connectionString: conn('docbeam_db') });
  await db.connect();
  const tx = (text: string, values: unknown[]) => db.query(text, values);
  try {
  await tx('BEGIN', []);
  await tx(
    `INSERT INTO jobs (id, submitted_by_user_id, submitted_by_name, task_count, idempotency_key, fanned_out_at, completed_at, first_completed_at, created_at)
     VALUES ($1, $2, $6, $3, $4, now(), now(), now(), $5)`,
    [jobId, userId, files.length * folders.length, randomUUID(), now, claims.name ?? 'Priya Shah'],
  );
  for (const [i, name] of files.entries()) {
    const fileId = randomUUID();
    await tx(
      `INSERT INTO files (id, owner_user_id, job_id, original_name, size_bytes, content_type, detected_type, checksum_sha256, s3_key, uploaded_at, scan_status, created_at)
       VALUES ($1, $2, $3, $4, 10, $7, $7, repeat('a', 64), $5, now(), 'clean', $6)`,
      [fileId, userId, jobId, name, `staging/${userId}/${fileId}`, new Date(now.getTime() + i), typeOf(name)],
    );
    for (const path of folders) {
      const state = states?.(i) ?? { status: 'completed', attempts: 1 };
      await tx(
        `INSERT INTO tasks (id, job_id, file_id, team_id, binder_id, destination_path, status, attempt_count, failure_code, failure_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [randomUUID(), jobId, fileId, teamIds.get(path.split(' / ')[0] as string) ?? randomUUID(), randomUUID(), path, state.status, state.attempts, state.status === 'failed' ? (state.code ?? 'RETRIES_EXHAUSTED') : null, state.status === 'failed' ? 'The platform did not answer.' : null],
      );
    }
  }
  await tx('COMMIT', []);
  } catch (error) {
    await tx('ROLLBACK', []).catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
  return jobId;
}

/** Deletes a distribution made by `seedJob`, with its files and deliveries, in one statement (all or nothing, D-F1-62). */
export async function removeSeeded(jobId: string): Promise<void> {
  await sql(
    `WITH t AS (DELETE FROM tasks WHERE job_id = $1), f AS (DELETE FROM files WHERE job_id = $1)
     DELETE FROM jobs WHERE id = $1`,
    [jobId],
  );
}

/** Removes a job's staged files from the Object Store, so its deliveries fail with FILE_NOT_UPLOADED. */
export async function deleteStagedFiles(jobId: string): Promise<number> {
  const rows = await sql<{ s3_key: string }>('SELECT s3_key FROM files WHERE job_id = $1', [jobId]);
  for (const r of rows) await s3.send(new DeleteObjectCommand({ Bucket: 'docbeam-local-object-store', Key: r.s3_key }));
  return rows.length;
}
