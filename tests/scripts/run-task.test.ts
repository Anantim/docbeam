import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// scripts/run-task.sh with a fake `aws`: which task definition does it run (D-M2-1)?
const SCRIPT = new URL('../../scripts/run-task.sh', import.meta.url).pathname;
const ARN = (family: string, rev: number) => `arn:aws:ecs:ap-southeast-2:1:task-definition/${family}:${rev}`;

// STUB_MARKED is a comma-separated list of revisions that carry the marker. The listing is newest first and also
// holds a family with the same prefix, which must never be picked.
const FAKE_AWS = `#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG"
case "$*" in
  "ecs list-task-definitions"*)
    printf '%s\\t' "arn:aws:ecs:ap-southeast-2:1:task-definition/docbeam-dev-platform-migrate:9" \\
      "arn:aws:ecs:ap-southeast-2:1:task-definition/docbeam-dev-platform:12" \\
      "arn:aws:ecs:ap-southeast-2:1:task-definition/docbeam-dev-platform:11" \\
      "arn:aws:ecs:ap-southeast-2:1:task-definition/docbeam-dev-platform:10" ;;
  "ecs describe-task-definition"*"--include TAGS"*)
    rev="$(echo "$*" | sed -E 's/.*:([0-9]+) --include.*/\\1/')"
    case ",$STUB_MARKED," in *",$rev,"*) echo "deploy-service.sh" ;; *) echo "None" ;; esac ;;
  "ecs describe-services"*) echo '{"awsvpcConfiguration":{"subnets":["s-1"],"securityGroups":["sg-1"]}}' ;;
  "ecs run-task"*) echo "arn:aws:ecs:ap-southeast-2:1:task/c/t1" ;;
  "ecs describe-tasks"*) echo "0" ;;
  *) : ;;
esac
`;

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function run(task: string, marked: string, service = 'platform') {
  const dir = mkdtempSync(join(tmpdir(), 'run-task-test-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'aws'), FAKE_AWS);
  chmodSync(join(dir, 'aws'), 0o755);
  const log = join(dir, 'calls.log');
  writeFileSync(log, '');
  const result = spawnSync('bash', [SCRIPT, 'dev', service, task], {
    encoding: 'utf8',
    env: { PATH: `${dir}:${process.env.PATH}`, HOME: dir, STUB_LOG: log, STUB_MARKED: marked },
  });
  const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean);
  const runCall = calls.find((c) => c.startsWith('ecs run-task'));
  return { ...result, calls, runCall };
}

describe('scripts/run-task.sh runs only marked revisions (D-M2-1)', () => {
  it('runs the newest revision that deploy-service.sh registered, skipping newer Terraform revisions', () => {
    const r = run('service', '10');
    expect(r.status).toBe(0);
    expect(r.runCall).toContain(`--task-definition ${ARN('docbeam-dev-platform', 10)}`);
  });

  it('prefers the newest marked revision when several are marked', () => {
    const r = run('service', '10,11');
    expect(r.runCall).toContain(`--task-definition ${ARN('docbeam-dev-platform', 11)}`);
  });

  it('never picks a revision of another family with the same prefix', () => {
    // Revision 9 belongs to docbeam-dev-platform-migrate and is marked, but the service family is asked for.
    const r = run('service', '9');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('deploy-service.sh');
    expect(r.runCall).toBeUndefined();
  });

  it('stops with a message when no revision is marked', () => {
    const r = run('service', '');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Run scripts/deploy-service.sh dev platform');
    expect(r.runCall).toBeUndefined();
  });

  it('applies the same rule to migrate and seed', () => {
    const r = run('migrate', '');
    expect(r.status).toBe(1);
    expect(r.runCall).toBeUndefined();
  });

  it('runs the latest revision of a family deploy-service.sh does not manage (signing-key)', () => {
    const r = run('signing-key', '', 'auth');
    expect(r.status).toBe(0);
    expect(r.runCall).toContain('--task-definition docbeam-dev-auth-signing-key');
    expect(r.calls.some((c) => c.startsWith('ecs list-task-definitions'))).toBe(false);
  });
});
