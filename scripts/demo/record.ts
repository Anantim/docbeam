// Records the demo video (docs/DEMO-SCRIPT.md) with Playwright: 1280x720, a visible cursor, one caption per step.
//
//   DEMO_URL=https://<id>.cloudfront.net DEMO_PASSWORD=... node --no-warnings scripts/demo/record.ts
//
// DEMO_URL         the address to record (default: the local Vite server, http://localhost:5173)
// DEMO_PASSWORD    the seed password (default: SEED_USER_PASSWORD from .env, for the local stack)
// DEMO_FILES       the folder made by scripts/demo-files.sh (default: ~/docbeam-demo-files)
// DEMO_DEV=1       dev on AWS: also the big send (scripts/demo-send.sh) and the outage (scripts/demo-outage.sh)
//                  Without it the recorder runs on the local stack (docker compose, seeded; `npm run dev -w @docbeam/web`),
//                  and the outage is `docker compose stop platform` and `start` around a send of its own.
// DEMO_OUT         where the video goes (default: docs/demo). The checked frames go to a frames folder inside it (git-ignored)
//                  and replace the ones there.
//
// It writes docbeam-demo.webm (VP9, under 25 MB, 3 to 5 minutes) and one frame per step as a PNG, so every step can
// be looked at. The video is made from the browser's own screencast frames: stretches of waiting (a scan, a big upload, a
// drain) are played faster, because the only video encoder on the laptop is the one Playwright brings and it has no
// editing filters.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Locator } from '@playwright/test';

const ROOT = new URL('../..', import.meta.url).pathname;
const URL_BASE = process.env.DEMO_URL ?? 'http://localhost:5173';
const FILES = process.env.DEMO_FILES ?? join(homedir(), 'docbeam-demo-files');
const OUT = process.env.DEMO_OUT ?? join(ROOT, 'docs/demo');
const FRAMES = join(OUT, 'frames'); // one picture per step, to look at; not kept in git (docs/demo/frames/ is ignored)
const DEV = process.env.DEMO_DEV === '1';
/** How long each caption stays, as a multiple of the base time: the video is for reading, not for speed. */
const PACE = Number(process.env.DEMO_PACE ?? '2');

function envFile(name: string): string | undefined {
  try {
    const line = readFileSync(join(ROOT, '.env'), 'utf8').split('\n').find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
  } catch {
    return undefined;
  }
}
const PASSWORD = process.env.DEMO_PASSWORD ?? envFile('SEED_USER_PASSWORD');
if (!PASSWORD) throw new Error('Set DEMO_PASSWORD (the seed password) or SEED_USER_PASSWORD in .env.');
const ffmpegDir = existsSync(join(homedir(), '.cache/ms-playwright')) ? readdirSync(join(homedir(), '.cache/ms-playwright')).find((d) => d.startsWith('ffmpeg')) : undefined;
if (!ffmpegDir) throw new Error('Playwright\'s ffmpeg is not installed (run: npx playwright install ffmpeg).');
if (!existsSync(FILES)) throw new Error(`Run scripts/demo-files.sh first: ${FILES} does not exist.`);

const compose = (...args: string[]): string => execFileSync('docker', ['compose', ...args], { cwd: ROOT, encoding: 'utf8' });

const CARDIO_IRB = 'IRB approvals';
const CARDIO_PROTOCOL = 'Protocol amendments';
const ONC_ETHICS = 'Ethics committee';

mkdirSync(OUT, { recursive: true });
mkdirSync(FRAMES, { recursive: true });
for (const f of readdirSync(FRAMES)) rmSync(join(FRAMES, f));

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  baseURL: URL_BASE,
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();

