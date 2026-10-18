// Records the demo video (docs/DEMO-SCRIPT.md) with Playwright: 1280x720, a visible cursor, a short caption for each
// step (also for the steps done outside the browser), no sound. One .webm clip per scene, plus clips.json that lists
// every caption with its time in the clip and whether the step is a waiting part to speed up.
//
//   DEMO_TARGET=dev   DEMO_URL=https://<id>.cloudfront.net DEMO_PASSWORD=$SEED_PW  node --no-warnings scripts/demo/record.ts
//   DEMO_TARGET=local (default) DEMO_URL=http://localhost:5173 (npm run dev -w @docbeam/web) DEMO_PASSWORD from .env
//
// Needs the files from scripts/demo-files.sh. Never prints the password. On dev it stops and starts the platform with
// scripts/demo-outage.sh; locally it stops and starts the platform container.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '../..');
const TARGET = process.env.DEMO_TARGET ?? 'local';
const BASE = process.env.DEMO_URL ?? 'http://localhost:5173';
const FILES = process.env.DEMO_FILES ?? join(homedir(), 'docbeam-demo-files');
const OUT = resolve(process.env.DEMO_OUT ?? join(ROOT, 'demo-out'));
const SIZE = { width: 1280, height: 720 };
const DELIVERY_SIZE = process.env.DEMO_DELIVERY_BYTES ?? '1048576'; // 1 MiB files: a run long enough to stop the platform in

function password(): string {
  const fromEnv = process.env.DEMO_PASSWORD ?? process.env.DEV_SEED_PASSWORD;
  if (fromEnv) return fromEnv;
  const line = readFileSync(join(ROOT, '.env'), 'utf8').split('\n').find((l) => l.startsWith('SEED_USER_PASSWORD='));
  if (!line) throw new Error('Set DEMO_PASSWORD (dev) or run scripts/local-env.sh (local).');
  return line.slice('SEED_USER_PASSWORD='.length);
}
const PW = password();

const ANANTIM = 'anantim.patil@example.com';
const LOAD = 'load.user@example.com';
const RAJ = 'raj.mehta@example.com'; // Cardio only
const SAM = 'sam.ito@example.com'; // Neuro only
const FOLDERS = [
  'Cardio / CARDIO-301 Regulatory / IRB approvals',
  'Cardio / CARDIO-301 Regulatory / Protocol amendments',
  'Oncology / ONC-118 Regulatory / Ethics committee',
];
const PDFS = [
  'Protocol amendment 3', 'Informed consent form v2', 'Investigator brochure', 'Site delegation log',
  'Monitoring visit report', 'Lab certification', 'IRB approval letter', 'Pharmacy manual',
  'Training record', 'Safety report Q3', 'Statistical analysis plan', 'Data management plan',
].map((n) => join(FILES, `${n}.pdf`));
const PNG = join(FILES, 'Site photo.png');
const EICAR = join(FILES, 'EICAR test file.pdf');

// ---------------------------------------------------------------- the page: a cursor and a caption bar

const OVERLAY = `(() => {
  const css = document.createElement('style');
  css.textContent = [
    '#__cursor{position:fixed;z-index:2147483647;pointer-events:none;width:22px;height:22px;margin:-3px 0 0 -3px;display:none}',
    '#__caption{position:fixed;z-index:2147483646;left:0;right:0;top:0;padding:8px 32px;pointer-events:none;',
    'font:600 20px/1.3 system-ui,sans-serif;color:#fff;background:rgba(17,24,39,.88);text-align:center;display:none}',
  ].join('');
  const install = () => {
    document.head.appendChild(css);
    const cursor = document.createElement('div');
    cursor.id = '__cursor';
    cursor.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 17 L7 13.5 L9.8 19.5 L12.2 18.4 L9.5 12.5 L15 12 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    const caption = document.createElement('div');
    caption.id = '__caption';
    document.body.append(cursor, caption);
    const saved = sessionStorage.getItem('__caption');
    if (saved) { caption.textContent = saved; caption.style.display = 'block'; }
    addEventListener('mousemove', (e) => { cursor.style.display = 'block'; cursor.style.left = e.clientX + 'px'; cursor.style.top = e.clientY + 'px'; }, true);
  };
  if (document.body) install(); else addEventListener('DOMContentLoaded', install);
})();`;

interface CaptionLog { t: number; text: string; fast: boolean }
interface Clip { file: string; captions: CaptionLog[] }
const clips: Clip[] = [];

class Scene {
  readonly captions: CaptionLog[] = [];
  private readonly began = Date.now();
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** Shows a caption on the page (and keeps it across a reload). `fast` marks a waiting part to speed up later. */
  async say(text: string, fast = false): Promise<void> {
    this.captions.push({ t: (Date.now() - this.began) / 1000, text, fast });
    await this.page.evaluate((t) => {
      sessionStorage.setItem('__caption', t);
      const el = document.getElementById('__caption');
      if (el) { el.textContent = t; el.style.display = 'block'; }
    }, text);
  }

  async pause(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }

