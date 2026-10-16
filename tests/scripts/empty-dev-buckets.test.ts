import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// scripts/empty-dev-buckets.sh with a fake `aws` and a fake `terraform` (D-M2-23).
const SCRIPT = new URL('../../scripts/empty-dev-buckets.sh', import.meta.url).pathname;
const ACCOUNT = '123456789012';

// The fake bucket holds STUB_COUNT_<n> objects (versions and delete markers together). A listing returns at most
// the first 1,000, and a delete removes as many as the request names, as S3 does.
const FAKE_AWS = `#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG"
state() { echo "$STUB_DIR/count-$1"; }
case "$*" in
  "sts get-caller-identity"*) echo "$STUB_ACCOUNT" ;;
  "s3api head-bucket"*)
    bucket="$(echo "$*" | sed -E 's/.*--bucket ([^ ]+).*/\\1/')"
    [ -f "$(state "$bucket")" ] || exit 254 ;;
  "s3api list-object-versions"*)
    bucket="$(echo "$*" | sed -E 's/.*--bucket ([^ ]+).*/\\1/')"
    n="$(cat "$(state "$bucket")")"; [ "$n" -gt 1000 ] && n=1000
    printf '{"Objects":['
    for ((i = 0; i < n; i++)); do [ $i -gt 0 ] && printf ','; printf '{"Key":"k%s","VersionId":"v%s"}' "$i" "$i"; done
    printf ']}\\n' ;;
  "s3api delete-objects"*)
    bucket="$(echo "$*" | sed -E 's/.*--bucket ([^ ]+).*/\\1/')"
    file="$(echo "$*" | sed -E 's/.*--delete file:\\/\\/([^ ]+).*/\\1/')"
    sent="$(grep -o '"Key"' "$file" | wc -l | tr -d ' ')"
    echo "$sent" >> "$STUB_DIR/batches"
    echo $(( $(cat "$(state "$bucket")") - sent )) > "$(state "$bucket")"
    echo "None" ;;
  *) : ;;
esac
`;

const FAKE_TERRAFORM = `#!/usr/bin/env bash
case "$*" in
  *"output -raw object_store_bucket") echo "$STUB_OBJECT_STORE" ;;
  *"output -raw platform_files_bucket") echo "$STUB_PLATFORM_FILES" ;;
  *) exit 1 ;;
esac
`;

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

interface Options {
  env?: string;
  objectStore?: string;
  platformFiles?: string;
  /** Objects in each bucket; a bucket with no entry does not exist. */
  counts?: Record<string, number>;
}

function run(options: Options = {}) {
  const objectStore = options.objectStore ?? `docbeam-dev-object-store-${ACCOUNT}`;
  const platformFiles = options.platformFiles ?? `docbeam-dev-platform-files-${ACCOUNT}`;
  const counts = options.counts ?? { [objectStore]: 0, [platformFiles]: 0 };
  const dir = mkdtempSync(join(tmpdir(), 'empty-buckets-test-'));
  dirs.push(dir);
  for (const [name, body] of [['aws', FAKE_AWS], ['terraform', FAKE_TERRAFORM]] as const) {
    writeFileSync(join(dir, name), body);
    chmodSync(join(dir, name), 0o755);
  }
  for (const [bucket, n] of Object.entries(counts)) writeFileSync(join(dir, `count-${bucket}`), String(n));
  writeFileSync(join(dir, 'batches'), '');
  const log = join(dir, 'calls.log');
  writeFileSync(log, '');
  const result = spawnSync('bash', [SCRIPT, options.env ?? 'dev'], {
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      HOME: dir,
      STUB_DIR: dir,
      STUB_LOG: log,
      STUB_ACCOUNT: ACCOUNT,
      STUB_OBJECT_STORE: objectStore,
      STUB_PLATFORM_FILES: platformFiles,
    },
  });
  const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean);
  const batches = readFileSync(join(dir, 'batches'), 'utf8').split('\n').filter(Boolean).map(Number);
  const left = (bucket: string) => Number(readFileSync(join(dir, `count-${bucket}`), 'utf8'));
  return { ...result, calls, batches, left, objectStore, platformFiles };
}

describe('scripts/empty-dev-buckets.sh (D-M2-23)', () => {
  it('refuses prod and touches nothing in AWS', () => {
    const r = run({ env: 'prod' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('prod');
    expect(r.calls).toEqual([]);
  });

  it('refuses any environment that is not dev', () => {
    const r = run({ env: 'staging' });
    expect(r.status).toBe(1);
    expect(r.calls).toEqual([]);
  });

  it('refuses the Terraform state bucket', () => {
    const r = run({ objectStore: `docbeam-tfstate-${ACCOUNT}`, counts: { [`docbeam-tfstate-${ACCOUNT}`]: 5 } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Refusing to empty');
    expect(r.calls.some((c) => c.startsWith('s3api delete-objects'))).toBe(false);
  });

  it('refuses a bucket from another account or with another prefix', () => {
    for (const name of ['docbeam-dev-object-store-999999999999', 'docbeam-prod-object-store-' + ACCOUNT, 'other-bucket']) {
      const r = run({ objectStore: name, counts: { [name]: 5 } });
      expect(r.status, name).toBe(1);
      expect(r.calls.some((c) => c.startsWith('s3api delete-objects')), name).toBe(false);
    }
  });

  it('deletes all versions and delete markers in batches of at most 1,000', () => {
    const store = `docbeam-dev-object-store-${ACCOUNT}`;
    const files = `docbeam-dev-platform-files-${ACCOUNT}`;
    const r = run({ counts: { [store]: 2_500, [files]: 40 } });
    expect(r.status, r.stderr).toBe(0);
    expect(r.batches).toEqual([1000, 1000, 500, 40]);
    expect(r.left(store)).toBe(0);
    expect(r.left(files)).toBe(0);
    expect(r.stdout).toContain('2500 versions and delete markers deleted');
  });

  it('is fine with an empty bucket and with a bucket that does not exist', () => {
    const store = `docbeam-dev-object-store-${ACCOUNT}`;
    const r = run({ counts: { [store]: 0 } });
    expect(r.status, r.stderr).toBe(0);
    expect(r.batches).toEqual([]);
    expect(r.stdout).toContain('not found, nothing to do');
  });

  it('never names the state bucket in any AWS call', () => {
    const store = `docbeam-dev-object-store-${ACCOUNT}`;
    const files = `docbeam-dev-platform-files-${ACCOUNT}`;
    const r = run({ counts: { [store]: 3, [files]: 3 } });
    expect(r.calls.filter((c) => c.includes('tfstate'))).toEqual([]);
  });
});