// The screencast: the browser sends a JPEG each time the page changes. They are kept with the time they arrived.
const frames: Array<{ at: number; jpeg: Buffer }> = [];
const cdp = await context.newCDPSession(page);
cdp.on('Page.screencastFrame', (event: { data: string; sessionId: number }) => {
  frames.push({ at: Date.now(), jpeg: Buffer.from(event.data, 'base64') });
  void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => undefined);
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
const t0 = Date.now();
const seen = (): number => (Date.now() - t0) / 1000;

// A cursor you can see (the recording has none), and a caption bar at the bottom.
await context.addInitScript(`
  (() => {
    const add = () => {
      if (document.getElementById('demo-cursor')) return;
      const style = document.createElement('style');
      style.textContent = '#demo-cursor{position:fixed;z-index:2147483647;width:22px;height:22px;margin:-4px 0 0 -4px;pointer-events:none;transition:transform .05s linear}' +
        '#demo-cursor svg{filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))}' +
        '#demo-caption{position:fixed;z-index:2147483646;left:50%;bottom:72px;transform:translateX(-50%);max-width:70%;background:rgba(16,24,40,.92);color:#fff;padding:10px 18px;border-radius:6px;font:500 16px/1.4 system-ui,sans-serif;text-align:center;pointer-events:none;opacity:0;transition:opacity .15s}' +
        '#demo-caption.on{opacity:1}';
      document.head.appendChild(style);
      const c = document.createElement('div');
      c.id = 'demo-cursor';
      c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M4 2l13 8-6 1.5L8.5 18z" fill="#fff" stroke="#101828" stroke-width="1.5" stroke-linejoin="round"/></svg>';
      document.body.appendChild(c);
      const cap = document.createElement('div');
      cap.id = 'demo-caption';
      document.body.appendChild(cap);
      window.addEventListener('mousemove', (e) => { c.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; }, true);
    };
    if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
  })();
`);

const started = Date.now();
let frame = 0;

// The scripts below block this process while they run, so the screencast frames of that stretch arrive late; each
// stretch is played ×12 or faster, so the timeline error is not visible.
/** Stretches of waiting (a scan, a big upload, a drain) that the video plays faster, so it runs 3 to 5 minutes. */
const fast: Array<{ from: number; to: number; factor: number }> = [];
async function skim<T>(factor: number, work: () => Promise<T>): Promise<T> {
  const from = seen() + 0.5;
  try {
    return await work();
  } finally {
    const to = seen() - 0.5;
    if (to - from > 4) fast.push({ from, to, factor });
  }
}
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A caption for this step, a frame for the check, and a pause long enough to read it. */
async function say(text: string, hold = 2500): Promise<void> {
  await page.evaluate((t) => {
    const cap = document.getElementById('demo-caption');
    if (cap) {
      cap.textContent = t;
      cap.classList.add('on');
    }
  }, text);
  await wait(400);
  frame += 1;
  await page.screenshot({ path: join(FRAMES, `${String(frame).padStart(2, '0')}.png`) });
  console.log(`${String(Math.round((Date.now() - started) / 1000)).padStart(4)} s  ${text}`);
  await wait(hold * PACE);
}

const quiet = (): Promise<void> => page.evaluate(() => document.getElementById('demo-caption')?.classList.remove('on'));

/** Moves the cursor to the middle of something, slowly enough to follow, then clicks. */
async function click(target: Locator, pause = 350): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
  await wait(pause);
  await target.click();
}

async function signIn(email: string): Promise<void> {
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD as string);
  await click(page.getByRole('button', { name: 'Sign in' }));
  await page.getByRole('button', { name: 'Sign out' }).waitFor();
}

async function signOut(): Promise<void> {
  await click(page.getByRole('button', { name: 'Sign out' }));
  await page.getByRole('heading', { name: 'Sign in' }).waitFor();
}

async function tickFolder(team: string, binder: string, folder: string): Promise<void> {
  const box = page.getByRole('checkbox', { name: new RegExp(` to ${team} / ${binder} / ${folder}$`) });
  if (!(await box.isVisible())) {
    for (const name of [team, binder]) {
      const expand = page.getByRole('button', { name: `Expand ${name}`, exact: true });
      await expand.or(page.getByRole('button', { name: `Collapse ${name}`, exact: true })).waitFor();
      if (await expand.isVisible()) await click(expand, 150);
    }
  }
  await click(box, 200);
}

