// Times the body checks of POST /jobs for a 100 x 20 body (check 5.1, D-M5-14): JSON.parse, the zod schema, and
// validateBatch. It reads the built code, so run `npm run build` first. Run it through scripts/m5-schema-timing.sh,
// which limits the CPU to 0.25 vCPU like the DocBeam API task.
import { randomUUID } from 'node:crypto';
import { validateBatch } from '../../packages/shared/dist/index.js';
import { jobBody } from '../../services/docbeam-api/dist/routes/jobs.js';

const FILES = 100;
const DESTINATIONS = 20;
const RUNS = Number(process.env.RUNS ?? 200);

const fileIds = Array.from({ length: FILES }, () => randomUUID());
const destinations = Array.from({ length: DESTINATIONS }, () => ({ binderId: randomUUID(), folderId: randomUUID() }));
const text = JSON.stringify({
  files: fileIds.map((fileId) => ({ fileId, sha256: 'a'.repeat(64) })),
  mappings: fileIds.map((fileId) => ({ fileId, destinations })),
});

function time(run: () => void): number[] {
  const out: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    const from = performance.now();
    run();
    out.push(performance.now() - from);
  }
  return out;
}
const pct = (xs: number[], p: number): string => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))]!.toFixed(1);

const body = JSON.parse(text) as unknown;
for (let i = 0; i < 20; i += 1) jobBody.parse(body); // warm up the compiler before timing
const parsed = jobBody.parse(body);

const rows: [string, number[]][] = [
  ['JSON.parse', time(() => JSON.parse(text))],
  ['zod schema (jobBody)', time(() => jobBody.parse(body))],
  ['validateBatch', time(() => validateBatch({ files: parsed.files, mappings: parsed.mappings.map((m) => ({ fileId: m.fileId, destinations: m.destinations })) }))],
];
console.log(`body: ${FILES} files x ${DESTINATIONS} destinations = ${FILES * DESTINATIONS} tasks, ${(text.length / 1024).toFixed(0)} KiB, ${RUNS} runs`);
for (const [name, xs] of rows) console.log(`${name.padEnd(24)} p50 ${pct(xs, 50)} ms   p99 ${pct(xs, 99)} ms   max ${Math.max(...xs).toFixed(1)} ms`);
