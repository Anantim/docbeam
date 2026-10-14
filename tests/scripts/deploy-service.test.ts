import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// scripts/deploy-service.sh with a fake `aws` on the PATH. The fake logs every call and answers from
// STUB_* variables, so the test shows which calls the script makes in each path (D-M1-15).
const SCRIPT = new URL('../../scripts/deploy-service.sh', import.meta.url).pathname;
const IMAGE = '346208529537.dkr.ecr.ap-southeast-2.amazonaws.com/docbeam-dev/auth:abc123';

const FAKE_AWS = `#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG"
args="$*"
case "$args" in
  "ecs describe-services"*"networkConfiguration"*) echo '{"awsvpcConfiguration":{"subnets":["s-1"],"securityGroups":["sg-1"]}}' ;;
  "ecs describe-services"*"taskDefinition"*) echo "arn:aws:ecs:ap-southeast-2:1:task-definition/docbeam-dev-auth:7" ;;
  "ecs describe-task-definition"*"--include TAGS"*)
    if [ "$STUB_MARKED" = "1" ]; then tags='[{"key":"deployed-by","value":"deploy-service.sh"}]'; else tags='[]'; fi
    echo "{\\"taskDefinition\\":{\\"containerDefinitions\\":[{\\"image\\":\\"$STUB_RUNNING_IMAGE\\"}]},\\"tags\\":$tags}" ;;
  "ecs describe-task-definition"*"-seed"*) exit 254 ;;
  "ecs describe-task-definition"*) echo '{"family":"f","taskDefinitionArn":"x","revision":1,"containerDefinitions":[{"name":"app","image":"old"}]}' ;;
  "ecs register-task-definition"*) echo "arn:aws:ecs:ap-southeast-2:1:task-definition/new:8" ;;
  "ecs run-task"*) echo "arn:aws:ecs:ap-southeast-2:1:task/c/t1" ;;
  "ecs describe-tasks"*) echo "0" ;;
  *) : ;;
esac
`;

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function run(opts: { running: string; marked: boolean; args?: string[]; env?: Record<string, string> }) {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-test-'));
  dirs.push(dir);
  const fake = join(dir, 'aws');
  writeFileSync(fake, FAKE_AWS);
  chmodSync(fake, 0o755);
  const log = join(dir, 'calls.log');
  writeFileSync(log, '');
  const result = spawnSync('bash', [SCRIPT, 'dev', 'auth', IMAGE, ...(opts.args ?? [])], {
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      HOME: dir,
      STUB_LOG: log,
      STUB_RUNNING_IMAGE: opts.running,
      STUB_MARKED: opts.marked ? '1' : '0',
      ...opts.env,
    },
  });
  const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean);
  const did = (sub: string) => calls.some((c) => c.startsWith(`ecs ${sub}`));
  return { ...result, calls, did };
}

describe('scripts/deploy-service.sh is safe to run twice (D-M1-15)', () => {
  it('skips migrate, seed and update when the service already runs the image from this script', () => {
    const r = run({ running: IMAGE, marked: true });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('already runs');
    expect(r.did('register-task-definition')).toBe(false);
    expect(r.did('run-task')).toBe(false);
    expect(r.did('update-service')).toBe(false);
  });

  it('deploys when the service runs another image', () => {
    const r = run({ running: IMAGE.replace('abc123', 'old999'), marked: true });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Running migrations for auth');
    expect(r.did('run-task')).toBe(true);
    expect(r.did('update-service')).toBe(true);
    const registered = r.calls.find((c) => c.startsWith('ecs register-task-definition'));
    expect(registered).toContain('key=deployed-by,value=deploy-service.sh');
  });

  it('deploys on the first run of an environment: same image from Terraform, no marker', () => {
    const r = run({ running: IMAGE, marked: false });
    expect(r.status).toBe(0);
    expect(r.did('run-task')).toBe(true);
    expect(r.did('update-service')).toBe(true);
  });

  it('deploys with --force even when the image already runs', () => {
    const r = run({ running: IMAGE, marked: true, args: ['--force'] });
    expect(r.status).toBe(0);
    expect(r.did('update-service')).toBe(true);
    expect(r.did('describe-task-definition') && r.calls.some((c) => c.includes('--include TAGS'))).toBe(false);
  });

  it('deploys with FORCE_DEPLOY=true (the workflow input)', () => {
    const r = run({ running: IMAGE, marked: true, env: { FORCE_DEPLOY: 'true' } });
    expect(r.status).toBe(0);
    expect(r.did('update-service')).toBe(true);
  });

  it('treats FORCE_DEPLOY=false as no force', () => {
    const r = run({ running: IMAGE, marked: true, env: { FORCE_DEPLOY: 'false' } });
    expect(r.stdout).toContain('already runs');
    expect(r.did('update-service')).toBe(false);
  });
});
