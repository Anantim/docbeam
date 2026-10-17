# M5 results

Run on 2026-10-17, unattended (D-M5-0), against a dev built from nothing with `docs/RUNBOOK-first-bring-up.md`. All times UTC. The raw output of every check is in `docs/testing/m5-evidence/` (`summary.txt` lists every run, including the failed ones). Decisions and fixes found on the way: `docs/DECISIONS.md` D-M5-0 to D-M5-13.

**Verdict: M5 FAILS on one item: check 5.1 (submit speed) is a NO.** Everything else on the list is YES, with evidence below. Sections: 1 Local, 2 Bring-up, 3 The checks, 4 YES/NO, 5 What the runs found, 6 Limits, 7 Tear down.

## 1. Local

| Step | Command | Result |
|---|---|---|
| Lint, types, build | `npm run lint`, `npm run typecheck`, `npm run build` | all exit 0 |
| Unit and web | `npm test` | 76 files, 577 tests passed |
| Integration (Compose, LocalStack, real ClamAV) | `npm run test:integration` | **169 tests in 18 files.** Full round on 2026-10-17 (during the M5 run): **168 passed, 1 failed** — `web-upload.test.ts` hit its 120 s timeout while the same laptop was running the load check (CPU and network shared); run alone it passed in 22.8 s. Full round on 2026-10-18 after the timing and sweeper changes: first run 168 of 169 (`ingest.test.ts` "stores one document for two parallel repeats": it listed `documents/` and read one page of 1,000 object versions, and the local bucket keeps every earlier run's objects, so the winner's key could fall off the page; not proven, but the test now lists only its own key), second run **169 of 169**, and `ingest.test.ts` alone three times 11 of 11 |
| Unit and web, 2026-10-18 | `npm test` | 77 files, 583 tests passed |
| Browser, local | `npm run test:e2e` | 49 passed (6.7 min) |
| Terraform | `terraform fmt -check -recursive infra`; `validate` dev and prod | clean |
| Public check | `scripts/check-public.sh` | PASS: gitleaks over 139+ commits on every branch and over the files on disk; no `.env`, key, state or tfvars file ever added; no private key block; no email address except example and noreply ones (the older author address is accepted, D-M5-2, and mapped by `.mailmap`) |
| Seed variant | `docker compose run --rm -e SEED_FILES=demo.json,dev-load-m5-removed.json seed`, then `dev-load.json` | `membersRemoved":1`, then `membersAdded":1` |
| New tests | `db-url.test.ts`, `errors.test.ts` (empty bodies), `downloads.test.ts` "accepts a POST with no body…" (red without the fix: the chunked case got 415), `sql.test.ts`, `db.test.ts` (pool timeouts), `failure-rate.test.ts` | pass |

## 2. Bring-up from nothing (proves the runbook)