try {
  // 1. Sign in.
  await page.goto('/');
  await say('DocBeam sends clinical trial documents to many team folders at once, and tracks every delivery.', 3500);
  await signIn('anantim.patil@example.com');

  // 2. Files: add, check, refuse.
  await say('Add the files once. Each is checked in the browser, uploaded, and scanned for malware.', 2000);
  const pdfs = readdirSync(FILES).filter((f) => f.endsWith('.pdf') && !f.startsWith('EICAR') && !f.startsWith('Renamed')).map((f) => join(FILES, f));
  const extra = readdirSync(FILES).filter((f) => f.endsWith('.png')).map((f) => join(FILES, f));
  await page.getByLabel('Choose files').setInputFiles([...pdfs, ...extra]);
  await page.getByText('Ready', { exact: true }).first().waitFor({ timeout: 120_000 });
  await say('Each file shows its state: Uploading, Scanning, Ready.', 2500);
  await skim(12, () => page.getByText('Ready', { exact: true }).nth(pdfs.length + extra.length - 1).waitFor({ timeout: 180_000 }));
  // A picture with a .pdf name (scripts/demo-files.sh): the page reads the contents and does not add it.
  await page.getByLabel('Choose files').setInputFiles(join(FILES, 'Renamed photo.pdf'));
  await page.locator('.not-added').waitFor();
  await say('The type comes from the contents, not the name. A picture renamed to .pdf is not added.', 3000);
  await click(page.locator('.not-added').getByRole('button', { name: 'Close' }));
  await page.getByLabel('Choose files').setInputFiles(join(FILES, 'EICAR test file.docx')); // a real DOCX with the test string inside (scripts/eicar-docx.ts)
  await skim(12, () => page.getByText('Refused', { exact: true }).waitFor({ timeout: 120_000 }));
  await say('The standard antivirus test file is refused. It is deleted and can never be sent.', 3500);
  await click(page.getByRole('button', { name: 'Remove EICAR test file.docx' }));

  // A reload keeps the files that are already uploaded and scanned (D-F1-66).
  await say('Reload the page: the files that are already uploaded and scanned are still here.', 2500);
  await page.reload();
  await page.getByText('Ready', { exact: true }).nth(pdfs.length + extra.length - 1).waitFor({ timeout: 60_000 });
  await say('They come back Ready, so nothing is uploaded again.', 3000);

  // 3. Folders: tick, then the summary.
  await say('Select the files, or leave none selected for all of them, then tick folders. I only see my own teams.', 2500);
  await click(page.getByLabel('Select all to choose their folders'));
  await tickFolder('Cardio', 'CARDIO-301 Regulatory', CARDIO_IRB);
  await tickFolder('Cardio', 'CARDIO-301 Regulatory', CARDIO_PROTOCOL);
  // The folder search looks in every folder of my teams, not only the ones already open (D-F1-67).
  await click(page.getByRole('searchbox', { name: 'Filter folders' }));
  await page.keyboard.type('ethics', { delay: 150 });
  const found = page.getByRole('button', { name: /Ethics committee and show it in the tree$/ });
  await found.waitFor();
  await say('Search finds a folder anywhere in my teams, with its full path.', 3000);
  await click(found);
  await say('Picking it ticks it and opens the tree down to it.', 3000);
  await say('The highlighted files show who a tick is for. The full summary comes in the question before Send.', 3500);

  // A tick can go to some files only: select one row, tick another folder, and the others show a dash.
  const lab = page.locator('.frow[data-id]', { hasText: 'Lab certification' });
  await click(page.getByLabel('Select all to choose their folders'));
  await click(lab.locator('.fname'));
  await tickFolder('Oncology', 'ONC-118 Regulatory', 'Investigator CVs');
  await say('With some files selected, a tick goes to those files only. Here: one file to one more folder.', 3500);
  await click(lab.getByRole('button', { name: /folders of/ }));
  await say('The folders of a file are one click away.', 2500);
  await page.keyboard.press('Escape');
  await tickFolder('Oncology', 'ONC-118 Regulatory', 'Investigator CVs'); // take it off again
  await click(page.getByLabel('Select all to choose their folders'));

  // 4. Send, with a question first.
  await click(page.getByRole('button', { name: 'Send', exact: true }));
  await say('Sending asks first. Delivered files can not be recalled, and Cancel is the default.', 3500);
  await click(page.getByRole('dialog').getByRole('button', { name: 'Send', exact: true }));
  await page.waitForURL(/#\/status\//);

  // 5. Status: the panel.
  await page.locator('.status-chip.big').waitFor();
  await say('Each delivery is tracked. The numbers move on their own, without reloading.', 3500);
  await skim(12, () => page.locator('.status-chip.big', { hasText: 'Completed' }).waitFor({ timeout: 300_000 }));
  await say('Every delivery has a status. Preview and Download are on completed rows.', 2500);
  const address = page.url();
  // The short ID names a distribution: copy its link, or open any distribution by typing its ID.
  const shortId = /#\/status\/([0-9a-f]{8})/.exec(address)?.[1] as string;
  await click(page.locator('.panel-top').getByRole('button', { name: 'Copy link' }));
  await say('Copy the link to this distribution with one click.', 2500);
  await click(page.getByRole('button', { name: 'Open by ID' }));
  await page.getByPlaceholder('Distribution ID or link').pressSequentially(shortId, { delay: 120 });
  await say(`Or open any distribution by its short ID: ${shortId}.`, 3000);
  await page.keyboard.press('Enter');
  await page.locator('.status-chip.big').waitFor();
  await say('The list narrows beside the panel. Esc closes the panel and the full list is back.', 3000);
  await page.keyboard.press('Escape');
  await wait(1500 * PACE);

  // 6. Other people see what they should.
  await signOut();
  await signIn('raj.mehta@example.com');
  await page.goto(address);
  await page.locator('.status-chip.big').waitFor();
  await say('Raj is in Cardio only. He sees only the Cardio deliveries of this distribution.', 4500);
  await signOut();
  await signIn('sam.ito@example.com');
  await page.goto(address);
  await page.getByText('Distribution not found').waitFor();
  await say('Sam is in Neuro only. He gets "not found", the same answer as for one that does not exist.', 4500);
  await signOut();

  // 7. Dev only: the big send, and an outage.
  await signIn('anantim.patil@example.com');
  if (DEV) {
    await say('Now a big one: 100 files to 20 folders, 2,000 deliveries, sent in one action.', 2500);
    const out = await skim(40, async () => {
      // 1 MiB files, so the deliveries take minutes and there is a backlog to watch.
      const sent = execFileSync('scripts/demo-send.sh', ['--size=1048576'], { cwd: ROOT, encoding: 'utf8' });
      // Stopped at once, while the deliveries are only starting, so there is a backlog to watch.
      execFileSync('scripts/demo-outage.sh', ['stop'], { cwd: ROOT });
      return sent;
    });
    const big = /https?:\/\/\S+#\/status\/[0-9a-f-]{36}/.exec(out)?.[0];
    await signOut();
    await signIn('load.user@example.com');
    if (big) await page.goto(big);
    await page.locator('.status-chip.big').waitFor();
    await say('The counts and every delivery update live. A failure says why when you hover it.', 3000);
    await say('The Document Platform was just stopped. Nothing is lost: look for the Retrying chips.', 5000);
    await skim(12, () => wait(40_000)); // the deliveries turn blue and retry
    await skim(12, async () => execFileSync('scripts/demo-outage.sh', ['start'], { cwd: ROOT }));
    await say('It starts again. The backlog drains by itself.', 8000);
    await skim(12, () => page.locator('.status-chip.big', { hasText: 'Completed' }).waitFor({ timeout: 900_000 }));
    await say('All 2,000 delivered, once each.', 3000);
    await signOut();
    await signIn('anantim.patil@example.com');
  } else {
    // The local stack: a send of its own, the platform stopped right after it is accepted, one file removed from storage so that
    // its deliveries fail for good, then the platform started again.
    await click(page.getByRole('button', { name: 'Distribute' }));
    await say('Now a send while the Document Platform goes down.', 2500);
    const more = readdirSync(FILES).filter((f) => f.endsWith('.pdf') && !f.startsWith('EICAR') && !f.startsWith('Renamed')).slice(0, 8).map((f) => join(FILES, f));
    await page.getByLabel('Choose files').setInputFiles(more);
    await skim(12, () => page.getByText('Ready', { exact: true }).nth(more.length - 1).waitFor({ timeout: 180_000 }));
    await tickFolder('Cardio', 'CARDIO-301 Regulatory', CARDIO_IRB);
    await tickFolder('Cardio', 'CARDIO-301 Regulatory', CARDIO_PROTOCOL);
    await tickFolder('Oncology', 'ONC-118 Regulatory', ONC_ETHICS);
    // The workers are held while the send is accepted, so that no delivery starts before the platform is stopped: the same
    // order every time, however fast the local deliveries are.
    compose('stop', '-t', '0', 'workers');
    await click(page.getByRole('button', { name: 'Send', exact: true }));
    await click(page.getByRole('dialog').getByRole('button', { name: 'Send', exact: true }));
    await page.waitForURL(/#\/status\//);
    compose('stop', '-t', '0', 'platform');
    const jobId = /#\/status\/([0-9a-f-]{36})/.exec(page.url())?.[1] as string;
    const key = compose('exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'docbeam_db', '-Atc', `select s3_key from files where job_id = '${jobId}' order by original_name limit 1`).trim();
    compose('exec', '-T', 'localstack', 'awslocal', 's3', 'rm', `s3://docbeam-local-object-store/${key}`); // this file never "finished uploading"
    compose('up', '-d', '--no-deps', 'workers'); // the deliveries start now and meet a platform that is not there (`start` would bring the platform back: it is a dependency)
    await page.locator('.status-chip.big').waitFor();
    await say('The Document Platform was just stopped. Nothing is lost: look for the Retrying chips.', 5000);
    // The second try of each delivery is pushed to the page, so the chips change by themselves (D-F1-65).
    await skim(6, () => page.locator('.status-chip', { hasText: 'Retrying' }).first().waitFor({ timeout: 120_000 }));
    await say('Deliveries that failed once are Retrying. They wait and try again.', 4000);
    compose('start', 'platform');
    await skim(12, () => page.locator('.status-chip.big', { hasText: 'Completed with errors' }).waitFor({ timeout: 600_000 }));
    await say('The platform is back. The backlog drained by itself, each delivery once.', 3500);
    await click(page.getByRole('button', { name: /^All, \d+ deliver/ }));
    const why = page.getByRole('button', { name: 'Why this delivery failed' }).first();
    await why.waitFor();
    await click(why);
    await say('A failed delivery says why when you hover or click its info icon.', 4000);
    await page.keyboard.press('Escape'); // closes the tooltip (and the panel)
  }

  // 8. The list, the filters, a preview and a download.
  await click(page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Status' }));
  await page.locator('.dist-table tbody tr').first().waitFor();
  await say('One list of everything you can see. Filter by status, sender, date and team; the next 20 load as you scroll.', 4000);
  await click(page.getByRole('group', { name: 'Filters' }).getByRole('button', { name: /^Status/ }));
  await click(page.getByRole('menuitemradio', { name: 'Completed', exact: true }));
  await say('A filter shows its value on its button and lives in the address.', 3000);
  await click(page.getByRole('button', { name: 'Clear filters' }));
  if (await page.locator('.status-chip.big').count()) await page.keyboard.press('Escape'); // a panel left open: close it, the click below opens one
  await click(page.locator('.dist-table tbody tr').first().locator('td').nth(2)); // the Sent cell: plain text (the middle of the row can be a "+N", which opens its own list)
  await page.locator('.status-chip.big').waitFor();
  await click(page.getByRole('button', { name: /^Preview / }).first());
  await page.getByRole('dialog', { name: 'File preview' }).waitFor();
  await say('Anyone in a destination team can preview a file. The link lasts two minutes.', 4000);
  await page.keyboard.press('Escape');
  await quiet();
  await say('Built with Terraform and checked end to end. The code and the design are on GitHub.', 3500);
} finally {
  await cdp.send('Page.stopScreencast').catch(() => undefined);
  await page.close();
  await context.close();
  await browser.close();
}

// The video: one frame every 1/15 s of video time. Normal stretches take 1/15 s of real time per frame, a sped-up stretch
// takes `factor` times that, and each output frame shows the last screencast frame that had arrived by then.
const FPS = 15;
const end = Date.now();
const ffmpeg = join(homedir(), '.cache/ms-playwright', ffmpegDir, 'ffmpeg-linux');
const final = join(OUT, 'docbeam-demo.webm');
rmSync(final, { force: true });
const encoder = spawn(
  ffmpeg,
  ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0', '-c:v', 'libvpx-vp9', '-crf', '36', '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '8', '-pix_fmt', 'yuv420p', final],
  { stdio: ['pipe', 'inherit', 'inherit'] },
);
const done = new Promise<void>((resolve, reject) => {
  encoder.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg stopped with ${code}`))));
});
const factorAt = (second: number): number => fast.find((f) => second >= f.from && second < f.to)?.factor ?? 1;
let shown = 0;
let outFrames = 0;
for (let real = 0; t0 + real * 1000 <= end; real += factorAt(real) / FPS) {
  while (shown + 1 < frames.length && (frames[shown + 1] as { at: number }).at <= t0 + real * 1000) shown += 1;
  const frame = frames[shown];
  if (!frame) continue;
  if (!encoder.stdin.write(frame.jpeg)) await new Promise<void>((resolve) => encoder.stdin.once('drain', () => resolve()));
  outFrames += 1;
}
encoder.stdin.end();
await done;
const mb = statSync(final).size / 1024 / 1024;
const length = outFrames / FPS;
console.log(`\nwrote ${final}: ${mb.toFixed(1)} MB, ${Math.round(length)} s long (${Math.round(seen())} s recorded, ${fast.length} stretches sped up), ${frame} frames checked in ${FRAMES}`);
if (mb >= 25) throw new Error('The video is over 25 MB.');
if (length < 180 || length > 300) throw new Error(`The video is ${Math.round(length)} s: it should be 3 to 5 minutes.`);
