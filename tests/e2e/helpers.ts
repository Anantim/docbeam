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

/** Runs a test body with the workers stopped, and always starts them again. */
export async function withWorkersStopped<T>(body: (start: () => void) => Promise<T>): Promise<T> {
  stopWorkers();
  let started = false;
  const start = (): void => {
    if (!started) {
      startWorkers();
      started = true;
    }
  };
  try {
    return await body(start);
  } finally {
    start();
  }
}

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(env.SEED_USER_PASSWORD as string);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

/** A new PDF each time, so a file is never a duplicate of an earlier test's. */
export const pdf = (name: string): { name: string; mimeType: string; buffer: Buffer } => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.from(`%PDF-1.7\n${randomUUID()}\n%%EOF\n`),
});

/** Adds `count` new PDFs and waits until every one is Verified (uploaded and scanned clean). */
export async function addPdfs(page: Page, count: number, prefix = 'e2e'): Promise<string[]> {
  const files = Array.from({ length: count }, (_, i) => pdf(`${prefix}-${randomUUID().slice(0, 6)}-${i + 1}.pdf`));
  await page.getByLabel('Choose files').setInputFiles(files);
  await expect(page.getByText('Verified', { exact: true })).toHaveCount(count, { timeout: 90_000 });
  return files.map((f) => f.name);
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Ticks a folder in the Destinations tree by its full path, opening its binder first. */
export async function tick(page: Page, path: string): Promise<void> {
  const box = page.getByRole('checkbox', { name: new RegExp(` to ${escape(path)}$`) });
  if (!(await box.isVisible())) {
    const binder = path.split(' / ')[1] as string;
    await page.getByRole('button', { name: `Expand ${binder}` }).click();
  }
  await box.click();
  await expect(box).toBeChecked();
}

/** Sends the distribution and waits for the Status page to open it. Returns the full job id. */
export async function send(page: Page): Promise<string> {
  await page.getByRole('button', { name: /^Send \d+ deliver/ }).click();
  await expect(page).toHaveURL(/#\/status\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  return jobIdOf(page);
}

export const jobIdOf = (page: Page): string => page.url().split('/status/')[1] as string;

/** Distribute: add `files` new PDFs and tick the folders, then send. */
export async function sendFiles(page: Page, files: number, folders: string[], prefix = 'e2e'): Promise<{ jobId: string; names: string[] }> {
  await page.getByRole('button', { name: 'Distribute' }).click();
  const names = await addPdfs(page, files, prefix);
  for (const folder of folders) await tick(page, folder);
  const jobId = await send(page);
  return { jobId, names };
}

export const counts = (page: Page) => page.getByLabel('Counts');

/** The four numbers of the counts panel: Delivered, Failed, In progress, Waiting. */
export async function readCounts(page: Page): Promise<number[]> {
  const texts = await counts(page).locator('.n').allTextContents();
  return texts.map(Number);
}

/** The status chip in the header of the open distribution. */
export const chip = (page: Page) => page.locator('.jchip.big');

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