  /** Moves the cursor to the middle of the element, in small steps so the viewer can follow it. */
  async move(target: Locator): Promise<void> {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (!box) throw new Error('no box to move to');
    await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 28 });
    await this.pause(250);
  }

  async click(target: Locator): Promise<void> {
    await this.move(target);
    await this.page.mouse.down();
    await this.page.mouse.up();
    await this.pause(350);
  }

  async type(target: Locator, text: string): Promise<void> {
    await this.click(target);
    await target.pressSequentially(text, { delay: 45 });
  }
}

async function scene(browserContext: () => Promise<BrowserContext>, name: string, body: (s: Scene) => Promise<void>): Promise<void> {
  const context = await browserContext();
  await context.addInitScript(OVERLAY);
  const page = await context.newPage();
  const s = new Scene(page);
  try {
    await body(s);
    await s.pause(1500);
  } finally {
    const video = page.video();
    await context.close();
    const file = join(OUT, `${String(clips.length + 1).padStart(2, '0')}-${name}.webm`);
    if (video) renameSync(await video.path(), file);
    clips.push({ file, captions: s.captions });
  }
}

// ---------------------------------------------------------------- steps outside the browser

function run(file: string, args: string[]): string {
  return execFileSync(file, args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SEED_PW: PW, ...(TARGET === 'local' ? { APP: BASE } : {}) } });
}
function platform(action: 'stop' | 'start'): void {
  if (TARGET === 'dev') run('scripts/demo-outage.sh', [action]);
  else run('docker', ['compose', action === 'stop' ? 'stop' : 'start', 'platform']);
}

