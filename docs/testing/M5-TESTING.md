# M5 testing: Hardening and end-to-end checks

Each line is a command or a click and the result to expect. M5 runs on dev without RDS Proxy (D-M5-1); prod is never deployed. The checks are scripts, so each can be run again. Evidence goes to `docs/testing/M5-RESULTS.md` and `docs/testing/m5-evidence/`.

## 1. Local

### 1.1 Start the stack

```bash
scripts/local-env.sh
docker compose up -d --build --wait      # every container healthy
docker compose run --rm seed             # demo and load teams; safe to repeat
```

### 1.2 Run the tests

| # | Command | Expect |
|---|---|---|
| 1 | `npm run lint && npm run typecheck` | No output errors |
| 2 | `npm test` | All unit and web tests pass (75 files, 573 tests at the end of M5 part A) |
| 3 | `npm run build` | Builds; `workers/*/dist/lambda/rds-ca-bundle.pem` exists for the five Lambdas and Upload Events |
| 4 | `npm run test:integration` | 18 files, 169 tests pass. `downloads.test.ts` "accepts a POST with no body…" proves the 415 fix |
| 5 | `npm run test:e2e` | The local Playwright specs pass (the dev-only specs skip) |
| 6 | `terraform fmt -check -recursive infra`; `terraform -chdir=infra/envs/dev validate`; same for `prod` | `Success! The configuration is valid.` |
| 7 | `scripts/check-public.sh` | `PASS check-public`: gitleaks over every commit on every branch and over the files on disk, no `.env`, key or state file ever added, no private key text, no email address except example and noreply ones |
| 8 | Seed variant: `docker compose run --rm -e SEED_FILES=demo.json,dev-load-m5-removed.json seed`, then the same with `dev-load.json` | `membersRemoved":1`, then `membersAdded":1` |

### 1.3 Browser checks (done by Playwright on dev, section 3.4)

The manual checks of the TDD (slow connection, multipart resume, WebSocket reconnect, PNG and JPG preview) are run in a real Chromium by `tests/e2e/m5-browser-dev.spec.ts`, so no person has to click. To do them by hand instead, on dev as Priya (`priya.shah@example.com`; the seed password is in Secrets Manager `docbeam-dev/seed/user-password`):

1. **Slow connection.** Chrome DevTools, Network tab, throttling "Slow 3G". Distribute, Choose files, a 2 MB PDF. Expect "Uploading nn%" for about 30 s or more, then "Checking for malware", then "Verified". Tick a folder, Send. Expect the delivery to end Delivered.
2. **Multipart resume.** A 120 MB PDF (any file above 100 MiB). Choose it; wait for "Uploading parts 2/8" or later. DevTools Network, "Offline". Expect "Upload interrupted" within a minute. After 20 s set Online and click the circular Retry button on the row. Expect "Uploading parts" to carry on from the parts already stored (not from 0/8), then "Verified", with no reload of the page.
3. **WebSocket reconnect.** Open a running distribution (run `scripts/demo-send.sh` first and open the address it prints, as `load.user@example.com`). Set DevTools to "Offline" for 30 s. Expect the counts to stop moving. Set Online. Expect the counts to jump to the real numbers within a few seconds and then keep moving, without a reload.
4. **PNG and JPG preview.** Send a PNG and a JPG to a Cardio folder. On the Status page click Preview on each. Expect the image in the page.

## 2. Deploy to dev on AWS

Follow `docs/RUNBOOK-first-bring-up.md` sections 0 to 7 exactly. This is the proof of the runbook (D-M5-3): dev starts from an empty state (`terraform state list` prints nothing, no `docbeam-dev` cluster).

| # | Command | Expect |
|---|---|---|
| 1 | Runbook 0: `aws ecs list-clusters`; `terraform -chdir=infra/envs/dev state list` | No cluster; nothing in the state |
| 2 | Runbook 1 and 2 | Repositories; five images pushed under `$IMAGE_TAG` |
| 3 | Runbook 3 | `Apply complete!` (about 280 added) |
| 4 | Runbook 4 | `exit code: 0` twice; the bootstrap log has no certificate error |
| 5 | Runbook 5 | Three `Deployed …`; three `200` |
| 6 | Runbook 6 | Five `Deployed`, Upload Events skipped |
| 7 | Runbook 7 | `Apply complete!`, `Deployed to https://….cloudfront.net`, `No changes.` |

## 3. Verify on dev

Set `APP=$(terraform -chdir=infra/envs/dev output -raw app_url)` and, for the Playwright run, `DEV_APP_URL=$APP DEV_SEED_PASSWORD=<read from Secrets Manager, never typed into a file>`. The driver reads the password itself from Secrets Manager.

### 3.1 Database TLS (chain checked)

| # | Command | Expect |
|---|---|---|
| 1 | `scripts/check-internal.sh dev` | Three `200` lines. The services connect with `sslmode=verify-full` |
| 2 | `scripts/run-task.sh dev docbeam-api service node --input-type=module -e "import pg from 'pg'; import { withDatabaseUrl } from '@docbeam/shared'; const p = new pg.Pool({ connectionString: withDatabaseUrl(process.env).DATABASE_URL, max: 1 }); const r = await p.query('SELECT ssl, version FROM pg_stat_ssl WHERE pid = pg_backend_pid()'); console.log(JSON.stringify(r.rows)); await p.end();"` | `[{"ssl":true,…}]` |
| 3 | The same with `DB_CA_FILE=/etc/hostname` in front of `node`, using `sh -c` | The connection fails with a certificate error (negative proof) |
| 4 | Lambdas: `aws lambda get-function-configuration --function-name docbeam-dev-delivery --query 'Environment.Variables.DB_CA_FILE'` | `/var/task/rds-ca-bundle.pem`; the Delivery logs show no connection error |

