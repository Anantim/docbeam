// Demo data for the reviewer: a few believable distributions on a FRESH dev (D-F1-81). For demo data on dev only.
//
//   node --no-warnings scripts/demo/seed-history.ts
//
// It signs in as the seeded users through the real API and sends small, real-looking files with real-looking names:
//   - Priya:   one to Cardio and Oncology folders (several files, several folders), one to a single Oncology folder;
//   - Anantim: one to Cardio, Neuro and Oncology folders (Raj and Sam each see their part), and one he cancels while it runs;
//   - Raj:     one small one to a Cardio folder.
// The seed password is read the way the other dev scripts read it (Secrets Manager, or SEED_PW) and is never printed.
// Run it once on a freshly built dev. It refuses to run when Priya already has distributions, so it cannot pile up on a used dev.
import JSZip from 'jszip';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { appUrl, log, mustLogin, ROOT, sleep, uploadSmall, waitScanned, type Api, type Uploaded } from '../m5/lib.ts';

interface Folder {
  id: string;
  name: string;
}
interface Binder {
  id: string;
  name: string;
  folders: Folder[];
}
const demo = JSON.parse(readFileSync(`${ROOT}services/platform/seed/demo.json`, 'utf8')) as { teams: Array<{ name: string; binders: Binder[] }> };

/** A destination by "Team / Binder / Folder" names. */
function where(team: string, binder: string, folder: string): { binderId: string; folderId: string } {
  const b = demo.teams.find((t) => t.name === team)?.binders.find((x) => x.name === binder);
  const f = b?.folders.find((x) => x.name === folder);
  if (!b || !f) throw new Error(`No folder ${team} / ${binder} / ${folder} in the seed.`);
  return { binderId: b.id, folderId: f.id };
}

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** A small real file of the type its name says. The words inside are unique, so no two files have the same contents. */
async function make(name: string): Promise<{ name: string; bytes: Buffer; contentType: string }> {
  const text = `${name.replace(/\.[^.]+$/, '')} (${randomUUID().slice(0, 8)})`;
  if (name.endsWith('.pdf')) {
    const stream = `BT /F1 18 Tf 72 720 Td (${text.replace(/[()\\]/g, '')}) Tj ET`;
    const body = [
      '%PDF-1.4',
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
      '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
      '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
      `4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`,
      '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
      `trailer << /Root 1 0 R /Size 6 /Title (${name.replace(/[()\\]/g, '')}) >>`,
      '%%EOF',
      '',
    ].join('\n');
    return { name, bytes: Buffer.from(body), contentType: 'application/pdf' };
  }
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  if (name.endsWith('.docx')) {
    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
    return { name, bytes: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), contentType: DOCX };
  }
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="${text.slice(0, 20)}" sheetId="1"/></sheets></workbook>`);
  return { name, bytes: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), contentType: XLSX };
}

/** Uploads the files, waits until they are scanned clean, and sends them to every destination. Returns the job id. */
async function send(api: Api, who: string, names: string[], destinations: Array<{ binderId: string; folderId: string }>): Promise<string> {
  const files = await Promise.all(names.map(make));
  const up: Uploaded[] = await uploadSmall(api, files);
  const states = await waitScanned(api, up.map((u) => u.fileId), 10 * 60_000);
  if (states.some((s) => s.scanStatus !== 'clean')) throw new Error(`${who}: a file was not scanned clean.`);
  const reply = await api.post(
    '/jobs',
    { files: up.map((f) => ({ fileId: f.fileId, sha256: f.sha256 })), mappings: up.map((f) => ({ fileId: f.fileId, destinations })) },
    { headers: { 'idempotency-key': randomUUID() } },
  );
  if (reply.status !== 201) throw new Error(`${who}: POST /jobs gave ${reply.status} ${JSON.stringify(reply.body).slice(0, 200)}`);
  log(`${who}: ${names.length} files to ${destinations.length} folders -> ${reply.body.jobId.slice(0, 8)} (${reply.body.taskCount} deliveries)`);
  return reply.body.jobId as string;
}

async function waitFinished(api: Api, jobId: string): Promise<void> {
  for (let i = 0; i < 120; i += 1) {
    const view = (await api.get(`/jobs/${jobId}`)).body as { counts: { pending: number; in_progress: number } };
    if (view.counts.pending + view.counts.in_progress === 0) return;
    await sleep(2000);
  }
}

async function main(): Promise<void> {
  log(`Demo history on ${appUrl()}`);
  const priya = await mustLogin('priya.shah@example.com');
  const anantim = await mustLogin('anantim.patil@example.com');
  const raj = await mustLogin('raj.mehta@example.com');

  const existing = (await priya.get('/jobs?scope=mine&limit=1')).body as { items: unknown[] };
  if (existing.items.length > 0) throw new Error('Priya already has distributions: this is for a fresh dev only.');

  const cardioIrb = where('Cardio', 'CARDIO-301 Regulatory', 'IRB approvals');
  const cardioAmendments = where('Cardio', 'CARDIO-301 Regulatory', 'Protocol amendments');
  const cardioLogs = where('Cardio', 'CARDIO-301 Site files', 'Delegation logs');
  const oncEthics = where('Oncology', 'ONC-118 Regulatory', 'Ethics committee');
  const oncCvs = where('Oncology', 'ONC-118 Regulatory', 'Investigator CVs');
  const oncTemps = where('Oncology', 'ONC-118 Pharmacy', 'Temperature logs');
  const neuroApprovals = where('Neuro', 'NEU-207 Regulatory', 'Site approvals');

  // Priya: five documents to Cardio and Oncology folders, then one letter to a single Oncology folder.
  const first = await send(priya, 'Priya', ['Protocol amendment 3.pdf', 'Informed consent form v2.docx', 'Monitoring visit report.pdf', 'Lab certification.pdf', 'Site delegation log.xlsx'], [cardioIrb, cardioAmendments, oncEthics]);
  await waitFinished(priya, first);
  const second = await send(priya, 'Priya', ['Ethics committee approval letter.pdf'], [oncEthics]);
  await waitFinished(priya, second);

  // Anantim: one to Cardio, Neuro and Oncology folders (Raj sees the Cardio part, Sam the Neuro part).
  const third = await send(anantim, 'Anantim', ['Investigator brochure.pdf', 'Data management plan.pdf', 'Statistical analysis plan.docx'], [cardioLogs, neuroApprovals, oncCvs, oncTemps]);
  await waitFinished(anantim, third);

  // Anantim: a larger one, cancelled while it runs.
  const fourth = await send(anantim, 'Anantim', ['Safety reporting plan.pdf', 'Pharmacy manual.pdf', 'Laboratory manual.pdf', 'Randomisation list.xlsx', 'Imaging charter.pdf', 'Recruitment plan.docx'], [cardioIrb, cardioAmendments, cardioLogs, neuroApprovals, oncEthics, oncCvs, oncTemps]);
  const cancelled = await anantim.post(`/jobs/${fourth}/cancel`);
  log(`Anantim: cancelled ${fourth.slice(0, 8)}: ${cancelled.status} ${JSON.stringify(cancelled.body)}`);
  await waitFinished(anantim, fourth);

  // Raj: one small one to a Cardio folder.
  const fifth = await send(raj, 'Raj', ['Training certificate.pdf', 'Visit schedule.docx'], [cardioLogs]);
  await waitFinished(raj, fifth);

  console.log(JSON.stringify({ priya: [first, second], anantim: [third, fourth], raj: [fifth] }));
}

await main();
