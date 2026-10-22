// A believable history for the demo recording and the user-flow pictures on a CLEAN local stack (D-F1-81).
//
//   node --no-warnings scripts/demo/seed-local-history.ts
//
// The demo opens an older distribution by its ID, so the Status list needs at least 16 distributions before it starts. The old
// recordings got them from the browser tests, which left names like "e2e-4b9c7e-1.pdf". This sends 18 distributions as Priya through
// the real API with real-looking names to Cardio and Oncology folders. It refuses to run when Priya already has distributions.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AUTH_URL, call, DOCBEAM_URL, env, eventually } from '../../tests/integration/helpers.ts';

const demo = JSON.parse(readFileSync(new URL('../../services/platform/seed/demo.json', import.meta.url), 'utf8')) as {
  teams: Array<{ name: string; binders: Array<{ id: string; name: string; folders: Array<{ id: string; name: string }> }> }>;
};
const folder = (team: string, binder: string, name: string) => {
  const b = demo.teams.find((t) => t.name === team)?.binders.find((x) => x.name === binder);
  const f = b?.folders.find((x) => x.name === name);
  if (!b || !f) throw new Error(`No folder ${team} / ${binder} / ${name}.`);
  return { binderId: b.id, folderId: f.id };
};
const places = [
  [folder('Cardio', 'CARDIO-301 Regulatory', 'IRB approvals')],
  [folder('Cardio', 'CARDIO-301 Regulatory', 'Protocol amendments')],
  [folder('Cardio', 'CARDIO-301 Site files', 'Training records')],
  [folder('Oncology', 'ONC-118 Regulatory', 'Ethics committee')],
  [folder('Cardio', 'CARDIO-301 Regulatory', 'IRB approvals'), folder('Oncology', 'ONC-118 Regulatory', 'Ethics committee')],
  [folder('Oncology', 'ONC-118 Regulatory', 'Investigator CVs')],
];
const names = [
  'Monitoring visit report', 'Site initiation checklist', 'Safety report Q2', 'Investigator CV Dr Rao', 'Drug accountability log',
  'Protocol deviation log', 'Ethics approval letter', 'Pharmacy temperature log', 'Delegation of duties', 'Training certificate',
  'Laboratory normal ranges', 'Informed consent form v1', 'Serious adverse event form', 'Randomisation list', 'Imaging charter',
  'Statistical analysis plan', 'Data management plan v2', 'Study visit schedule',
];

const pdf = (title: string): Buffer => {
  const stream = `BT /F1 18 Tf 72 720 Td (${title}) Tj ET`;
  return Buffer.from(
    ['%PDF-1.4', '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj', '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
      '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
      `4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`, '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
      `% ${randomUUID()}`, '%%EOF', ''].join('\n'),
  );
};

const login = await call(AUTH_URL, '/auth/login', { json: { email: 'priya.shah@example.com', password: env.SEED_USER_PASSWORD } });
const token = login.body.accessToken as string;
const mine = await call(DOCBEAM_URL, '/jobs?scope=mine&limit=1', { token });
if (mine.body.items.length > 0) throw new Error('Priya already has distributions: this is for a clean stack only.');

const files = names.map((n) => ({ name: `${n}.pdf`, data: pdf(n) }));
const created = await call(DOCBEAM_URL, '/uploads', {
  token,
  json: { files: files.map((f) => ({ name: f.name, sizeBytes: f.data.length, contentType: 'application/pdf', sha256: createHash('sha256').update(f.data).digest('hex') })) },
});
if (created.status !== 201) throw new Error(`POST /uploads gave ${created.status}`);
const grants = created.body.uploads as Array<{ fileId: string; post: { url: string; fields: Record<string, string> } }>;
await Promise.all(
  grants.map(async (g, i) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(g.post.fields)) form.append(k, v);
    form.append('file', new Blob([new Uint8Array((files[i] as { data: Buffer }).data)]), 'upload.bin');
    if ((await fetch(g.post.url, { method: 'POST', body: form })).status !== 204) throw new Error(`The upload of ${files[i]?.name} failed.`);
  }),
);
await eventually(async () => {
  const state = await call(DOCBEAM_URL, `/files?ids=${grants.map((g) => g.fileId).join(',')}`, { token });
  return (state.body as Array<{ scanStatus: string }>).every((s) => s.scanStatus === 'clean') ? true : undefined;
}, 180_000);

// One distribution per file, oldest first, so the list is a believable history.
for (const [i, g] of grants.entries()) {
  const destinations = places[i % places.length] as Array<{ binderId: string; folderId: string }>;
  const sent = await call(DOCBEAM_URL, '/jobs', {
    token,
    headers: { 'idempotency-key': randomUUID() },
    json: { files: [{ fileId: g.fileId, sha256: createHash('sha256').update((files[i] as { data: Buffer }).data).digest('hex') }], mappings: [{ fileId: g.fileId, destinations }] },
  });
  if (sent.status !== 201) throw new Error(`POST /jobs gave ${sent.status} ${JSON.stringify(sent.body)}`);
  await new Promise((r) => setTimeout(r, 1500));
}
console.log(`sent ${grants.length} distributions as Priya`);