### 3.2 The checks (scripts)

Run alone and in this order: `scripts/m5-all.sh` (or one by one). Each prints `PASS` or `FAIL` lines; outputs are kept in `docs/testing/m5-evidence/`.

| # | TDD check | Script | Changes AWS | Expect |
|---|---|---|---|---|
| 5.12 | Security | `scripts/m5-security.sh` | no (a throwaway job) | 401 on every protected route with the load balancer's RequestCount at 0; a POST with no body works (cancel, retry, download link) through CloudFront; cross-team 404; a link refused after 2 minutes; bucket without a link 403 |
| 5.7 | Team viewer | `scripts/m5-team-viewer.sh` | no | Raj sees only Cardio rows and audit events; 404 for the Oncology-only file; Sam sees nothing |
| 5.5 | Browse | `scripts/m5-browse-timing.sh` | no | 50 teams; p99 under 1000 ms, client side and in the gateway log |
| 5.9 | EICAR | `scripts/m5-eicar.sh` | no | infected; submit refused; object deleted; download 404 |
| 5.4 | File checks | `scripts/m5-file-checks.sh --yes` | pauses the Delivery trigger, deletes one object | 422 FILE_NOT_READY and nothing created; only the removed file's 3 tasks fail FILE_NOT_UPLOADED |
| 5.1 | Submit speed | `scripts/m5-submit-load.sh` | no | 100 jobs accepted; server-side p99 under 500 ms |
| 5.10 | Cancel | `scripts/m5-cancel.sh` | no | 202; waiting tasks cancelled; running tasks finish; the job reads cancelled |
| 5.2 | Removed member | `scripts/m5-removed-member.sh --yes` | pauses the Delivery trigger, runs the seed variant | 100 NOT_AUTHORIZED_AT_DELIVERY, 1,900 completed |
| 5.3 | Platform outage | `scripts/m5-platform-outage.sh --yes` | scales the platform to 0 for 5 minutes | 2,000 of 2,000 completed once, the DLQs 0 |
| 5.13 | Lost job message | `scripts/m5-sweeper.sh --yes` | pauses the Fan-out trigger, purges the Job Queue | fan-out starts within 3 minutes |
| 5.6 | 1 GiB multipart | `scripts/m5-multipart-1gb.sh` | no | stored combined checksum `…-64`; scanned clean; delivered; the platform document has the same SHA-256 |
| 5.11 | Auth | `scripts/m5-auth.sh` | no | reuse of a refresh token ends the sign-in; 5 wrong passwords pause for 15 minutes |
| 5.8 | Failover | `scripts/m5-failover.sh --yes` | Multi-AZ on, reboot with failover, Multi-AZ off | deliveries pause, then all 2,000 complete; dev is Single-AZ again |

Then: `scripts/m5-failure-rate.sh 1` (the failure rate: system failures over all tasks) and `scripts/m5-server-metrics.sh --since=<start of the checks>` (server-side latency per route).

### 3.3 Console checks (Sydney, read only)

| # | Where | Expect |
|---|---|---|
| 1 | CloudWatch, Logs Insights, log group `/docbeam/docbeam-dev/api-gateway`: `filter routeKey = 'POST /jobs' \| stats pct(latency, 99)` | The p99 the script printed |
| 2 | CloudWatch, Alarms | The four `docbeam-dev` alarms are `OK` after the checks |
| 3 | SQS | The three DLQs hold 0 messages |
| 4 | RDS, `docbeam-dev-postgres` | Single-AZ, Available; the event list shows the failover and the Multi-AZ changes |
| 5 | ECS, `docbeam-dev-platform` | 1 running task |

### 3.4 Browser checks by Playwright

```bash
export DEV_APP_URL=$APP DEV_SEED_PASSWORD=$(aws secretsmanager get-secret-value --secret-id docbeam-dev/seed/user-password --query SecretString --output text --region ap-southeast-2)
npm run test:e2e:dev -- m5-browser-dev
```

Expect 4 passed: slow connection, multipart resume (the same upload carries on after the network drop), PNG and JPG preview, WebSocket reconnect (the counts freeze offline and catch up). Screenshots in `docs/testing/m5-evidence/`.

## 4. Prod (not deployed in this project)

If prod is ever deployed (Paid plan, `deploy-prod` from `main`, runbook section 9): `scripts/m5-*.sh` are dev-only; for prod run the read-only checks by hand: the workflows are green, `POST /jobs` p99 from the gateway log, the three DLQs at 0, the four alarms `OK`, RDS Multi-AZ and the proxy `available`.

## 5. Tear down

If every check is YES, dev stays up for the demo recording (`docs/DEMO-SCRIPT.md`). Otherwise, or after the recording:

```bash
scripts/empty-dev-buckets.sh dev --dry-run
scripts/empty-dev-buckets.sh dev
terraform -chdir=infra/envs/dev destroy -auto-approve $TFVARS      # same -var values as apply
terraform -chdir=infra/envs/dev state list                          # prints nothing
aws s3 ls                                                           # only docbeam-tfstate-346208529537
```
