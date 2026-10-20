import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { expect, type Page } from '@playwright/test';
import pg from 'pg';
import { env, s3 } from '../integration/helpers.js';

// Helpers for the browser tests (D-M3-11). They drive the real page and use the Compose containers, the
// database and LocalStack only to hold a job in a known state or to read what the page cannot show.

export const PRIYA = 'priya.shah@example.com'; // Cardio and Oncology
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
  await page.getByLabel('Password').fill((process.env.DEV_SEED_PASSWORD ?? env.SEED_USER_PASSWORD) as string);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

/** A new PDF each time, so a file is never a duplicate of an earlier test's. */
export const pdf = (name: string): { name: string; mimeType: string; buffer: Buffer } => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.from(`%PDF-1.7\n${randomUUID()}\n%%EOF\n`),
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
  const labels = await counts(page).getByRole('button').evaluateAll((els: Array<{ getAttribute(name: string): string | null }>) => els.map((e) => e.getAttribute('aria-label') ?? ''));
  const by = new Map(labels.map((l) => [l.split(',')[0], Number(/(\d+) deliver/.exec(l)?.[1])]));
  const order = ['Completed', 'Failed', 'In progress', 'Pending', 'Cancelled'];
  return order.filter((name) => by.has(name)).map((name) => by.get(name) as number);
}

/** Opens the History section of the panel (it is closed until asked for) and returns it. */
export async function openHistory(page: Page) {
  const history = page.locator('details.history');
  if ((await history.getAttribute('open')) === null) await history.locator('summary').click();
  return history;
}

/** A distribution's row in the list. */
export const distRow = (page: Page, shortId?: string) =>
  shortId ? page.locator('.dist-table tbody tr', { hasText: shortId }) : page.locator('.dist-table tbody tr');

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

/** Removes a job's staged files from the Object Store, so its deliveries fail with FILE_NOT_UPLOADED. */
export async function deleteStagedFiles(jobId: string): Promise<number> {
  const rows = await sql<{ s3_key: string }>('SELECT s3_key FROM files WHERE job_id = $1', [jobId]);
  for (const r of rows) await s3.send(new DeleteObjectCommand({ Bucket: 'docbeam-local-object-store', Key: r.s3_key }));
  return rows.length;
}
