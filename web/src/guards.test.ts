import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { FAILURE_CODES, FAILURE_REASON, FILE_REASON } from '@docbeam/shared/browser';
import { describe, expect, it } from 'vitest';
import { failureMeaning, FAILURE_MEANING, INFECTED_REASON, UPLOAD_STATUS_MEANING } from './explain.js';
import { deliveryTip } from './components/TaskTable.js';

// Guards (D-F1-78): these fail when the same kind of drift comes back, so it is caught by the tests and not by a reviewer's eye.

const ROOT = process.cwd();

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sources(path);
    return [path];
  });
}
const rel = (p: string): string => p.replace(`${ROOT}/`, '');
const webCode = sources(join(ROOT, 'web/src')).filter((p) => /\.(tsx?|css)$/.test(p) && !/\.test\./.test(p));
const read = (p: string): string => readFileSync(p, 'utf8');

describe('style guard: one note, one chip, one icon colour', () => {
  it('has none of the removed classes in the web code or the stylesheet', () => {
    const offenders: string[] = [];
    const names = ['alert', 'banner', 'team-chip', 'icon.retry', 'not-added', 'struck', 'ck.locked', 'btnsm', 'searchfield.sm'];
    const inCss = names.map((n) => new RegExp(String.raw`\.${n.replace('.', String.raw`\.`)}(?![\w-])`));
    const inMarkup = ['alert', 'banner', 'team-chip', 'icon retry', 'not-added', 'struck', 'locked', 'btnsm'].map((n) => new RegExp(String.raw`className=(?:"[^"]*|\{\x60[^\x60]*)\b${n}(?![\w-])`));
    for (const path of webCode) {
      const checks = path.endsWith('.css') ? inCss : inMarkup;
      read(path)
        .split('\n')
        .forEach((line, i) => {
          if (checks.some((re) => re.test(line))) offenders.push(`${rel(path)}:${i + 1}: ${line.trim().slice(0, 90)}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it('draws an in-page message only with the Notice component: role="alert" lives in Notice and in the toasts, nowhere else', () => {
    const allowed = new Set(['web/src/components/Notice.tsx', 'web/src/components/Toasts.tsx']);
    const offenders = webCode.filter((p) => p.endsWith('.tsx') && !allowed.has(rel(p)) && /role=["']alert["']/.test(read(p))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('uses the one "Try again" link inside a Notice, not a button of its own', () => {
    const offenders = webCode
      .filter((p) => p.endsWith('.tsx') && rel(p) !== 'web/src/components/Notice.tsx')
      .filter((p) => />\s*Try again\s*</.test(read(p)))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

describe('wording guard: "couldn\'t" and "can\'t", and sentences that start with a capital and end with a period', () => {
  // The few texts that are not a sentence on purpose. Keep this list short.
  const ONE_WORD = new Set(['Sent']);

  /** The string literals handed to the calls that put words in front of the person: toasts, notes and API errors. */
  function messages(text: string): string[] {
    const found: string[] = [];
    const literal = String.raw`(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|\x60((?:[^\x60\\]|\\.)*)\x60)`;
    const calls = [
      new RegExp(String.raw`\bnotify\(\s*${literal}`, 'g'),
      new RegExp(String.raw`\bheading=\{?${literal}`, 'g'),
      new RegExp(String.raw`\bdetail=\{?${literal}`, 'g'),
      new RegExp(String.raw`new ApiError\(\s*\d+\s*,\s*'[A-Z_]+'\s*,\s*${literal}`, 'g'),
      new RegExp(String.raw`new ApiFailure\(\s*\d+\s*,\s*${literal}`, 'g'),
    ];
    for (const re of calls) for (const m of text.matchAll(re)) found.push((m[1] ?? m[2] ?? m[3] ?? '').replace(/\\(['"])/g, '$1'));
    return found;
  }

  const serverFiles = ['services', 'packages', 'workers']
    .flatMap((d) => sources(join(ROOT, d)))
    .filter((p) => p.endsWith('.ts') && !/\.test\.|node_modules|\/dist\//.test(p));
  const files = [...webCode.filter((p) => p.endsWith('.tsx') || p.endsWith('.ts')), ...serverFiles];

  it('says "could not" and "cannot" nowhere a person can read it', () => {
    const offenders: string[] = [];
    let seen = 0;
    for (const path of files) {
      for (const text of messages(read(path))) {
        seen += 1;
        if (/\b(could not|cannot|can not)\b/i.test(text)) offenders.push(`${rel(path)}: ${text.slice(0, 80)}`);
      }
    }
    expect(seen).toBeGreaterThan(60); // the scan really reads the toasts, the notes and the API errors
    expect(offenders).toEqual([]);
  });

  it('starts every toast, note line and API error message with a capital letter and ends it with a period', () => {
    const offenders: string[] = [];
    for (const path of files) {
      for (const text of messages(read(path))) {
        if (ONE_WORD.has(text) || text.includes('${')) continue; // a built sentence is checked by the test of the code that builds it
        if (!/^[A-Z]/.test(text) || !/[.?]$/.test(text)) offenders.push(`${rel(path)}: "${text.slice(0, 80)}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('also holds for the sentences with a built part: they end with a period too', () => {
    const offenders: string[] = [];
    for (const path of files) {
      for (const text of messages(read(path))) {
        if (!text.includes('${')) continue;
        if (!/[.?]$/.test(text) && !/\}$/.test(text)) offenders.push(`${rel(path)}: "${text.slice(0, 80)}"`);
        if (/^[a-z]/.test(text)) offenders.push(`${rel(path)}: "${text.slice(0, 80)}" starts with a small letter`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('outcome guard: one sentence for each way a delivery or a file can fail', () => {
  it('has exactly one sentence for every failure code the workers can store, and no two codes share one', () => {
    expect(Object.keys(FAILURE_REASON).sort()).toEqual([...FAILURE_CODES].sort());
    const sentences = Object.values(FAILURE_REASON);
    expect(new Set(sentences).size).toBe(sentences.length);
    for (const s of sentences) expect(s).toMatch(/^[A-Z].*\.$/);
  });

  it('is shown by the web app word for word: the reason map, the tooltip of a failed delivery, and the unknown-code fallback', () => {
    expect(FAILURE_MEANING).toBe(FAILURE_REASON);
    for (const code of FAILURE_CODES) {
      expect(failureMeaning(code), code).toBe(FAILURE_REASON[code]);
      if (code === 'RETRIES_EXHAUSTED') continue; // the tooltip says it, and the attempts apart from it (D-F1-60)
      expect(deliveryTip({ attemptCount: 1, failureCode: code }, code === 'CANCELLED' ? 'cancelled' : 'failed'), code).toBe(FAILURE_REASON[code]);
    }
    expect(failureMeaning('SOMETHING_NEW')).toBe('The delivery did not go through.');
  });

  it('gives the files the same: malware and a scan that could not run say what the workers store', () => {
    expect(INFECTED_REASON).toBe(FILE_REASON.MALWARE);
    expect(UPLOAD_STATUS_MEANING.unchecked).toBe(FILE_REASON.SCAN_FAILED);
  });
});
