import { expect, test } from '@playwright/test';
import { CARDIO_IRB, docx, PRIYA, send, signIn, sql, tick, pdf } from './helpers.js';

// The type of a file comes from its contents, never its name (D-F1-44): the browser reads the first bytes (and the ZIP's file
// list) when a file is added; the Upload Events Lambda checks again and stores the type; the deliveries table shows it.

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

test('a file whose contents are not what its name says is not added, and the box says what it is', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, PRIYA);
  const real = pdf('real.pdf');
  await page.getByLabel('Choose files').setInputFiles([
    { name: 'report.docx', mimeType: DOCX_TYPE, buffer: real.buffer }, // a PDF named .docx
    { name: 'photo.pdf', mimeType: 'application/pdf', buffer: PNG }, // a PNG named .pdf
    { name: 'setup.pdf', mimeType: 'application/pdf', buffer: Buffer.from('MZ\x90\x00 a program') }, // a program named .pdf
    { name: 'plain.xlsx', mimeType: 'application/octet-stream', buffer: await docx('really a Word file') }, // a DOCX named .xlsx
  ]);
  const box = page.locator('.notice').filter({ hasText: 'not added' });
  await expect(box.getByText('4 files not added.')).toBeVisible();
  expect(await box.locator('.notice-detail').allTextContents()).toEqual([
    'The contents are a PDF, but the name says .docx.',
    'The contents are a PNG, but the name says .pdf.',
    "This isn't a real PDF file.",
    'The contents are a DOCX, but the name says .xlsx.',
  ]);
  await expect(page.locator('.frow[data-id]')).toHaveCount(0); // nothing was added
});

test('a real DOCX is added with a DOCX tag, its type is stored from the contents, and the deliveries table shows the stored type', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, PRIYA);
  const name = `letter-${Date.now()}.docx`;
  await page.getByLabel('Choose files').setInputFiles([{ name, mimeType: DOCX_TYPE, buffer: await docx(`Protocol letter ${Date.now()}`) }]);
  const row = page.locator('.frow', { hasText: name });
  await expect(row.getByText('Ready', { exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(row.locator('.typetile')).toHaveText('DOCX');
  await expect(row.locator('.typetile')).toHaveClass('typetile'); // neutral grey: no colour class

  await tick(page, CARDIO_IRB);
  const jobId = await send(page);
  // The Lambda stored the type it found in the bytes.
  const [stored] = await sql<{ detected_type: string | null }>('SELECT detected_type FROM files WHERE job_id = $1', [jobId]);
  expect(stored?.detected_type).toBe(DOCX_TYPE);

  // A name that lies about it does not change the tag: make the stored name say .pdf and reload the deliveries.
  await sql("UPDATE files SET original_name = replace(original_name, '.docx', '.pdf') WHERE job_id = $1", [jobId]);
  await page.reload();
  const table = page.getByRole('table', { name: /^Deliveries, / });
  await expect(table).toBeVisible();
  await expect(table.locator('.tfile-line').first()).toContainText('.pdf');
  await expect(table.locator('.tfile-line .typetile').first()).toHaveText('DOCX'); // the type from the contents, not the name
});
