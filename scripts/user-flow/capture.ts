// Records the traffic and the pictures for docs/USER-FLOW-AND-APIS.md (Part D, D-F1-70).
//
//   node --no-warnings scripts/user-flow/capture.ts       # needs the local stack (docker compose, seeded) and `npm run dev -w @docbeam/web`
//
// It walks the user's journey in a browser as Priya, Raj and Sam, records every request the page makes (API, storage, WebSocket),
// masks tokens, cookies, signatures and passwords, and writes
//   docs/user-flow/capture/traffic.json   every request and frame, in order, with its step name
//   docs/user-flow/img/*.png              pictures of the screens with numbered markers, 1280 px wide, and the network figures
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Locator, type Page, type Route } from '@playwright/test';
import pg from 'pg';

const ROOT = new URL('../..', import.meta.url).pathname;
const BASE = 'http://localhost:5173';
const IMG = join(ROOT, 'docs/user-flow/img');
const CAP = join(ROOT, 'docs/user-flow/capture');

const env = (name: string): string => {
  const line = readFileSync(join(ROOT, '.env'), 'utf8').split('\n').find((l) => l.startsWith(`${name}=`));
  return (line?.slice(name.length + 1).trim() ?? '').replace(/^(["'])(.*)\1$/, '$2');
};
const PASSWORD = env('SEED_USER_PASSWORD');
if (!PASSWORD) throw new Error('SEED_USER_PASSWORD is not in .env');

const PRIYA = 'priya.shah@example.com';
const RAJ = 'raj.mehta@example.com';
const SAM = 'sam.ito@example.com';
const IRB = 'Cardio / CARDIO-301 Regulatory / IRB approvals';
/** The delivery rows of the open distribution (not its header row, which has the same class). */
const ROWS = '.tscroll [role="row"][aria-rowindex]';

mkdirSync(IMG, { recursive: true });
mkdirSync(CAP, { recursive: true });

// ---------------------------------------------------------------------------------------------------------------- masking

/** Nothing secret is kept: tokens, signatures, credentials, cookies and the password never reach a file. */
export function mask(text: string): string {
  return text
    .replace(/token=[^&"\s]+/gi, 'token=<masked>')
    .replace(/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, 'eyJ…<token masked>')
    .replace(/(X-Amz-(?:Signature|Credential|Security-Token))=[^&"\s]+/gi, '$1=<masked>')
    .replace(/"((?:x-amz-)?(?:signature|credential|security-token)|policy|password|refreshToken|accessToken)"\s*:\s*"[^"]*"/gi, '"$1":"<masked>"')
    .split(PASSWORD)
    .join('<password>');
}

// ---------------------------------------------------------------------------------------------------------------- records

export interface Rec {
  id: number;
  step: string;
  kind: 'api' | 's3' | 'ws';
  method?: string;
  /** The API path without `/api`, with its query. */
  path?: string;
  url?: string;
  status?: number;
  ms?: number;
  bytes?: number;
  req?: string;
  res?: string;
  /** A response the capture made up (a mocked 401) or a request the capture script sent itself, said so in the guide. */
  note?: string;
  frame?: string;
  direction?: 'sent' | 'received';
}

const records: Rec[] = [];
let step = 'start';
/** Requests the capture answered itself (a mocked 401 or 503), with what to say about them in the guide. */
const mockedNote = new Map<unknown, string>();
const mockJson = (status: number, body: unknown, note: string) => (route: Route): Promise<void> => {
  mockedNote.set(route.request(), note);
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
};
const bodiesKept = new Map<string, number>();
const setStep = (s: string): void => {
  step = s;
  console.log(`step ${s}`);
};
const shapeKey = (r: Rec): string => r.kind === 'ws' ? `ws ${r.frame} ${r.direction}` : `${r.method}${(r.path ?? r.url ?? '').split('?')[0]?.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '{}')} ${r.status}`;

function push(rec: Omit<Rec, 'id' | 'step'>): Rec {
  const full: Rec = { id: records.length + 1, step, ...rec };
  // Bodies are kept for the first few answers of each kind only: a poll that repeats ten times is one example.
  const key = shapeKey(full);
  const seen = bodiesKept.get(key) ?? 0;
  bodiesKept.set(key, seen + 1);
  if (seen >= 3) {
    delete full.res;
    delete full.req;
  }
  records.push(full);
  return full;
}

function watch(page: Page): void {
  const started = new Map<unknown, number>();
  page.on('request', (r) => started.set(r, Date.now()));
  page.on('response', async (res) => {
    const req = res.request();
    const url = new URL(req.url());
    const t = started.get(req) ?? Date.now();
    let body = '';
    let bytes = 0;
    try {
      const buf = await res.body();
      bytes = buf.length;
      if (/json|text|xml/.test(res.headers()['content-type'] ?? '')) body = buf.toString('utf8');
    } catch {
      // A redirect or an aborted request has no body.
    }
    if (url.origin === BASE && url.pathname.startsWith('/api/')) {
      const note = mockedNote.get(req);
      push({ kind: 'api', method: req.method(), path: mask(url.pathname.replace(/^\/api/, '') + url.search), status: res.status(), ms: Date.now() - t, bytes, req: mask(req.postData() ?? '').slice(0, 2500) || undefined, res: mask(body).slice(0, 2500) || undefined, ...(note ? { note } : {}) });
    } else if (url.port === '4566') {
      push({ kind: 's3', method: req.method(), url: mask(`${url.host}${url.pathname}${url.search}`), status: res.status(), ms: Date.now() - t, bytes });
    }
  });
  page.on('websocket', (ws) => {
    if (new URL(ws.url()).port !== '3004') return; // the live connection; not the dev server's own hot-reload socket
    push({ kind: 'ws', frame: 'connect', direction: 'sent', url: mask(ws.url()) });
    const log = (direction: 'sent' | 'received') => (frame: { payload: string | Buffer }) => {
      const text = typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf8');
      let type: string | undefined;
      try {
        const j = JSON.parse(text) as { type?: string; action?: string };
        type = j.type ?? j.action;
      } catch {
        // A control frame (ping, pong) is not a message of ours.
      }
      if (type) push({ kind: 'ws', frame: type, direction, res: mask(text).slice(0, 1500) });
    };
    ws.on('framesent', log('sent'));
    ws.on('framereceived', log('received'));
  });
}

// ---------------------------------------------------------------------------------------------------------------- pictures

export interface Marker {
  n: number;
  target: Locator;
  /** What fills this place, as "<call> → <field>" or "computed in the browser". */
  label: string;
}

let composer: Page | undefined;
/** The numbers the pictures ended up with, by picture name: the guide's tables use them. */
const numbering: Record<string, Array<{ n: number; label: string }>> = {};

/** A picture of the page with numbered markers, each labelled in the margin with where it comes from and a thin line to it. */
async function shot(page: Page, name: string, markers: Marker[], height = 800): Promise<void> {
  await page.setViewportSize({ width: 1280, height });
  await page.waitForTimeout(500);
  const raw = await page.screenshot();
  const boxes = await Promise.all(
    markers.map(async (m) => {
      const loc = m.target.first();
      const box = await loc.boundingBox().catch(() => null);
      return { m, box };
    }),
  );
  const scale = 0.69;
  const w = Math.round(1280 * scale);
  const h = Math.round(height * scale);
  const gutter = 1280 - w;
  // The markers are numbered from the top of the picture down (then left to right), whatever number the call gave them, so the
  // labels in the margin read in order. The numbering is written to markers.json for the guide.
  const placed = boxes
    .filter((b): b is { m: Marker; box: NonNullable<typeof b.box> } => b.box !== null)
    .sort((a, b) => Math.round(a.box.y / 8) - Math.round(b.box.y / 8) || a.box.x - b.box.x);
  let lastY = -40;
  const items = placed.map(({ m, box }, index) => {
    const bx = Math.round(box.x * scale);
    const by = Math.round(box.y * scale);
    const bw = Math.max(6, Math.round(box.width * scale));
    const bh = Math.max(6, Math.round(box.height * scale));
    const ly = Math.max(by - 6, lastY + 40);
    lastY = ly;
    return { n: index + 1, label: m.label, bx, by, bw, bh, ly };
  });
  numbering[name] = items.map((i) => ({ n: i.n, label: i.label }));
  const total = Math.max(h, (items.at(-1)?.ly ?? 0) + 60) + 16;
  const svg = items
    .map((i) => `<rect x="${i.bx - 2}" y="${i.by - 2}" width="${i.bw + 4}" height="${i.bh + 4}" rx="3" fill="none" stroke="#7a1fa2" stroke-width="1.5"/><line x1="${i.bx + i.bw + 2}" y1="${i.by + Math.min(i.bh, 20) / 2}" x2="${w + 8}" y2="${i.ly + 17}" stroke="#7a1fa2" stroke-width="1"/>`)
    .join('');
  const badges = items.map((i) => `<div class="b" style="left:${i.bx - 10}px;top:${i.by - 10}px">${i.n}</div>`).join('');
  const labels = items.map((i) => `<div class="l" style="top:${i.ly}px"><span class="n">${i.n}</span>${i.label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`).join('');
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#fff;font:12px/1.35 system-ui,sans-serif;width:1280px;height:${total}px;position:relative;overflow:hidden}
    img{position:absolute;left:0;top:8px;width:${w}px;height:${h}px;border:1px solid #cfd4dc}
    .b{position:absolute;margin-top:8px;width:18px;height:18px;border-radius:9px;background:#7a1fa2;color:#fff;font-weight:700;font-size:11px;text-align:center;line-height:18px;box-shadow:0 0 0 2px #fff}
    .l{position:absolute;left:${w + 14}px;width:${gutter - 22}px;padding:5px 8px;border:1px solid #7a1fa2;border-radius:4px;background:#faf5fc;color:#2b0c3a;margin-top:8px}
    .n{display:inline-block;width:16px;height:16px;border-radius:8px;background:#7a1fa2;color:#fff;text-align:center;line-height:16px;font-weight:700;font-size:10px;margin-right:6px}
    svg{position:absolute;left:0;top:8px;width:1280px;height:${total}px;overflow:visible}
  </style><img src="data:image/png;base64,${raw.toString('base64')}"><svg>${svg}</svg>${badges}${labels}`;
  composer ??= await (await (page.context().browser() as Browser).newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await composer.setViewportSize({ width: 1280, height: total });
  await composer.setContent(html);
  await composer.screenshot({ path: join(IMG, `${name}.png`) });
  console.log(`  picture ${name}.png (${items.length} markers)`);
}

/** A figure drawn from the recorded requests (not a DevTools screenshot): method, path with query, status, time and size. */
async function figure(page: Page, name: string, title: string, recs: Rec[]): Promise<void> {
  const rows = recs
    .filter((r) => r.kind !== 'ws')
    .map((r, i) => {
      const where = r.kind === 'api' ? (r.path ?? '') : `(storage) ${r.url ?? ''}`.replace(/\?.*$/, '?…');
      const bad = (r.status ?? 0) >= 400;
      const size = r.bytes === undefined ? '' : r.bytes < 1024 ? `${r.bytes} B` : `${(r.bytes / 1024).toFixed(1)} kB`;
      return `<tr class="${bad ? 'bad' : ''}"><td>${i + 1}</td><td class="m">${r.method}</td><td class="p">${where.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</td><td>${r.status}</td><td>${r.ms} ms</td><td>${size}</td></tr>`;
    })
    .join('');
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:14px 16px;width:1248px;background:#fff;font:12px/1.4 system-ui,sans-serif;color:#1a2230}
    h1{font-size:13px;margin:0 0 8px}
    table{border-collapse:collapse;width:100%}
    th{text-align:left;font-weight:600;background:#f3f5f8;border-bottom:1px solid #cfd4dc;padding:4px 8px}
    td{padding:4px 8px;border-bottom:1px solid #eceff3;font-family:ui-monospace,monospace;font-size:11.5px}
    td.m{font-weight:700;width:60px} td.p{word-break:break-all} tr.bad td{background:#fdeceb;color:#8a1c14}
    p{margin:8px 0 0;color:#5b6675;font-size:11px}
  </style><h1>${title}</h1><table><tr><th>#</th><th>Method</th><th>Path</th><th>Status</th><th>Time</th><th>Size</th></tr>${rows}</table>
  <p>Drawn from the requests recorded by scripts/user-flow/capture.ts on the local stack, not a DevTools screenshot. Tokens, signatures and passwords are masked.</p>`;
  composer ??= await (await (page.context().browser() as Browser).newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await composer.setViewportSize({ width: 1280, height: 200 });
  await composer.setContent(html);
  const height = await composer.evaluate('document.body.scrollHeight');
  await composer.setViewportSize({ width: 1280, height: Number(height) });
  await composer.screenshot({ path: join(IMG, `${name}.png`) });
  console.log(`  figure ${name}.png (${recs.length} requests)`);
}

const since = (fromId: number): Rec[] => records.filter((r) => r.id > fromId);
const lastId = (): number => records.at(-1)?.id ?? 0;

// ---------------------------------------------------------------------------------------------------------------- helpers

async function db(database: string, text: string, values: unknown[] = []): Promise<Record<string, unknown>[]> {
  const client = new pg.Client({ connectionString: `postgres://postgres:${env('POSTGRES_PASSWORD')}@localhost:5432/${database}` });
  await client.connect();
  try {
    return (await client.query(text, values)).rows as Record<string, unknown>[];
  } finally {
    await client.end();
  }
}

const compose = (...args: string[]): void => void execFileSync('docker', ['compose', ...args], { cwd: ROOT, stdio: 'pipe' });

/** A small one-page PDF that shows its own name, different in every file. */
function pdf(name: string, extraBytes = 0): { name: string; mimeType: string; buffer: Buffer } {
  const stream = `BT /F1 20 Tf 30 100 Td (${name}) Tj ET`;
  const body = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 420 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`;
  const buffer = extraBytes > 0 ? Buffer.concat([Buffer.from(body), Buffer.alloc(extraBytes)]) : Buffer.from(body);
  return { name, mimeType: 'application/pdf', buffer };
}

/** A PDF over the multipart threshold, written to a temporary file (the browser tool cannot take 105 MB from memory). */
const scratch = mkdtempSync(join(tmpdir(), 'docbeam-flow-'));
function bigPdf(name: string): { name: string; path: string } {
  const path = join(scratch, name);
  writeFileSync(path, pdf(name, 105 * 1024 * 1024).buffer);
  return { name, path };
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Sign out' }).waitFor();
}

const tokenOf = async (page: Page): Promise<string> => (await page.evaluate("sessionStorage.getItem('docbeam.accessToken')")) as string;

/** A request the capture script sends itself, to show an answer the page does not provoke (a bad batch, a missing job). */
async function rawApi(context: BrowserContext, page: Page, method: 'GET' | 'POST', path: string, data?: unknown, note = 'sent by the capture script, not by the page', headers: Record<string, string> = {}): Promise<Rec> {
  const t = Date.now();
  const res = await context.request.fetch(`${BASE}/api${path}`, {
    method,
    headers: { authorization: `Bearer ${await tokenOf(page)}`, ...(data !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(data !== undefined ? { data: JSON.stringify(data) } : {}),
  });
  const text = await res.text();
  return push({ kind: 'api', method, path: mask(path), status: res.status(), ms: Date.now() - t, bytes: Buffer.byteLength(text), req: data !== undefined ? mask(JSON.stringify(data)).slice(0, 2500) : undefined, res: mask(text).slice(0, 2500), note });
}

async function tick(page: Page, path: string): Promise<void> {
  const box = page.getByRole('checkbox', { name: new RegExp(` to ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) });
  const parts = path.split(' / ');
  for (let i = 0; i < parts.length - 1 && !(await box.isVisible()); i += 1) {
    const expand = page.getByRole('button', { name: `Expand ${parts[i]}`, exact: true });
    await expand.or(page.getByRole('button', { name: `Collapse ${parts[i]}`, exact: true })).waitFor();
    if (await expand.isVisible()) await expand.click();
  }
  await box.click();
}

// ---------------------------------------------------------------------------------------------------------------- the journey

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: BASE, permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
const page = await context.newPage();
watch(page);

try {
  // ======================================================================================= 1. Sign in
  setStep('1-load-signed-out');
  let from = lastId(); // the figure of the first moments starts at the page load, with its refused refresh
  await page.goto('/');
  await page.getByRole('heading', { name: 'Sign in' }).waitFor();
  await page.waitForTimeout(800);
  await shot(page, '01-sign-in', [
    { n: 1, target: page.getByLabel('Work email'), label: 'typed by you · sent in POST /auth/login → email' },
    { n: 2, target: page.getByLabel('Password', { exact: true }), label: 'typed by you · sent in POST /auth/login → password' },
    { n: 3, target: page.getByRole('button', { name: 'Sign in' }), label: 'press → POST /auth/login' },
    { n: 4, target: page.getByText('Accounts are set up by your study administrator.'), label: 'fixed text in the page · no call' },
  ]);

  setStep('1-wrong-password');
  await page.getByLabel('Work email').fill(PRIYA);
  await page.getByLabel('Password', { exact: true }).fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('alert').waitFor();
  await shot(page, '01b-sign-in-error', [
    { n: 1, target: page.getByRole('alert'), label: 'POST /auth/login 401 → error.message' },
    { n: 2, target: page.getByRole('button', { name: 'Show password' }), label: 'computed in the browser · shows or hides the typed password' },
  ]);

  setStep('1-login');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Sign out' }).waitFor();
  await page.waitForTimeout(800);
  await figure(page, 'net-1-sign-in', 'Signing in: the requests of the first moments', since(from));

  setStep('1-silent-refresh');
  from = lastId();
  await page.evaluate("sessionStorage.removeItem('docbeam.accessToken')");
  await page.reload();
  await page.getByRole('button', { name: 'Sign out' }).waitFor();
  await page.waitForTimeout(600);
  await figure(page, 'net-1b-silent-refresh', 'A reload with no access token: the refresh cookie signs the page in again', since(from));

  setStep('1-session-dialog');
  from = lastId();
  const ended = 'provoked: the capture made this answer a 401, as when the refresh token has ended';
  await page.route('**/api/auth/refresh', mockJson(401, { error: { code: 'UNAUTHORIZED', message: 'Sign in again.' } }, ended));
  await page.route('**/api/jobs**', mockJson(401, { error: { code: 'UNAUTHORIZED', message: 'Sign in again.' } }, ended));
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Status' }).click();
  await page.getByRole('dialog', { name: 'Sign in again' }).waitFor({ timeout: 30_000 });
  await shot(page, '01c-session-dialog', [
    { n: 1, target: page.getByRole('dialog', { name: 'Sign in again' }).getByRole('heading'), label: 'opened when GET /jobs answered 401 and POST /auth/refresh was refused (401)' },
    { n: 2, target: page.getByRole('dialog').getByLabel('Password', { exact: true }), label: 'typed by you · sent in POST /auth/login (the email is the signed-in one)' },
    { n: 3, target: page.getByRole('dialog').getByRole('button', { name: 'Sign out' }), label: 'press → POST /auth/logout' },
  ]);
  await figure(page, 'net-1c-session-dialog', 'The session ends: a 401, a refused refresh, then the dialog', since(from));
  await page.unroute('**/api/auth/refresh');
  await page.unroute('**/api/jobs**');
  from = lastId();
  await page.getByRole('dialog').getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('dialog').getByRole('button', { name: 'Sign in again' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });

  setStep('1-sign-out');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('heading', { name: 'Sign in' }).waitFor();
  await signIn(page, PRIYA);

  // ======================================================================================= 2. Add files
  setStep('2-add-files');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Distribute' }).click();
  from = lastId();
  const tag = Date.now().toString(36);
  const small = [pdf(`Protocol amendment ${tag}.pdf`), pdf(`Consent form ${tag}.pdf`), pdf(`Lab certification ${tag}.pdf`)];
  await page.getByLabel('Choose files').setInputFiles(small);
  await page.getByText('Ready', { exact: true }).nth(2).waitFor({ timeout: 120_000 });
  await page.waitForTimeout(800);
  await figure(page, 'net-2-single-upload', 'Adding three small files: links, uploads to storage, then polling the scan', since(from));

  // A file that is not what its name says, and one with a type that is not allowed: both are refused in the browser, no request.
  setStep('2-refused-in-browser');
  await page.getByLabel('Choose files').setInputFiles([{ name: 'Renamed photo.pdf', mimeType: 'application/pdf', buffer: Buffer.from('\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR') }, { name: 'setup.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') }]);
  await page.locator('.notice').filter({ hasText: 'not added' }).waitFor();
  await shot(page, '02-files', [
    { n: 1, target: page.locator('.frow', { hasText: small[0]?.name }).locator('.fname'), label: 'chosen on your disk · name, size and type read in the browser (no call)' },
    { n: 2, target: page.locator('.frow', { hasText: small[0]?.name }).locator('.status-chip'), label: 'POST /uploads, then S3 POST, then GET /files → scanStatus (Ready = clean)' },
    { n: 3, target: page.locator('.notice').filter({ hasText: 'not added' }), label: 'computed in the browser · first bytes read before the file is added; no request' },
    { n: 4, target: page.getByRole('button', { name: 'Send', exact: true }), label: 'computed in the browser · off until every file is Ready and has a folder' },
  ]);
  await page.locator('.notice').filter({ hasText: 'not added' }).getByRole('button', { name: 'Close' }).click();

  // The first-bytes check of the browser and the scan of the server, on the EICAR test file: the file leaves the list by itself.
  setStep('2-malware');
  from = lastId();
  execFileSync('node', ['--no-warnings', 'scripts/eicar-docx.ts', join(CAP, 'eicar.docx')], { cwd: ROOT, stdio: 'pipe' });
  await page.getByLabel('Choose files').setInputFiles(join(CAP, 'eicar.docx'));
  await page.locator('.notice').filter({ hasText: 'Malware was found' }).waitFor({ timeout: 120_000 });
  rmSync(join(CAP, 'eicar.docx'), { force: true });
  await shot(page, '02b-refused', [
    { n: 1, target: page.locator('.notice').filter({ hasText: 'Malware was found' }), label: 'GET /files → scanStatus "infected"; the file is taken out of the list and named here (computed in the browser, no call of its own)' },
  ]);
  await page.locator('.notice').filter({ hasText: 'Malware was found' }).getByRole('button', { name: 'Close' }).click();

  // A multipart upload: a file over the threshold goes in parts, each with its own link.
  setStep('2-multipart');
  from = lastId();
  const big = bigPdf(`Big binder ${tag}.pdf`);
  await page.getByLabel('Choose files').setInputFiles(big.path);
  await page.locator('.frow', { hasText: big.name }).locator('.status-chip', { hasText: 'Ready' }).waitFor({ timeout: 300_000 });
  await figure(page, 'net-2b-multipart', 'A 105 MB file: multipart start, one PUT per part, complete, then the scan', since(from).filter((r) => !(r.kind === 'api' && r.path?.startsWith('/files?'))).slice(0, 30));
  await page.getByRole('button', { name: `Remove ${big.name}` }).click();

  // The abort link: a multipart upload removed while it is running.
  setStep('2-multipart-abort');
  from = lastId();
  const big2 = bigPdf(`Abandoned ${tag}.pdf`);
  await page.getByLabel('Choose files').setInputFiles(big2.path);
  await page.locator('.frow', { hasText: big2.name }).locator('.status-chip', { hasText: 'Uploading' }).waitFor({ timeout: 120_000 });
  await page.getByRole('button', { name: `Remove ${big2.name}` }).click();
  await page.waitForTimeout(1500);

  // Restore after a reload.
  setStep('2-reload');
  from = lastId();
  await page.reload();
  await page.getByText('Ready', { exact: true }).nth(2).waitFor({ timeout: 60_000 });
  await figure(page, 'net-2c-reload', 'A reload: the files that are already stored are looked up again (GET /files), nothing is uploaded', since(from));

  // ======================================================================================= 3. Choose folders
  setStep('3-tree');
  from = lastId();
  await page.getByRole('button', { name: 'Expand Cardio', exact: true }).click();
  await page.getByRole('button', { name: 'Expand CARDIO-301 Regulatory', exact: true }).click();
  await page.getByRole('checkbox', { name: new RegExp(` to ${IRB}$`) }).waitFor();
  await page.getByRole('button', { name: 'Expand Protocol amendments', exact: true }).click();
  await page.waitForTimeout(700);
  await figure(page, 'net-3-tree', 'Opening the tree one level at a time', since(from));
  await page.getByRole('checkbox', { name: new RegExp(` to ${IRB}$`) }).click();
  await shot(page, '03-destinations', [
    { n: 1, target: page.getByRole('button', { name: 'Collapse Cardio', exact: true }), label: 'GET /teams → items[].name (teams are headings)' },
    { n: 2, target: page.getByRole('button', { name: 'Collapse CARDIO-301 Regulatory', exact: true }), label: 'GET /teams/{teamId}/binders → items[].name' },
    { n: 3, target: page.getByRole('checkbox', { name: new RegExp(` to ${IRB}$`) }), label: 'GET /binders/{binderId}/contents → folders[] · ticked in the browser (no call)' },
    { n: 4, target: page.getByRole('button', { name: 'Expand Protocol amendments', exact: true }), label: 'GET /folders/{folderId}/contents → folders[] (one more level)' },
    { n: 5, target: page.getByRole('searchbox', { name: 'Filter folders' }), label: 'two letters or more → GET /folders/search?q=' },
    { n: 6, target: page.locator('.frow.sel, .frow').first().getByRole('button', { name: /folders? of|folder/ }), label: 'computed in the browser · count of this file\'s ticked folders' },
  ]);

  setStep('3-search');
  from = lastId();
  await page.getByRole('searchbox', { name: 'Filter folders' }).fill('ethics');
  await page.getByRole('button', { name: /Ethics committee and show it in the tree$/ }).waitFor();
  await page.getByRole('searchbox', { name: 'Filter folders' }).fill('2026');
  await page.getByRole('button', { name: /2026 and show it in the tree$/ }).waitFor();
  await shot(page, '03b-search', [
    { n: 1, target: page.getByRole('searchbox', { name: 'Filter folders' }), label: 'typed by you · GET /folders/search?q=2026 (after a 300 ms pause)' },
    { n: 2, target: page.getByRole('button', { name: /2026 and show it in the tree$/ }), label: 'GET /folders/search → items[].name and items[].names (the path above it)' },
  ]);
  await figure(page, 'net-3b-search', 'The folder search: one request per word, not per letter', since(from));
  await page.getByRole('searchbox', { name: 'Filter folders' }).fill('ethics');
  await page.getByRole('button', { name: /Ethics committee and show it in the tree$/ }).click();

  // ======================================================================================= 4. Send
  setStep('4-send-question');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await shot(page, '04-send-question', [
    { n: 1, target: page.getByRole('dialog').getByRole('heading'), label: 'computed in the browser · counts from the ticks: files, folders' },
    { n: 2, target: page.getByRole('dialog').getByRole('button', { name: 'Send' }), label: 'press → POST /jobs (files[].fileId and sha256, mappings[].destinations)' },
  ]);

  setStep('4-post-jobs');
  from = lastId();
  compose('stop', '-t', '0', 'workers'); // the deliveries wait, so the first look at the new distribution shows it pending
  await page.getByRole('dialog').getByRole('button', { name: 'Send' }).click();
  await page.waitForURL(/#\/status\//);
  await page.locator('.status-chip.big').waitFor();
  await page.waitForTimeout(1200);
  const jobId = /#\/status\/([0-9a-f-]{36})/.exec(page.url())?.[1] as string;
  await figure(page, 'net-4-send', 'Send: one POST /jobs, then the Status page opens the new distribution', since(from));
  const tasks = await db('docbeam_db', 'SELECT status, count(*)::int AS n FROM tasks WHERE job_id = $1 GROUP BY 1', [jobId]);
  const jobRow = await db('docbeam_db', 'SELECT id, task_count, fanned_out_at IS NOT NULL AS fanned_out FROM jobs WHERE id = $1', [jobId]);
  writeFileSync(join(CAP, 'db-after-send.json'), JSON.stringify({ job: jobRow, tasksByStatus: tasks }, null, 2));
  await shot(page, '04b-status-after-send', [
    { n: 1, target: page.locator('.panel-top h2'), label: 'POST /jobs → jobId (the first 8 characters, computed in the browser)' },
    { n: 2, target: page.locator('.status-chip.big'), label: 'GET /jobs/{jobId} → counts, turned into a word in the browser' },
    { n: 3, target: page.locator('.panel-sub'), label: 'GET /jobs/{jobId} → submittedBy.name and createdAt (the date is formatted in the browser)' },
    { n: 4, target: page.locator('.tfilters'), label: 'GET /jobs/{jobId} → counts (each tab) · the list below is GET /jobs/{jobId}/tasks' },
  ]);

  // Errors of the batch: answers the page never provokes because it checks first.
  setStep('4-errors');
  await rawApi(context, page, 'POST', '/jobs', { files: [], mappings: [] }, 'sent by the capture script: the page refuses an empty batch before it asks', { 'idempotency-key': 'capture-empty-batch' });
  await rawApi(context, page, 'POST', '/jobs', { files: [{ fileId: '00000000-0000-4000-8000-000000000001', sha256: 'a'.repeat(64) }], mappings: [{ fileId: '00000000-0000-4000-8000-000000000001', destinations: [] }] }, 'sent by the capture script: a file with no folder', { 'idempotency-key': 'capture-no-folder' });
  await rawApi(context, page, 'POST', '/jobs', { files: [{ fileId: '00000000-0000-4000-8000-000000000001', sha256: 'a'.repeat(64) }], mappings: [] }, 'sent by the capture script: no Idempotency-Key header');
  await rawApi(context, page, 'GET', '/jobs/00000000-0000-4000-8000-000000000002', undefined, 'sent by the capture script: a distribution that does not exist');

  // The workers come back and the deliveries run; the live connection tells the page.
  setStep('5-live');
  from = lastId();
  compose('up', '-d', '--no-deps', 'workers');
  await page.locator('.status-chip.big', { hasText: 'Completed' }).waitFor({ timeout: 180_000 });
  await page.waitForTimeout(800);
  await figure(page, 'net-5-live', 'The deliveries run: the page is told by WebSocket frames and reads the rows again', since(from));

  // ======================================================================================= 5. Watch it
  setStep('5-list');
  from = lastId();
  await page.keyboard.press('Escape');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Distribute' }).click();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Status' }).click();
  await page.locator('.dist-table tbody tr').first().waitFor();
  await page.waitForTimeout(800);
  await figure(page, 'net-5b-list', 'Opening Status: the list, its filter choices and the badge', since(from));
  await shot(page, '05-status-list', [
    { n: 1, target: page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Status' }), label: 'GET /jobs/running → running (the badge counts distributions that are not finished)' },
    { n: 2, target: page.getByRole('group', { name: 'Filters' }).getByRole('button', { name: /^Status/ }), label: 'chosen by you · sent as GET /jobs?status= (also kept in the address)' },
    { n: 3, target: page.getByRole('group', { name: 'Filters' }).getByRole('button', { name: /^Sender/ }), label: 'GET /teams/members → items[].name (the people in your teams)' },
    { n: 4, target: page.getByRole('group', { name: 'Filters' }).getByRole('button', { name: /^Team/ }), label: 'GET /teams?limit=100 → items[].name' },
    { n: 5, target: page.locator('.dist-table tbody tr').first().locator('.dist-id'), label: 'GET /jobs → items[].jobId (first 8 characters, computed in the browser)' },
    { n: 6, target: page.locator('.dist-table tbody tr').first().locator('.status-chip'), label: 'GET /jobs → items[].status (a word and a colour chosen in the browser)' },
    { n: 7, target: page.locator('.dist-table tbody tr').first().locator('time'), label: 'GET /jobs → items[].createdAt (written as "Today, 12:41" in the browser)' },
    { n: 8, target: page.locator('.dist-table tbody tr').first().locator('.cell-text').first(), label: 'GET /jobs → items[].fileNames[0] (the first file; the rest are the +N)' },
    { n: 9, target: page.locator('.dist-table tbody tr').first().locator('.cell-text').nth(1), label: 'GET /jobs → items[].destinations (the first two folder names)' },
  ]);

  setStep('5-filter');
  from = lastId();
  await page.getByRole('group', { name: 'Filters' }).getByRole('button', { name: /^Status/ }).click();
  await page.getByRole('menuitemradio', { name: 'Completed', exact: true }).click();
  await page.waitForTimeout(800);
  await figure(page, 'net-5c-filter', 'A filter is sent to the server: GET /jobs with ?status=', since(from));
  await page.getByRole('button', { name: 'Clear filters' }).click();

  setStep('5-open');
  from = lastId();
  await page.locator('.dist-table tbody tr').first().locator('td').nth(2).click();
  await page.locator('.status-chip.big').waitFor();
  await page.locator(ROWS).first().waitFor();
  await page.waitForTimeout(1500);
  await figure(page, 'net-5d-open', 'Opening a distribution: its detail, a subscription on the live connection, then its deliveries', since(from));
  await shot(page, '05b-panel', [
    { n: 1, target: page.locator('.status-chip.big'), label: 'GET /jobs/{jobId} → counts → status word (computed in the browser)' },
    { n: 2, target: page.locator('.panel-sub'), label: 'GET /jobs/{jobId} → submittedBy.name, createdAt · a team member\'s note names the teams in destinations[] (the folder paths): no extra call' },
    { n: 3, target: page.locator('.tfilters'), label: 'GET /jobs/{jobId} → counts · updated by WS task_update → counts' },
    { n: 4, target: page.locator(ROWS).first().locator('.tfile'), label: 'GET /jobs/{jobId}/tasks → tasks[].fileName' },
    { n: 5, target: page.locator(ROWS).first().locator('.dest-text'), label: 'GET /jobs/{jobId}/tasks → tasks[].destinationPath' },
    { n: 6, target: page.locator(ROWS).first().locator('.status-chip'), label: 'GET /jobs/{jobId}/tasks → tasks[].status · changed live by WS task_update' },
    { n: 7, target: page.locator(ROWS).first().getByRole('button', { name: /^Preview/ }), label: 'press → POST /files/{fileId}/downloads, then S3 GET (chapter 7)' },
  ]);

  // Cancel and Retry: a held distribution is cancelled; a failed one is sent again.
  setStep('5-cancel');
  await page.keyboard.press('Escape');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Distribute' }).click();
  const held = [pdf(`Held one ${tag}.pdf`), pdf(`Held two ${tag}.pdf`)];
  await page.getByLabel('Choose files').setInputFiles(held);
  await page.getByText('Ready', { exact: true }).nth(1).waitFor({ timeout: 120_000 });
  await tick(page, IRB);
  compose('stop', '-t', '0', 'workers');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send' }).click();
  await page.waitForURL(/#\/status\//);
  await page.locator(ROWS).first().waitFor();
  from = lastId();
  await page.getByRole('button', { name: 'Cancel distribution' }).click();
  await shot(page, '05c-cancel-question', [
    { n: 1, target: page.getByRole('dialog').getByRole('heading'), label: 'computed in the browser · from GET /jobs/{jobId} → counts' },
    { n: 2, target: page.getByRole('dialog').getByRole('button', { name: 'Cancel distribution' }), label: 'press → POST /jobs/{jobId}/cancel' },
  ]);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel distribution' }).click();
  await page.locator('.status-chip.big', { hasText: 'Cancelled' }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  await figure(page, 'net-5e-cancel', 'Cancel: one POST, then the page reads the distribution again', since(from));
  compose('up', '-d', '--no-deps', 'workers');

  setStep('5-retry');
  const failedJob = jobId; // the first distribution: two of its deliveries are made to look like ones that ran out of retries
  await db('docbeam_db', "UPDATE tasks SET status = 'failed', failure_code = 'RETRIES_EXHAUSTED', attempt_count = 5, failure_reason = 'the platform did not answer', updated_at = now() WHERE id IN (SELECT id FROM tasks WHERE job_id = $1 ORDER BY id LIMIT 2)", [failedJob]);
  await db('docbeam_db', "UPDATE jobs SET first_completed_at = COALESCE(first_completed_at, now()), completed_at = COALESCE(completed_at, now()) WHERE id = $1", [failedJob]);
  await page.goto(`/#/status/${failedJob}`);
  await page.reload();
  await page.getByRole('button', { name: 'Retry failed' }).waitFor();
  await shot(page, '05d-failed-and-retry', [
    { n: 1, target: page.locator('.status-chip.big'), label: 'GET /jobs/{jobId} → counts → "Completed with errors"' },
    { n: 2, target: page.getByRole('button', { name: 'Retry failed' }), label: 'GET /jobs/{jobId} → retry.open and retry.retryable · press → POST /jobs/{jobId}/retry' },
    { n: 3, target: page.getByRole('button', { name: 'Why this delivery failed' }).first(), label: 'GET /jobs/{jobId}/tasks → failureCode, turned into a sentence in the browser' },
    { n: 4, target: page.locator(ROWS).filter({ has: page.getByRole('button', { name: 'Why this delivery failed' }) }).first().locator('.status-chip'), label: 'GET /jobs/{jobId}/tasks → status "failed"' },
  ]);
  from = lastId();
  const retried = page.waitForResponse((r) => /\/api\/jobs\/[^/]+\/retry$/.test(r.url()));
  await page.getByRole('button', { name: 'Retry failed' }).click();
  await retried;
  await page.waitForTimeout(2500);
  await page.locator('.status-chip.big', { hasText: 'Completed' }).waitFor({ timeout: 120_000 });
  await figure(page, 'net-5f-retry', 'Retry failed: one POST, then the deliveries run again and the page follows', since(from));

  // A failed list load, with its Try again.
  setStep('5-list-error');
  from = lastId();
  await page.keyboard.press('Escape');
  await page.route('**/api/jobs?**', mockJson(503, { error: { code: 'PLATFORM_UNAVAILABLE', message: 'The platform is not answering. Try again in a moment.' } }, 'provoked: the capture made this answer a 503, as when the platform is not answering'));
  await page.reload();
  const listNote = page.locator('.notice').filter({ has: page.getByRole('button', { name: 'Try again' }) });
  await listNote.waitFor();
  await shot(page, '05e-list-error', [
    { n: 1, target: listNote, label: 'GET /jobs 503 → the page shows the one note style, with Try again' },
    { n: 2, target: page.getByRole('button', { name: 'Try again' }), label: 'press → GET /jobs again' },
  ]);
  await page.unroute('**/api/jobs?**');
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.locator('.dist-table tbody tr').first().waitFor();

  // ======================================================================================= 6. Team member, and not found
  setStep('6-raj');
  const rajContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: BASE });
  const raj = await rajContext.newPage();
  watch(raj);
  await signIn(raj, RAJ);
  from = lastId();
  await raj.goto(`/#/status/${jobId}`);
  await raj.reload();
  await raj.locator('.status-chip.big').waitFor();
  await raj.locator(ROWS).first().waitFor();
  await raj.waitForTimeout(1200);
  await figure(raj, 'net-6-raj', 'Raj (Cardio only) opens the same distribution: the same calls, narrower answers', since(from));
  await shot(raj, '06-team-member', [
    { n: 1, target: raj.locator('.panel-sub'), label: 'GET /jobs/{jobId} → isSender false, submittedBy.name · the note names the teams in destinations[] (the folder paths of the deliveries Raj may see): no extra call' },
    { n: 2, target: raj.locator('.tfilters'), label: 'GET /jobs/{jobId} → counts: only the deliveries to Raj\'s teams' },
    { n: 3, target: raj.locator(ROWS).first(), label: 'GET /jobs/{jobId}/tasks → only Cardio rows' },
    { n: 4, target: raj.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Status' }), label: 'GET /jobs/running → running (his own view)' },
  ]);

  setStep('6-sam');
  const samContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: BASE });
  const sam = await samContext.newPage();
  watch(sam);
  await signIn(sam, SAM);
  from = lastId();
  await sam.goto(`/#/status/${jobId}`);
  await sam.reload();
  await sam.getByText('Distribution not found').waitFor();
  await figure(sam, 'net-6b-sam', 'Sam (Neuro only): the distribution answers 404, the same as one that does not exist', since(from));
  await shot(sam, '06b-not-found', [
    { n: 1, target: sam.getByText('Distribution not found'), label: 'GET /jobs/{jobId} 404 → the page says "not found" in its own words' },
    { n: 2, target: sam.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Status' }), label: 'the list below is Sam\'s own: GET /jobs' },
  ]);
  await rajContext.close();
  await samContext.close();

  // ======================================================================================= 7. Preview and download
  setStep('7-preview');
  await page.goto(`/#/status/${jobId}`);
  await page.reload();
  await page.locator(ROWS).first().waitFor();
  from = lastId();
  await page.locator(ROWS).first().getByRole('button', { name: /^Preview/ }).click();
  await page.getByRole('dialog', { name: 'File preview' }).waitFor();
  await page.waitForTimeout(1500);
  await figure(page, 'net-7-preview', 'Preview: a 2-minute link from the API, then the browser reads the file straight from storage', since(from));
  await shot(page, '07-preview', [
    { n: 1, target: page.getByRole('dialog', { name: 'File preview' }), label: 'S3 GET (the link from POST /files/{fileId}/downloads → url) · drawn in the browser' },
    { n: 2, target: page.getByRole('dialog', { name: 'File preview' }).getByRole('heading').first(), label: 'POST /files/{fileId}/downloads → fileName' },
  ]);
  await page.keyboard.press('Escape');

  setStep('7-download');
  from = lastId();
  const downloaded = page.waitForEvent('download');
  await page.locator(ROWS).first().getByRole('button', { name: /^Download/ }).click();
  await downloaded;
  await page.waitForTimeout(800);
  await figure(page, 'net-7b-download', 'Download: the same link, opened as a navigation so the browser saves the file', since(from));
  await shot(page, '07b-download', [
    { n: 1, target: page.locator(ROWS).first().getByRole('button', { name: /^Download/ }), label: 'press → POST /files/{fileId}/downloads (mode download) → S3 GET' },
    { n: 2, target: page.getByRole('status').filter({ hasText: 'is downloading' }), label: 'computed in the browser · the link\'s expiry from POST /files/{fileId}/downloads → expiresAt' },
  ]);

  setStep('7-expired');
  await db('docbeam_db', "UPDATE files SET uploaded_at = now() - interval '40 days' WHERE job_id = $1 AND id IN (SELECT file_id FROM tasks WHERE job_id = $1 AND status = 'completed' ORDER BY id LIMIT 1)", [jobId]);
  await page.reload();
  await page.locator(ROWS).first().waitFor();
  from = lastId();
  await page.locator(ROWS).first().getByRole('button', { name: /^Download|^Preview|Why this file can't be opened/ }).first().click().catch(() => undefined);
  await page.waitForTimeout(1200);
  await shot(page, '07c-expired', [
    { n: 1, target: page.getByRole('button', { name: "Why this file can't be opened" }).first(), label: 'GET /jobs/{jobId}/tasks → fileExpired true · POST /files/{fileId}/downloads would answer 410' },
  ]);
  const expiredFile = (await db('docbeam_db', "SELECT id FROM files WHERE job_id = $1 AND uploaded_at < now() - interval '33 days' LIMIT 1", [jobId]))[0]?.id as string | undefined;
  if (expiredFile) await rawApi(context, page, 'POST', `/files/${expiredFile}/downloads`, { mode: 'download' }, 'sent by the capture script: the file is older than 33 days (made so in the database), the page shows the info icon instead');
  await rawApi(context, page, 'POST', '/files/00000000-0000-4000-8000-000000000003/downloads', { mode: 'download' }, 'sent by the capture script: a file that is not the caller\'s answers 404');
  await figure(page, 'net-7c-expired', 'An expired file and an unknown file: 410 and 404', since(from).filter((r) => r.note));
} finally {
  writeFileSync(join(CAP, 'markers.json'), JSON.stringify(numbering, null, 2));
  writeFileSync(join(CAP, 'traffic.json'), JSON.stringify({ capturedAt: new Date().toISOString(), note: 'Recorded by scripts/user-flow/capture.ts on the local stack. Tokens, signatures, cookies and passwords are masked.', records }, null, 2));
  console.log(`wrote ${records.length} records`);
  compose('up', '-d', 'workers', 'platform');
  rmSync(scratch, { recursive: true, force: true });
  await browser.close();
}