const expandable = (page: Page, path: string): Locator => page.getByRole('checkbox', { name: new RegExp(` to ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) });

async function signIn(s: Scene, email: string): Promise<void> {
  const { page } = s;
  await s.type(page.getByLabel('Work email'), email);
  await s.type(page.getByLabel('Password'), PW);
  await s.click(page.getByRole('button', { name: 'Sign in' }));
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 60_000 });
}

async function tick(s: Scene, path: string): Promise<void> {
  const box = expandable(s.page, path);
  if (!(await box.isVisible())) {
    await s.click(s.page.getByRole('button', { name: `Expand ${path.split(' / ')[1]}` }));
    await s.pause(800); // the tree opens and moves what is below it
  }
  await s.click(box);
  if (!(await box.isChecked())) await box.click(); // the layout moved under the cursor: click the box itself
  await expect(box).toBeChecked();
}

// ---------------------------------------------------------------- the script

async function main(): Promise<void> {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chromium' }); // the new headless mode has the PDF viewer for the preview
  const newContext = (): Promise<BrowserContext> =>
    browser.newContext({ baseURL: BASE, viewport: SIZE, recordVideo: { dir: join(OUT, 'raw'), size: SIZE } });

  let jobId = '';

  // Scene 1: Anantim uploads, is refused on malware, sends 13 files to 3 folders, opens the Audit tab.
  await scene(newContext, 'send-files', async (s) => {
    const { page } = s;
    await page.goto('/');
    await s.say('DocBeam sends clinical trial documents to many team folders at once, and tracks every delivery. This is the version running on AWS.');
    await s.pause(4500);
    await s.say('Sign in');
    await signIn(s, ANANTIM);
    await s.click(page.getByRole('button', { name: 'Distribute' }));

    await s.say('Pick up to 100 files. Each is checked in the browser: type, size and a SHA-256 fingerprint.');
    await s.click(page.getByRole('button', { name: 'Click to browse' }));
    await page.getByLabel('Choose files').setInputFiles([...PDFS, PNG]);
    await expect(page.getByText('Verified', { exact: true })).toHaveCount(PDFS.length + 1, { timeout: 120_000 });
    await s.pause(2000);

    await s.say('Every upload is scanned for malware. This is the standard antivirus test file.');
    await s.click(page.getByRole('button', { name: 'Click to browse' }));
    await page.getByLabel('Choose files').setInputFiles([EICAR]);
    const eicar = page.locator('.frow', { hasText: 'EICAR test file.pdf' });
    await expect(eicar.locator('.status-chip')).toHaveText('Refused: malware found', { timeout: 120_000 });
    await s.say('It is refused and deleted. It can never be sent or downloaded.');
    await s.pause(3500);
    await s.click(page.getByRole('button', { name: 'Remove EICAR test file.pdf' }));

    await s.say('Choose the destinations. I only see the teams I belong to.');
    for (const folder of FOLDERS) await tick(s, folder);
    await s.pause(1200);

    await s.say('13 files to 3 folders: 39 deliveries. Review, then Send.');
    await s.move(page.locator('section[aria-label="Review"]'));
    await s.pause(3000);
    await s.click(page.getByRole('button', { name: /^Send \d+ deliver/ }));
    await expect(page).toHaveURL(/#\/status\/[0-9a-f-]{36}$/, { timeout: 30_000 });

    await s.say('Each delivery is tracked live. The counts move as documents arrive.');
    await expect(page.getByLabel('Counts').locator('.n').first()).toHaveText('39', { timeout: 120_000 });
    await s.pause(2500);
    await s.say('All 39 delivered.');
    await s.pause(2500);

    jobId = page.url().split('/status/')[1] ?? '';

    await s.say('The Audit tab records who sent what, to where, and when.');
    await s.click(page.getByRole('tab', { name: /^Audit/ }));
    await page.getByText('Distribution sent').first().waitFor({ timeout: 20_000 }).catch(() => undefined); // the wording is checked in the frames
    await s.pause(9000);
  });

  // Scenes 2 and 3: the same distribution seen by Raj (Cardio only) and by Sam (Neuro only).
  await scene(newContext, 'raj-cardio-only', async (s) => {
    const { page } = s;
    await page.goto('/');
    await s.say('Raj is in the Cardio team only.');
    await signIn(s, RAJ);
    await page.goto(`/#/status/${jobId}`);
    await expect(page.locator('.ttable .trow').first()).toBeVisible({ timeout: 30_000 });
    await s.say('He sees only the Cardio deliveries of this distribution, and nothing for Oncology.');
    await s.move(page.locator('.ttable'));
    await s.pause(9000);
  });

  await scene(newContext, 'sam-not-found', async (s) => {
    const { page } = s;
    await page.goto('/');
    await s.say('Sam is in the Neuro team only.');
    await signIn(s, SAM);
    await page.goto(`/#/status/${jobId}`);
    await expect(page.getByText('Distribution not found')).toBeVisible({ timeout: 30_000 });
    await s.say('For this distribution Sam gets "not found", the same answer as for one that does not exist.');
    await s.pause(8000);
  });

  // Scene 2: the big send as Load User, the platform stopped and started, a preview and a download.
  await scene(newContext, 'big-send-outage', async (s) => {
    const { page } = s;
    await page.goto('/');
    await s.say('A second user, in 50 teams, sends a bigger one.');
    await signIn(s, LOAD);

    await s.say('100 files to 20 folders: 2,000 deliveries in one action (sent from a script; upload and scan sped up).', true);
    const sent = run('scripts/demo-send.sh', [`--size=${DELIVERY_SIZE}`]);
    const jobId = /#\/status\/([0-9a-f-]{36})/.exec(sent)?.[1];
    if (!jobId) throw new Error('demo-send printed no address');
    await page.goto(`/#/status/${jobId}`);
    await s.say('Counts, per-delivery status and failures with a reason. Nothing is polled: it is pushed over a WebSocket.');
    await s.pause(5000);
    await s.move(page.locator('.ttable'));
    await page.mouse.wheel(0, 600);
    await s.pause(3000);

    await page.getByLabel('Counts').scrollIntoViewIfNeeded(); // the counts stay on screen from here on
    await s.say('Now I stop the Document Platform, the system the files are delivered into. (Terminal step, sped up.)', true);
    platform('stop');
    await s.say('The platform is down. Deliveries retry and wait. Nothing is lost.');
    await s.pause(20_000);
    await s.say('Start the platform again. (Terminal step, sped up.)', true);
    platform('start');
    await s.say('The backlog drains by itself. The dead-letter queue stays empty.', true);
    await expect(page.getByLabel('Counts').locator('.n').first()).toHaveText('2000', { timeout: 20 * 60_000 });
    await page.getByLabel('Counts').scrollIntoViewIfNeeded();
    await s.say('All 2,000 delivered, each exactly once.');
    await s.pause(4500);
  });

  // Scene 4: back to Anantim for the preview and the download, then the closing caption.
  await scene(newContext, 'preview-download', async (s) => {
    const { page } = s;
    await page.goto('/');
    await s.say('Back to Anantim, who sent the first distribution. (Sign-in sped up.)', true);
    await signIn(s, ANANTIM);
    await page.goto(`/#/status/${jobId}`);
    const row = page.locator('.ttable .trow', { has: page.getByRole('button', { name: /^Preview / }) }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await s.say('Anyone in a destination team can open a file. Everyone else gets nothing.');
    await s.click(row.getByRole('button', { name: /^Preview / }));
    await expect(page.getByRole('dialog', { name: 'File preview' })).toBeVisible({ timeout: 30_000 });
    await s.pause(4500);
    await page.keyboard.press('Escape');
    const saved = page.waitForEvent('download');
    await s.click(row.getByRole('button', { name: /^Download / }));
    await saved;
    await s.say('Download saves the file under its original name, on a link that works for two minutes.');
    await s.pause(4500);
    await s.say('Built with Terraform and checked end to end on this system. The code and the design are on GitHub.');
    await s.pause(5000);
  });

  await browser.close();
  rmSync(join(OUT, 'raw'), { recursive: true, force: true });
  writeFileSync(join(OUT, 'clips.json'), JSON.stringify(clips, null, 2));
  console.log(`Recorded ${clips.length} clips in ${OUT} (see clips.json)`);
}

main().catch((error: unknown) => {
  // Never leave the platform stopped by a failed take.
  try { platform('start'); } catch { /* it may already run */ }
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
