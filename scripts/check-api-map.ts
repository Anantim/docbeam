// Checks that docs/USER-FLOW-AND-APIS.md leaves nothing out (Part D of the final sequence, D-F1-70). Run by hand
// (`node --no-warnings scripts/check-api-map.ts`) and by the unit tests (`tests/scripts/check-api-map.test.ts`).
//
// It compares four things with the inventory in docs/user-flow/api-inventory.json:
//   1. the code: every API path that appears in web/src (outside tests) and every file that opens a network connection;
//   2. the gateway: every public route in infra/envs/dev/services.tf;
//   3. the capture: every request path seen in docs/user-flow/capture/traffic.json;
//   4. the guide: every inventory entry is named in docs/USER-FLOW-AND-APIS.md.
// Anything missing is a problem, and the script exits 1.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface InventoryEntry {
  label: string;
  kind: 'api' | 'ws' | 's3' | 'unused';
  chapter: number;
  sources: string[];
}
export interface Inventory {
  entries: InventoryEntry[];
  networkSites: Record<string, string>;
}
export interface CaptureRecord {
  kind: 'api' | 's3' | 'ws';
  method?: string;
  path?: string;
  /** For a WebSocket frame: its `type`, or `subscribe` for the one the page sends. */
  frame?: string;
}

/** `/files/${id}/x`, `/files/3f2a…/x` and `/files/{fileId}/x` all become `/files/{}/x`; the query is dropped. */
export function shapeOf(path: string): string {
  const noQuery = (path.split('?')[0] ?? '')
    .replace(/\$\{[^}]*\}/g, '{}')
    .replace(/\{[A-Za-z]*\}/g, '{}')
    .replace(/\/multipart-uploads\/[^/]+\/(parts|complete)$/, '/multipart-uploads/{}/$1'); // the uploadId is not a UUID
  const parts = noQuery.split('/').map((p) => (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p) ? '{}' : p));
  const joined = parts.join('/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
}

const API_ROOTS = 'auth|uploads|files|jobs|teams|binders|folders';

/** The API paths named in a source file: every string or template literal that holds one (after `${...}` is made `{}`). */
export function pathsInSource(source: string): string[] {
  const found = new Set<string>();
  for (const m of source.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
    const text = (m[2] ?? '').replace(/\$\{[^}]*\}/g, '{}');
    const hit = new RegExp(`(?:^|\\{\\})(/(?:${API_ROOTS})(?:/[A-Za-z0-9_{}.\\-/]*)?)`).exec(text);
    if (hit?.[1]) found.add(shapeOf(hit[1]));
  }
  return [...found];
}

