import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { CARDIO_IRB, jobIdOf, ON_DEV, PRIYA, RAJ, readCounts, SAM, send, signIn, sql, startLive, startWorkers, tick } from './helpers.js';

// Flow 4, Download a file, in a real browser against the local stack (M4).
//   Priya Shah sends a PDF, a DOCX and an XLSX to Cardio. Raj Mehta is in Cardio. Sam Ito is in neither team.
test.describe.configure({ mode: 'serial' });

test.afterAll(() => {
  if (ON_DEV) return; // nothing local to start
  startWorkers();
  startLive();
});

const id = randomUUID().slice(0, 6);
const PDF = `consent-${id}.pdf`;
const DOCX = `amendment-${id}.docx`;
const XLSX = `sites-${id}.xlsx`;

async function docx(text: string): Promise<Buffer> {
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

async function xlsx(text: string): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('Sites').addRow([text, 'Open']);
  return Buffer.from(await book.xlsx.writeBuffer());
}

/** Evidence for docs/testing/M4-RESULTS.md. Only taken on dev, so local runs leave the repository alone. */
const shot = async (page: Page, name: string): Promise<void> => {
  if (ON_DEV) await page.screenshot({ path: `docs/testing/m4-evidence/${name}.png` });
};

const rowOf =(page: Page, name: string) => page.locator('.ttable .trow', { hasText: name });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'File preview' });

let jobId = '';

test('Priya previews a PDF, a DOCX and an XLSX in the page and downloads the PDF under its own name', async ({ page }) => {
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Distribute' }).click();
  await page.getByLabel('Choose files').setInputFiles([
    { name: PDF, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.7\n${randomUUID()}\n%%EOF\n`) },
    { name: DOCX, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await docx('Protocol amendment text') },
    { name: XLSX, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: await xlsx('Mumbai site') },
  ]);
  await expect(page.getByText('Verified', { exact: true })).toHaveCount(3, { timeout: 90_000 });
  await tick(page, CARDIO_IRB);
  jobId = await send(page);
  await expect.poll(() => readCounts(page), { timeout: 60_000 }).toEqual([3, 0, 0, 0]);

  // Preview: the PDF opens in the page from a short link on the Object Store, not from our servers.
  await rowOf(page, PDF).getByRole('button', { name: `Preview ${PDF}` }).click();
  await expect(dialog(page)).toBeVisible();
  expect(await page.getByTitle(`Preview of ${PDF}`).getAttribute('src')).toMatch(/^https?:\/\/[^/]+\/.*X-Amz-Expires=120/);
  await shot(page, 'priya-preview-pdf');
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);

  // The DOCX becomes a read-only page in a sandboxed frame.
  await rowOf(page, DOCX).getByRole('button', { name: `Preview ${DOCX}` }).click();
  const docxFrame = page.getByTitle(`Preview of ${DOCX}`);
  await expect(docxFrame).toBeVisible();
  expect(await docxFrame.getAttribute('sandbox')).toBe('');
  await expect(page.frameLocator(`iframe[title="Preview of ${DOCX}"]`).locator('body')).toContainText('Protocol amendment text');
  await shot(page, 'priya-preview-docx');
  await page.keyboard.press('Escape');

  await rowOf(page, XLSX).getByRole('button', { name: `Preview ${XLSX}` }).click();
  const sheetFrame = page.getByTitle(`Preview of ${XLSX}`);
  await expect(sheetFrame).toBeVisible();
  expect(await sheetFrame.getAttribute('sandbox')).toBe('');
  await expect(page.frameLocator(`iframe[title="Preview of ${XLSX}"]`).locator('body')).toContainText('Mumbai site');
  await shot(page, 'priya-preview-xlsx');
  await page.keyboard.press('Escape');

  // Download: the browser saves the file under its original name, and the banner counts the link down.
  const saved = page.waitForEvent('download');
  await rowOf(page, PDF).getByRole('button', { name: `Download ${PDF}` }).click();
  expect((await saved).suggestedFilename()).toBe(PDF);
  await expect(page.getByRole('status').filter({ hasText: `${PDF} is downloading. Its link works for this one file for another` })).toBeVisible();
  await shot(page, 'priya-download-pdf-saved');
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'is downloading' })).toHaveCount(0);

  // The sender's own links are recorded: two previews of office files, one of the PDF, one download.
  // (On dev the database is not reachable; download-dev.spec.ts reads the audit trail through the API.)
  if (!ON_DEV) {
    const events = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM audit_events WHERE action = 'download.issued' AND job_id = $1`, [jobId]);
    expect(events[0]?.n).toBe(4);
  }
});

test('Raj, in a team the file went to, can preview it', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, RAJ);
  await page.goto(`/#/status/${jobId}`);
  await rowOf(page, PDF).getByRole('button', { name: `Preview ${PDF}` }).click();
  await expect(dialog(page)).toBeVisible();
  await context.close();
});

test('Sam, in neither team, cannot find the distribution or get a link to its file', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, SAM);
  await page.goto(`/#/status/${jobId}`);
  await expect(page.getByText('Distribution not found')).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Preview|Download) / })).toHaveCount(0);
  await context.close();
});

test('a file older than 33 days shows the expired note and no buttons', async ({ page }) => {
  test.skip(ON_DEV, 'ages the file in the local database; the 410 on dev is covered by the integration test');
  await sql(`UPDATE files SET uploaded_at = now() - interval '40 days' WHERE job_id = $1 AND original_name = $2`, [jobId, DOCX]);
  await signIn(page, PRIYA);
  await page.goto(`/#/status/${jobId}`);
  await expect(rowOf(page, DOCX)).toContainText('more than 33 days old');
  await expect(rowOf(page, DOCX).getByRole('button')).toHaveCount(0);
  await expect(rowOf(page, PDF).getByRole('button', { name: `Preview ${PDF}` })).toBeVisible();
  expect(jobIdOf(page)).toBe(jobId);
});