| Step | Result |
|---|---|
| Start | 09:21 UTC: `terraform state list` empty, no `docbeam-dev` cluster, only the state bucket in S3 |
| Runbook 1 and 2 | repositories created; five images pushed (the first round of pushes took about 30 minutes from a home connection) |
| Runbook 3 | `Apply complete! Resources: 247 added, 0 changed, 0 destroyed.` at 10:22 |
| Runbook 4 | the bootstrap task failed twice with `could not read root certificate file … Permission denied` (the RDS bundle was mode 0600 in the image). Fixed in the Dockerfiles (D-M5-4); on the third image the task ended `bootstrap finished`, exit 0, with `PGSSLMODE=verify-full` |
| Runbook 5 | `deploy-service.sh` for the three services: migrations, seed, update: exit 0; `check-internal.sh` three `200` |
| Runbook 6 | five Lambdas `Deployed the new code`, Upload Events on its image |
| Runbook 7 | `Apply complete! Resources: 26 added, 0 changed, 8 destroyed.`, web deployed, `terraform plan` `No changes.`, site `200`, `/api/teams` without a token `401` — at 11:08, 107 minutes after the start (about 60 minutes of it image pushes and the two failed bootstraps) |
| Alarm email | not confirmed (the person's instruction); alarm states are read in CloudWatch |
| Runbook edits | the plan and apply counts, the timing and the certificate finding |

**Database TLS (D-M5-4), `m5-evidence/tls.txt`:** a one-off task with `withDatabaseUrl` reports `ssl: true`, TLSv1.3. With `DB_CA_FILE=/etc/hostname` it fails with `self-signed certificate in certificate chain`; with no `DB_CA_FILE` it refuses to start. Migrations, seed and every Lambda ran over `verify-full`.

## 3. The checks on dev

| # | Check | Script | Result | Evidence |
|---|---|---|---|---|
| 5.1 | 100 x 20 accepted in under 500 ms at p99 | `m5-submit-load.sh` | **NO.** Four full runs: p99 749, 712, 992, 808 ms (gateway `responseLatency`, 100 requests, Logs Insights). Median 32 ms. | `submit-load.txt`, D-M5-10, D-M5-11 |
| 5.2 | member removed from 1 of 20 teams | `m5-removed-member.sh` | **YES.** All 2,000 pending with Delivery paused; seed variant removed 1 membership; **100 failed NOT_AUTHORIZED_AT_DELIVERY, all `Load Team 20 / Regulatory`; 1,900 completed**; seed restored | `removed-member.txt` |
| 5.3 | platform stopped 5 min mid-run | `m5-platform-outage.sh` | **YES** (second version; the first let all 2,000 finish in 20 s before the stop). Stopped at 177 delivered; after 5.0 min 826 done, 1,174 waiting; **3,522 temporary delivery errors; 2,000 of 2,000 completed, 2,000 distinct tasks; Task DLQ and Job DLQ max 0** (CloudWatch); four alarms `OK` | `platform-outage.txt` |
| 5.4 | FILE_NOT_READY; removed file | `m5-file-checks.sh` | **YES** after D-M5-8 and D-M5-9. Never-uploaded file: 422 FILE_NOT_READY, 2 jobs before and after. Object deleted after submit: its 3 tasks `FILE_NOT_UPLOADED`, the other file's 3 completed | `file-checks.txt` |
| 5.5 | browse under 1 s, 50 teams | `m5-browse-timing.sh` | **YES.** 50 teams; GET /teams p50 272 ms, **p99 784 ms from the laptop over the internet** (100 runs); at the gateway p99 44 ms, binders p99 13 ms | `browse.txt` |
| 5.6 | 1 GiB multipart | `m5-multipart-1gb.sh` | **YES** after D-M5-12. 64 parts uploaded in 54 s, scanned clean in 95 s, stored checksum `…=-64`, delivered in 36.9 s; the platform document has the same SHA-256 and size as the local file (`c9ea3d6a…f51e`, 1,073,741,824 bytes) | `multipart-1gb.txt` |
| 5.7 | team viewer | `m5-team-viewer.sh` | **YES.** Raj sees 1 task (Cardio), counts for his team only, 404 for the Oncology-only job and file (download and preview), 3 audit events none for other teams; Sam 404, 0 audit events, 404; no token 401 | `team-viewer.txt` |
| 5.8 | database failover | `m5-failover.sh` | **YES** after D-M5-13 (see section 5). Failover 20 s; **2,000 of 2,000 completed, 0 RETRIES_EXHAUSTED, 2,000 documents with 2,000 distinct task ids; DLQs 0**; back to Single-AZ. The free plan accepted Multi-AZ | `failover.txt`, `failover-run1.txt` |
| 5.9 | EICAR | `m5-eicar.sh` | **YES.** infected; submit 422 FILE_NOT_READY; object gone; download 404; `file.refused` audit event | `eicar.txt` |
| 5.10 | cancel mid-run | `m5-cancel.sh` | **YES.** Cancel (no body) 202 `{"cancelled":1720}`; 280 completed before and after; 1,720 CANCELLED; status `cancelled`; final a minute later; 0 real failures | `cancel.txt` |
| 5.11 | refresh reuse; 5 wrong passwords | `m5-auth.sh` | **YES.** Cookie `Path=/api/auth; HttpOnly; Secure; SameSite=Strict`; refresh 200; old cookie 401; newer cookie 401; 5 wrong 401; right password 401 during the pause; **200 after 15 minutes** | `auth.txt` |
| 5.12 | security | `m5-security.sh`, `check-public.sh` | **YES.** 27 no-token calls 401, CloudWatch counts 27 4xx and 0 integration samples (the load balancer's request count was 0); `curl -X POST` with no body: cancel 202, retry refused (not 415), download link 201; cross-team download and preview 404; link 200 then **403 after 2 minutes**; bucket without a link 403; gitleaks clean | `security.txt` |
| 5.13 | lost job message | `m5-sweeper.sh` | **YES, narrowly: 179 s** against a limit of 180. Nothing else queued or running first; fan-out disabled, job queue purged, trigger enabled | `sweeper.txt` |
| 5.14 | browser: slow connection, multipart resume, WebSocket, PNG and JPG | `npm run test:e2e:dev -- m5-browser-dev` (Playwright, Chromium, on dev; the person was away, so the manual steps were driven by the test, D-M5-0) | **YES**, all four passed, but over three runs while the test was being corrected (the test, not the app, was wrong each time: `browser-run1.txt`, `-run2`, `-run3`, `browser.txt`, `browser-4.txt`). **Slow connection:** 2 MiB at about 64 KiB/s (DevTools-style limit), "Uploading", then Verified in 51 s, sent and Delivered. **Multipart resume:** a 120 MiB file (8 parts), network taken offline after part 2, "Upload interrupted" shown, back online after 20 s, Retry on the same row: it carried on at part 2 (not 0) and reached Verified, the page was never reloaded (marker kept), then delivered. **PNG and JPG preview:** two images drawn by the browser (240 x 160), sent to Cardio, Preview opened each in the page and the browser decoded both at 240 x 160. **WebSocket reconnect:** 2,000-delivery run as the load user; 498 delivered on screen, 30 s offline: the page shows "The distribution could not be loaded" instead of the counts while the server went on to 1,588; back online it caught up to the server and followed the run to 2,000 with no reload | `browser*.txt`, `m5-evidence/*.png` |

Failure rate (`m5-failure-rate.sh`, `failure-rate.txt`): over the whole bring-up 24,398 non-cancelled tasks: 23,442 completed, **853 RETRIES_EXHAUSTED (3.5%) — all from the first failover run, before the pool fix**, 100 NOT_AUTHORIZED_AT_DELIVERY and 3 FILE_NOT_UPLOADED (user and access failures, counted apart), 63,627 cancelled (left out). Since the fixes were deployed (16:10): 12,872 of 12,872 completed, **system failure rate 0%**.

## 4. YES/NO against the prompt and the TDD M5 list

| Requirement | | Evidence |
|---|---|---|
| TDD: 100 x 20 job accepted in under 500 ms at p99 | **NO** (808 ms; section 5) | `m5-evidence/submit-load.txt` |
| TDD: removing the sender from one team: 100 NOT_AUTHORIZED_AT_DELIVERY, 1,900 complete | YES (5.2) | `m5-evidence/removed-member.txt` |
| TDD: platform stopped 5 minutes, backlog drains, DLQ empty | YES (5.3) | `m5-evidence/platform-outage.txt` |
| TDD: FILE_NOT_READY, FILE_NOT_UPLOADED | YES (5.4) | `m5-evidence/file-checks.txt` |
| TDD: browsing under 1 s for a user in 50 teams | YES (5.5) | `m5-evidence/browse.txt` |
| TDD: 1 GB multipart, combined checksum, matching SHA-256 | YES (5.6) | `m5-evidence/multipart-1gb.txt` |
| TDD: team viewer sees only their team, 404 otherwise | YES (5.7) | `m5-evidence/team-viewer.txt` |
| TDD: failover during a run, nothing lost | YES (5.8) | `m5-evidence/failover.txt` |
| TDD: EICAR refused, never downloadable | YES (5.9) | `m5-evidence/eicar.txt` |
| TDD: cancel mid-run | YES (5.10) | `m5-evidence/cancel.txt` |
| TDD: refresh reuse; 5 wrong passwords | YES (5.11) | `m5-evidence/auth.txt` |
| TDD: security (401, cross-team 404, expired links, gitleaks) and a POST with no body works through CloudFront | YES (5.12, D-M5-5) | `m5-evidence/security.txt` |
| TDD: dropped job message, sweeper within 3 minutes | YES, 179 s (5.13); to be re-run after D-M5-15 | `m5-evidence/sweeper.txt` |
| TDD: manual checks (slow connection, multipart resume, WebSocket reconnect, PNG and JPG preview) | YES, run in a real browser by Playwright (5.14). A person has not clicked through them; the steps are in `M5-TESTING.md` 1.3 | `m5-evidence/browser.txt`, `browser-4.txt`, `*.png` |
| Prompt: `scripts/m5-submit-load.sh` and the other scripts, re-runnable | YES (`scripts/m5-*.sh`, `m5-all.sh`, `scripts/m5/`) | command: `ls scripts/m5-*.sh scripts/m5/` |
| Prompt: every check run on dev with evidence; failures fixed and re-run | YES, except 5.1, which was re-run three times and is recorded as NO (D-M5-11) | `m5-evidence/summary.txt` (every run, with exit codes) |
| Prompt: `M5-TESTING.md`, `M5-RESULTS.md` | YES | the two files in `docs/testing/` |
| Prompt: `docs/RUNBOOK-first-bring-up.md`, proved by building dev from nothing | YES (section 2) | section 2 above; the 247 + 26 apply counts are in the runbook; `m5-evidence/teardown.txt` for the destroy |
| Prompt: database TLS checking the chain, D-M1-10 | YES (D-M5-4, `tls.txt`) | `m5-evidence/tls.txt` |
| Prompt: README for a first-time visitor | YES (`README.md`) | file `README.md` |
| Prompt: `docs/DEMO-SCRIPT.md` with bring-up and teardown commands | YES, with `scripts/demo-files.sh`, `demo-send.sh`, `demo-outage.sh` | files `docs/DEMO-SCRIPT.md`, `scripts/demo-*.sh` |
| Prompt: repository safe to make public (gitleaks over history, no `.env` or keys, no real emails) | YES (`scripts/check-public.sh`) | command: `scripts/check-public.sh` (PASS, section 1) |
| Prompt: STATUS release summary | YES | `docs/STATUS.md`, section "M5 (Hardening…): release summary" |
| Prompt: D-M5-1 recorded first | YES | `docs/DECISIONS.md` line 669 (D-M5-1, the first M5 entry) |
| Delivery failure rate: no system failures after the fixes | **YES**: 0% over 12,872 tasks after the fixes (deployed 16:10 UTC). The 853 RETRIES_EXHAUSTED (3.5% of 24,398) came from the first failover run, before D-M5-13: that run is how the pool bug was found | `m5-evidence/failure-rate.txt`, `failover-run1.txt`; command `scripts/m5-failure-rate.sh` |
| Prompt: do not deploy prod | YES, never touched | command: `aws s3 ls s3://docbeam-tfstate-346208529537/ --recursive` lists only `envs/dev/terraform.tfstate` (no `envs/prod`), checked 2026-10-18 |

**One NO means the milestone fails** (AGENTS.md). M5 is reported as FAILED on 5.1, with the reason below.

## 5. What the runs found

Each was found only on AWS; none could be seen on Compose.

| Finding | Evidence | Fix |
|---|---|---|
| The RDS bundle in the images was unreadable by the non-root user | two failed bootstrap and migrate runs | D-M5-4 |
| `HEAD` of a deleted object gave 403, not 404 (the Delivery role could not list the bucket), so a removed file looped to RETRIES_EXHAUSTED | `Unknown: UnknownError`, 3 tasks stuck pending for 7 minutes | D-M5-8: `s3:ListBucket` |
| "Paused" trigger kept delivering for about a minute | 6 deliveries ran after `Disabled` | D-M5-9: wait 120 s, assert nothing started |
| `POST /jobs` of 2,000 tasks took 0.8 to 1.6 s: 10,000 bound parameters | timing log: tasks insert 0.8 to 1.3 s, rest under 130 ms | D-M5-10 (one parameter per array, checks run together): handler time now 0.1 to 0.8 s |
| 1 GiB delivery used all 1,024 MB and hit the 120 s timeout (twice) | `Status: timeout` | D-M5-12: 3,008 MB, 36.9 s |
| After a failover the Platform answered 500 for more than 10 minutes: pooled connections dead and silent | 853 RETRIES_EXHAUSTED; 1,089 errors in 3 minutes at 15:47 | D-M5-13: `query_timeout`, TCP keep-alive; the same drill then recovered in 15 s |
| Cancel, retry, download and refresh through CloudFront with no body got 415 | integration test red before the fix | D-M5-5 |

**Why 5.1 is a NO.** The median submission is 32 ms, but the five 100 x 20 submissions take 0.35 to 1.6 s at the gateway in every run, so p99 over 100 requests is 712 to 992 ms. The gateway's integration latency is within 2 ms of its latency, so the time is in the DocBeam API task. Its own phase timer shows 150 to 800 ms for those requests and starts after the token check and the body parse, so up to about 800 ms is spent before the handler. That part was not traced (stop rule). Next steps, not done: log `reply.elapsedTime` at the start of the handler, try 1 vCPU for the DocBeam API (it has 0.5 vCPU), and measure from inside AWS. Prod would run the API with two tasks and a larger database, which may or may not be enough.

**The 523 s in the failover drill** is the quiet tail after the run (stragglers on the retry gaps and one message that waited the queue's 720 s visibility timeout), not a stop of the system: 1,992 of 2,000 were delivered within 90 s. The full account is in `failover.txt`.

## 6. Limits found

- Free plan: Multi-AZ was accepted (the drill ran). RDS Proxy stays off (D-M5-1).
- ClamAV scans about 15 s per file and Upload Events runs 10 at a time: 100 files take 2.5 minutes, 775 files 20 minutes.
- Delivery of a 1 GiB file needs 3,008 MB (D-M5-12). Delivery of 2,000 small files takes 20 seconds, 2,000 files of 1 MiB about 2 to 4 minutes.
- After a database failover a message can wait up to 12 minutes (visibility timeout). Nothing is lost.
- The dev database is a `db.t4g.micro` with 100 connections; 50 Delivery copies used 68 and 45% CPU.
- The SNS alarm email was not confirmed.

## 7. Tear down

A check is NO, so dev was not kept up. 18:16 UTC: `scripts/empty-dev-buckets.sh dev --dry-run` named exactly `docbeam-dev-object-store-346208529537` (6,667 versions) and `docbeam-dev-platform-files-346208529537` (27,511 versions); the real run emptied both. Then `terraform -chdir=infra/envs/dev destroy`: `Destroy complete! Resources: 275 destroyed.` (18:49). Afterwards: `terraform state list` empty; `aws s3 ls` shows only `docbeam-tfstate-346208529537`; zero ECS clusters, RDS instances, NAT gateways, load balancers, Lambda functions, ECR repositories, CloudFront distributions and secrets. The database was Single-AZ before the teardown (`MultiAZ False`).

## 8. Check 5.1 diagnosis (second dev bring-up, 2026-10-17 evening UTC)

Dev was brought up again with the runbook (301 resources, then 18, `No changes.`). All times UTC. Evidence: `m5-evidence/submit-diag-*`, `submit-5.1-run2*`, `rds-credits.json`. The mix is the one named for this session: 10 jobs of 100 x 20 and 90 of 1 x 20 (`--plan=100:10,1:90`); the 4 earlier runs used 5, 20 and 75 jobs of 100, 10 and 1 files.

**All runs of 5.1 side by side (gateway `responseLatency`, 100 requests, Logs Insights):**

| Run | When | Code | Delivery | p99 | max | Result |
|---|---|---|---|---|---|---|
| Y1 | Oct 17 about 13:10 | before D-M5-10 (10,000 parameters) | running | 749 | not kept | NO |
| Y2 | 14:02 to 14:24 | D-M5-10, before D-M5-13 | running | 712 | 712 | NO |
| Y3 | 16:49 to 17:13 | plus D-M5-13 | running, laptop also busy | 992 | 1,152 | NO |
| Y4 | 17:23 to 17:47 | same | running | 808 | 1,645 | NO |
| A | 20:58 | plus timing log | **paused** (quiet) | 225 | 282 | pass |
| B | 21:33 | same | running | 330 | 379 | pass |
| 2 | 22:14 | same | running | **590** | 748 | **NO** |
| 3 | 23:01 | plus pool and stall logging | running | 419 | 537 | pass |

So 5.1 passed in 3 of 4 runs on this bring-up and failed in 1; with yesterday's four it is **4 failures in 8 runs under delivery load, and 0 in 1 quiet run**. 5.1 is **not** shown to hold: two formal passes in a row have not happened.

**What the runs show, in order of strength:**
1. **Not the parse, the schema, the token check, the platform call or the insert.** Over runs A, B, 2 and 3 the body read is under 7 ms, JSON parse 0.5 ms, zod 1 to 7 ms, auth 0.4 ms, the destination check 5 to 200 ms (run in parallel with the file check), the 2,000-row insert 85 to 167 ms.
2. **The slow requests lose their time in small database queries.** Run 2's two slow requests (742 and 585 ms): idempotency lookup 419 and 244 ms, file lookup 169 and 179 ms. Run 3's slowest (530 ms): lookup 81 ms, insert 126 ms, commit 105 ms. In the quiet run A the same lookup had p99 3 ms for the big jobs; with deliveries running it was 168 ms (B), 419 ms (2) and 81 ms (3).
3. **Not the pool, not GC, not the CPU limit** (run 3, with per-request logging, D-M5-16): the pool never had a waiting query (`poolMaxWaiting` 0 in all 100 requests, never more than 1 connection open); the only pool waits are the 30 to 85 ms to open a connection in 3 of the 10 big requests (TLS to the database); GC at most 5 ms; CPU-quota throttling 0 ms in every request. A larger pool would not have helped, so none was tried.
4. **Not the database CPU credits.** Yesterday's runs had a credit balance of 17 to 23 (Y1, Y2) and 4 to 7 (Y3, Y4), never 0, surplus credits 0, no surplus credits charged; the instance is in **unlimited** mode (surplus-credit metrics exist), so it cannot be throttled for credits. Today's runs: A 5.6, B 8.3, run 2 about 11 falling to 0 during the run, run 3 about 14. Run 2 failed with the balance falling to 0 and run 3 passed at 14, but Y2 failed at 23 and B passed at 8: credits do not separate the passes from the failures. Storage latency was under 3 ms; the API task's CPU averaged 3 to 4% (one-minute average; peak sample 9 to 20%); freeable memory on the micro instance was 38 to 94 MB at the lowest.
5. **What does separate them: delivery load on the database.** The `pg_stat_activity` sampler (every 250 ms, run 3's timed window, `submit-diag-run3-pg-summary.txt`): up to **51 active backends** (50 Delivery copies and the API) and 63 in total, **49 backends waiting at once on row locks** (`Lock: tuple` and `transactionid`, up to 8.5 s for the longest query), plus WAL waits (`IO: WALSync`, `LWLock: WALWrite`) and up to 50 ungranted locks. The Delivery copies finishing tasks of a job that is being cancelled all queue on that job's row lock (`finishTask` and `failPendingTasks` take `FOR UPDATE` on it, by design). With Delivery paused (run A) none of this exists and every lookup was fast. The two slowest requests of run 2 and the slowest of run 3 each came 11 to 14 s after the previous big job was cancelled.

**Most likely cause, and how sure we are.** Time inside the database on small statements while 50 Delivery copies pile up on the job row lock and the write-ahead log of a small `db.t4g.micro` (about 63 connections, memory 38 to 94 MB free). Supported by: the quiet run, the sampler, the per-phase timing and the exclusions above. **Not proven:** nothing shows a `SELECT` of the API waiting on a lock (plain reads do not), so the exact mechanism (WAL and CPU contention on the small instance, or lock-manager spin) is an inference. Yesterday's four failures cannot be explained further: their database is gone, the API did not log the phases, and their windows show the same resources as today's passes.

**Also the harness.** The 5.1 load cancels every job it submits, so the Delivery copies spend the run draining thousands of cancelled messages that all end on one job row. Real delivery of a 2,000-task job also finishes tasks under the job row lock, but without a cancel in the middle of it.
