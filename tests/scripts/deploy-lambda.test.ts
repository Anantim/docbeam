import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// scripts/deploy-lambda.sh with a fake `aws` on the PATH (the same approach as deploy-service.test.ts).
const SCRIPT = new URL('../../scripts/deploy-lambda.sh', import.meta.url).pathname;
const IMAGE = '346208529537.dkr.ecr.ap-southeast-2.amazonaws.com/docbeam-dev/upload-events:abc-20261015';

const FAKE_AWS = `#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG"
case "$*" in
  "lambda get-function-configuration"*)
    if [ "$STUB_EXISTS" != "1" ]; then echo "ResourceNotFoundException" >&2; exit 254; fi
    echo "$STUB_RUNNING_SHA" ;;
  "lambda get-function "*) echo "$STUB_RUNNING_IMAGE" ;;
  "lambda update-function-code"*) echo "Successful" ;;
  *) : ;;
esac
`;

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

interface Options {
  exists?: boolean;
  runningSha?: string;
  runningImage?: string;
  args?: string[];
  env?: Record<string, string>;
  code?: 'bundle-dir' | 'image';
  bundleContent?: string;
  envName?: string;
}

function run(o: Options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lambda-test-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'aws'), FAKE_AWS);
  chmodSync(join(dir, 'aws'), 0o755);
  const log = join(dir, 'calls.log');
  writeFileSync(log, '');

  const bundle = join(dir, 'bundle');
  mkdirSync(bundle);
  writeFileSync(join(bundle, 'index.mjs'), o.bundleContent ?? 'export const handler = async () => {};');
  const code = o.code === 'image' ? IMAGE : bundle;

  const result = spawnSync('bash', [SCRIPT, o.envName ?? 'dev', 'delivery', code, ...(o.args ?? [])], {
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      HOME: dir,
      STUB_LOG: log,
      STUB_EXISTS: o.exists === false ? '0' : '1',
      STUB_RUNNING_SHA: o.runningSha ?? 'old-sha',
      STUB_RUNNING_IMAGE: o.runningImage ?? 'old-image',
      ...o.env,
    },
  });
  const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean);
  return { ...result, calls, updated: calls.some((c) => c.startsWith('lambda update-function-code')) };
}

/** The SHA the script computes for a bundle, taken from a first run that records the update call. */
function shaOfBundle(content: string): string {
  const first = run({ bundleContent: content });
  expect(first.updated).toBe(true);
  // Run again with the zip hash that the script printed in its --zip-file call: recompute it the same way.
  const dir = mkdtempSync(join(tmpdir(), 'lambda-sha-'));
  dirs.push(dir);
  const bundle = join(dir, 'bundle');
  mkdirSync(bundle);
  writeFileSync(join(bundle, 'index.mjs'), content);
  const zip = join(dir, 'out.zip');
  const made = spawnSync(
    'bash',
    ['-c', `cd "${bundle}" && touch -h -d '2000-01-01 00:00:00 UTC' index.mjs && find . -type f | LC_ALL=C sort | zip -q -X -@ "${zip}" && openssl dgst -sha256 -binary "${zip}" | base64 -w0`],
    { encoding: 'utf8' },
  );
  expect(made.status).toBe(0);
  return made.stdout.trim();
}

describe('scripts/deploy-lambda.sh', () => {
  it('skips with a notice when the function does not exist (dev is down)', () => {
    const r = run({ exists: false });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('does not exist');
    expect(r.updated).toBe(false);
  });

  it('updates the code when the package differs', () => {
    const r = run({ runningSha: 'something-else' });
    expect(r.status).toBe(0);
    expect(r.updated).toBe(true);
    expect(r.calls.some((c) => c.startsWith('lambda wait function-updated'))).toBe(true);
    expect(r.calls.find((c) => c.startsWith('lambda update-function-code'))).toContain('docbeam-dev-delivery');
  });

  it('skips when the function already runs the same bundle, and --force deploys anyway', () => {
    const sha = shaOfBundle('export const handler = async () => 1;');
    const same = run({ bundleContent: 'export const handler = async () => 1;', runningSha: sha });
    expect(same.status).toBe(0);
    expect(same.stdout).toContain('already runs this code');
    expect(same.updated).toBe(false);

    const forced = run({ bundleContent: 'export const handler = async () => 1;', runningSha: sha, args: ['--force'] });
    expect(forced.updated).toBe(true);
    const viaEnv = run({ bundleContent: 'export const handler = async () => 1;', runningSha: sha, env: { FORCE_DEPLOY: 'true' } });
    expect(viaEnv.updated).toBe(true);
  });

  it('gives the same hash for the same files built twice', () => {
    expect(shaOfBundle('export const a = 1;')).toBe(shaOfBundle('export const a = 1;'));
    expect(shaOfBundle('export const a = 1;')).not.toBe(shaOfBundle('export const a = 2;'));
  });

  it('updates an image function only when the image differs', () => {
    const changed = run({ code: 'image', runningImage: 'other:tag' });
    expect(changed.updated).toBe(true);
    expect(changed.calls.find((c) => c.startsWith('lambda update-function-code'))).toContain(`--image-uri ${IMAGE}`);

    const same = run({ code: 'image', runningImage: IMAGE });
    expect(same.updated).toBe(false);
    expect(same.stdout).toContain('already runs');

    expect(run({ code: 'image', runningImage: IMAGE, args: ['--force'] }).updated).toBe(true);
  });

  it('refuses prod outside CI', () => {
    const r = run({ envName: 'prod' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('GitHub workflows');
    expect(r.calls).toHaveLength(0);
  });
});