const NETWORK = /\bfetch\(|XMLHttpRequest|new WebSocket\(|\bEventSource\b|sendBeacon|\ba\.href\s*=/;

export interface Inputs {
  inventory: Inventory;
  /** Source files outside the tests, by repository path. */
  code: Map<string, string>;
  /** `METHOD /path` of every public gateway route. */
  routes: string[];
  capture: CaptureRecord[];
  guide: string;
}

export interface Report {
  problems: string[];
  summary: string[];
}

export function check(inputs: Inputs): Report {
  const { inventory, code, routes, capture, guide } = inputs;
  const problems: string[] = [];
  const api = inventory.entries.filter((e) => e.kind === 'api' || e.kind === 'unused');
  const known = new Set(api.map((e) => shapeOf(e.label.slice(e.label.indexOf(' ') + 1))));
  const knownCalls = new Set(api.map((e) => `${e.label.split(' ')[0]} ${shapeOf(e.label.slice(e.label.indexOf(' ') + 1))}`));

  // 1. The code: every API path, and every file that opens a connection.
  const seenPaths = new Map<string, string[]>();
  for (const [file, text] of code) {
    for (const p of pathsInSource(text)) seenPaths.set(p, [...(seenPaths.get(p) ?? []), file]);
    if (NETWORK.test(text) && !(file in inventory.networkSites)) problems.push(`code: ${file} opens a network connection and is not in networkSites`);
  }
  for (const [p, files] of seenPaths) if (!known.has(p)) problems.push(`code: ${p} (in ${files.join(', ')}) is not in the inventory`);
  for (const file of Object.keys(inventory.networkSites)) if (!code.has(file)) problems.push(`inventory: networkSites names ${file}, which is not in the code`);
  for (const e of inventory.entries) for (const s of e.sources) if (!code.has(s)) problems.push(`inventory: "${e.label}" names the source ${s}, which is not in the code`);
  for (const e of api.filter((x) => x.kind === 'api')) {
    const p = shapeOf(e.label.slice(e.label.indexOf(' ') + 1));
    if (!seenPaths.has(p)) problems.push(`inventory: "${e.label}" is not found in the code any more`);
  }

  // 2. The gateway: every public route is called by the web app or listed as not called.
  for (const r of routes) if (!knownCalls.has(`${r.split(' ')[0]} ${shapeOf(r.slice(r.indexOf(' ') + 1))}`)) problems.push(`gateway: ${r} is not in the inventory`);
  for (const e of api) if (!routes.some((r) => `${r.split(' ')[0]} ${shapeOf(r.slice(r.indexOf(' ') + 1))}` === `${e.label.split(' ')[0]} ${shapeOf(e.label.slice(e.label.indexOf(' ') + 1))}`)) problems.push(`inventory: "${e.label}" is not a public gateway route`);

  // 3. The capture: every request path seen is in the inventory (and so in the guide).
  const frames = new Set(inventory.entries.filter((e) => e.kind === 'ws').map((e) => e.label.split(' ').at(-1)));
  const kinds = new Set(inventory.entries.map((e) => e.kind));
  for (const rec of capture) {
    if (rec.kind === 'api') {
      const key = `${rec.method} ${shapeOf(rec.path ?? '')}`;
      if (!knownCalls.has(key)) problems.push(`capture: ${key} was seen and is not in the inventory`);
    } else if (rec.kind === 'ws') {
      if (!frames.has(rec.frame)) problems.push(`capture: the WebSocket frame "${rec.frame}" was seen and is not in the inventory`);
    } else if (!kinds.has('s3')) problems.push('capture: an S3 request was seen and the inventory has no S3 entry');
  }

  // 4. The guide: every inventory entry is named in it.
  for (const e of inventory.entries) if (!guide.includes(e.label)) problems.push(`guide: "${e.label}" is not in docs/USER-FLOW-AND-APIS.md`);

  const count = (k: InventoryEntry['kind']) => inventory.entries.filter((e) => e.kind === k).length;
  return {
    problems,
    summary: [
      `inventory: ${inventory.entries.length} calls (${count('api')} API, ${count('s3')} S3, ${count('ws')} WebSocket) and ${count('unused')} public routes the web app does not call`,
      `code: ${code.size} source files read, ${seenPaths.size} API paths found, ${Object.keys(inventory.networkSites).length} files that open a connection`,
      `gateway: ${routes.length} public routes`,
      `capture: ${capture.length} requests and frames, ${new Set(capture.map((c) => (c.kind === 'api' ? `${c.method} ${shapeOf(c.path ?? '')}` : c.kind === 'ws' ? `ws ${c.frame}` : 's3'))).size} distinct calls`,
      `guide: ${guide.split('\n').length} lines`,
    ],
  };
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Reads the repository: the inventory, the web source outside its tests, the gateway routes, the capture and the guide. */
export function loadInputs(root: string): Inputs {
  const inventory = JSON.parse(readFileSync(join(root, 'docs/user-flow/api-inventory.json'), 'utf8')) as Inventory;
  inventory.networkSites = Object.fromEntries(Object.entries(inventory.networkSites).filter(([key]) => !key.startsWith('_'))); // `_note` is a comment
  const code = new Map<string, string>();
  for (const file of walk(join(root, 'web/src'))) {
    if (!/\.(ts|tsx)$/.test(file) || /\.test\.|\/testing\//.test(file)) continue;
    code.set(relative(root, file), readFileSync(file, 'utf8'));
  }
  const tf = readFileSync(join(root, 'infra/envs/dev/services.tf'), 'utf8');
  const routes = [...new Set([...tf.matchAll(/^\s*"((?:GET|POST|PUT|DELETE|PATCH) \/[^"]*)"\s*=/gm)].map((m) => m[1] as string))];
  const capturePath = join(root, 'docs/user-flow/capture/traffic.json');
  const capture = existsSync(capturePath) ? ((JSON.parse(readFileSync(capturePath, 'utf8')) as { records: CaptureRecord[] }).records ?? []) : [];
  const guidePath = join(root, 'docs/USER-FLOW-AND-APIS.md');
  const guide = existsSync(guidePath) ? readFileSync(guidePath, 'utf8') : '';
  return { inventory, code, routes, capture, guide };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const root = new URL('..', import.meta.url).pathname;
  const report = check(loadInputs(root));
  for (const line of report.summary) console.log(line);
  if (report.problems.length > 0) {
    for (const p of report.problems) console.log(`MISSING  ${p}`);
    console.log(`check-api-map: FAIL (${report.problems.length} problems)`);
    process.exit(1);
  }
  console.log('check-api-map: PASS (nothing missing)');
}
