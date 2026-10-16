# M2 results

Evidence for `docs/testing/M2-TESTING.md`. Local part run on 2026-10-15 on the laptop (WSL2, Docker Desktop). **Nothing has been run in AWS yet** (sections 2 and 3 wait for the person's yes, D-M2-14).

## 1. Local

### 1.1 Stack

| Check | Result |
|---|---|
| `docker compose up -d --build --wait` | exit 0. auth, platform, docbeam-api, postgres, localstack, clamav, workers and ws-local `healthy` (rebuilt after the DLQ change) |
| `docker compose run --rm seed` | done earlier in the session; the integration suite passes against the seeded stack |

### 1.2 Tests

| Command | Result |
|---|---|
| `npm run lint` | clean |
| `npm run typecheck` | clean (services, workers, tests, web) |
| `npm test` | 51 test files, 327 tests passed |
| `npm run build` | all workspaces built. Web: `index-*.js` 275 kB, `hash.worker-*.js` 6.5 kB, `docx-preview-*.js` 171 kB and `exceljs.min-*.js` 929 kB as separate files loaded only when used |
| `npm run test:integration` | 15 test files, 126 tests passed |
| `terraform fmt -check -recursive infra` | exit 0 |
| `terraform -chdir=infra/envs/dev validate`, same for `prod` | `The configuration is valid.` for both |

### 1.2c Why STATUS said 129 and the run says 126 (by test names, no old code run)

Method: `git grep -n -E "^\s*(it|test)(\.each)?\(" <commit> -- tests/integration`, names sorted and diffed. A name written with `it.each` runs once per table row, so the run count is the name count plus the extra rows.

| Commit | `it(` / `it.each(` names | Extra rows from `it.each` | Tests run |
|---|---|---|---|
| `cde4987` task 6 | 104 | 14 in 5 tables, plus 3 rows in `workers.test.ts` (3 rows, 1 more name counted once: +2) | 120 (matches the STATUS row for task 6) |
| `0e13e67` task 7 | 111 | 14 | 125 |
| `b163c24` task 9 | 111 | 14 | 125 |
| `HEAD` | 112 | 14 | 126 |

The 14 extra rows are the five tables that exist at every commit: `auth.test.ts` 4 rows (+3), `localstack.test.ts` 3 (+2), `services.test.ts` 3 (+2), `uploads.test.ts` 6 (+5) and 3 (+2). 112 + 14 = 126, which equals the run.

Names removed and added:

| Step | Removed | Added |
|---|---|---|
| task 6 → task 7 (`cde4987` → `0e13e67`) | `workers.test.ts`: `it('runs the sweeper on its one-minute timer')` and `it.each` of 3 rows (4 tests) | `dlq-sweeper.test.ts`: 9 names (task DLQ, crashed worker, never flips, job DLQ pending only, job DLQ closes job, Upload DLQ, sweeper re-send, a minute-old job, daily cleanup) |
| task 7 → task 9 (`0e13e67` → `b163c24`) | none | none |
| task 9 → `HEAD` (`b163c24` → `HEAD`) | none | `web-upload.test.ts`: `it('uploads a small file and a multipart file, verifies both, and sends them as one distribution')`. `dlq-sweeper.test.ts` gained assertions in an existing test, no new name |

So the 129 in the STATUS row for task 7 was 120 (task 6) + 9 (new DLQ tests) with the 4 removed `workers.test.ts` tests not subtracted: 120 − 4 + 9 = 125. It was an arithmetic slip in STATUS, not a lost test. No integration test was removed since task 7, and the only name added since task 9 is the one above. The per-file diff is `git diff --stat b163c24 HEAD -- tests/integration`: `dlq-sweeper.test.ts` (+13 lines) and `web-upload.test.ts` (+122, new).

### 1.2a Named checks

| Requirement | Test | Result |
|---|---|---|
| **Carried over from M0 (Step 0.1): the EICAR test file is refused as infected by the real ClamAV through the Upload Events handler** | `tests/integration/upload-events.test.ts` > "upload-events: confirmation and scanning > EICAR is refused as infected by the real ClamAV" | ✓ 573 ms (object deleted, row `infected`, one `file.refused`) |
| A repeated event writes no second audit event | same file > "a repeated event for a refused file changes nothing and writes no second audit event" | ✓ |
| Platform down, then back: the task goes to pending and finishes | `delivery.test.ts` > "puts a task back to pending when the platform is down, and finishes it when it returns" | ✓ 35.9 s |
| Upload DLQ marks the file and writes `file.refused` with `SCAN_FAILED`, and not twice (D-M2-19) | `dlq-sweeper.test.ts` > "marks a file failed from the Upload DLQ, and leaves a clean one alone" (9 tests in the file) | ✓ |
| The web queue end to end in Node: 5 KB file and 101 MiB multipart file hashed, linked, uploaded in 7 parts, Verified by the real scanner, `POST /jobs` 201, both tasks `completed` | `web-upload.test.ts` > "uploads a small file and a multipart file, verifies both, and sends them as one distribution" | ✓ 16.7 s |
| A deploy during a long upload does not cut it | `platform-drain.test.ts` | ✓ |

### 1.2b Fixes made at the start of this session

| Fix | Evidence |
|---|---|
| Delivery's security group only on the Auth and platform listeners | `infra/modules/alb` takes `clients` with an optional `services` list; `terraform validate` passes in both envs. The plan against AWS is not run yet (it reads AWS); the client rules change from 12 (4 clients x 3 listeners) to 11 (Delivery on 2) |
| Upload DLQ writes `file.refused` (D-M2-19) | `dlq-sweeper.test.ts` checks one event with `reason SCAN_FAILED`, `ownerUserId`, `actor_id` NULL, none for the clean file, still one after the same message again |

### 1.3 Browser checks: done by the person on 2026-10-16

Steps 1 to 19 of section 1.3 in `M2-TESTING.md`.

| Steps | Status | Evidence |
|---|---|---|
| 1 to 19 | YES (all 19), reported by the person | The person ran every step in the browser. Notes from the run: (1) opened at `http://127.0.0.1:5173`, every upload was blocked by CORS because the local bucket allowed only `http://localhost:5173`; fixed, see 1.3b. (2) The bottom-bar line "N files to N destinations, each uploaded once" was removed (D-M2-20). (3) UI polish items went to STATUS "UI polish (after M4)". (4) The demo user Anantim Patil was added (D-M2-21) |

### 1.3b Changes after the browser run (2026-10-16)

| Change | Evidence |
|---|---|
| CORS allows `http://localhost:5173` and `http://127.0.0.1:5173` locally (POST, PUT, GET, DELETE, `ETag` exposed) | `docker/localstack/init/ready.d/init.sh`. `localstack.test.ts`: `answers a CORS preflight from the web app at http://localhost:5173`, `... at http://127.0.0.1:5173` and `does not allow another origin in a CORS preflight` pass. Dev preflight is check 16 in M2-TESTING section 3 (not run yet) |
| Send bar summary line removed | `web/src/components/SendBar.tsx`, `Distribute.tsx`; D-M2-20 |
| Demo user `anantim.patil@example.com` in Cardio, Oncology, Neuro | `seed/generate.mjs`, `demo.json`; D-M2-21. Login returns 200. Seed on the existing database: `membersAdded 3` (4 existed); on a fresh database it is 7 |
| Full run after the three changes | lint, typecheck clean; 327 unit tests pass; 129 integration tests in 15 files pass |

### 1.4 Command line

Covered by the integration runs above (the three commands in section 1.4 are the same tests).

### 1.5 Full re-run after the dev findings (2026-10-16, HEAD `d81ff17`)

Run after D-M2-22 (platform ingest limiter, 5 MB upload parts), the leave-warning change and the favicon:

| Command | Result |
|---|---|
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm test` | **53 test files, 334 tests passed** (327 before; new: `ingest-limiter.test.ts` 5, `documents.test.ts` 2) |
| `npm run build` | all workspaces built; `web/dist` has `favicon.svg` and the `<link rel="icon">` |
| `docker compose up -d --build --wait` | every container healthy (platform rebuilt with the limiter) |
| `docker compose run --rm seed` | both files `seed applied` with every count 0 (already seeded) |
| `npm run test:integration` | **15 test files, 129 tests passed** |
| `terraform fmt -check -recursive infra`; `validate` in dev and prod | exit 0; both valid |

## 2. Deploy to dev on AWS (2026-10-16)

Dev was down at the start (empty state, no repositories). Each push, apply and task run was approved by the person. Region `ap-southeast-2`, account `346208529537`. Images are tagged with the commit.

| # | Step | Result |
|---|---|---|
| 1 to 5 | caller, variables, tag, `init -reconfigure` | `…:user/anantim-admin`. `ALARM_EMAIL` set, `ECS_DEPLOY_ENABLED=true`, `INFRA_APPLY_ENABLED=false`, `LAMBDA_DEPLOY_ENABLED` unset. Tag `e1ff11c2506a`. Backend initialised |
| 6 | `apply -target=module.ecr` | `Apply complete! Resources: 10 added` (5 repositories and their lifecycle policies) |
| 7, 8 | push auth, platform, docbeam-api, db-bootstrap | all four pushed (`…/docbeam-dev/<name>:e1ff11c2506a`) |
| 9 | push `upload-events` (ClamAV, about 1 GB) | pushed |
| 10 | plan, authorizer off | `Plan: 229 to add, 0 to change, 0 to destroy` |
| 11 | apply | **Failed on one resource**: `CreateFunction … The image manifest, config or layer media type … is not supported`. 227 resources were created. See finding F1 |
| 11b | re-apply with `upload_events_image_tag=cf4b70e89ead` | `Apply complete! Resources: 2 added` |
| 12 | SNS email | `PendingConfirmation` until the person clicked the link; later `email` with a real subscription ARN (confirmed) |
| 13 | `scripts/run-db-bootstrap.sh dev` | three `database ready` lines, `bootstrap finished`, `exit code: 0` |
| 14 | `scripts/run-task.sh dev auth signing-key` | `signing key written`, `exit code: 0` |
| 15 | `deploy-service.sh` for auth, platform, docbeam-api | each ends `Deployed … to docbeam-dev-<service>`; platform also ran the seed |
| 16 | `scripts/check-internal.sh dev` | `3001 200 auth`, `3002 200 platform`, `3003 200 docbeam-api` |
| 17 | `npm run build`, `deploy-lambda.sh` for fanout, delivery, dlq, sweeper | each `Deployed the new code to docbeam-dev-<name>` |
| 18 | `deploy-lambda.sh dev upload-events <image>` | `already runs … Nothing to do` |
| 19 | second apply (authorizer) | `Apply complete! Resources: 11 added` |
| 20 | `scripts/deploy-web.sh dev` | `Deployed to https://d20vwpie25gfdb.cloudfront.net` |
| 21 | plan | `No changes. Your infrastructure matches the configuration.` |
| 22 | `LAMBDA_DEPLOY_ENABLED` | **not set yet**; the person sets it before the merge |

### Findings during the deploy

| # | Finding | Fix |
|---|---|---|
| F1 | Lambda refused the Upload Events image. `docker build` (BuildKit) added a provenance attestation, which makes the image an OCI index; Lambda accepts only a plain manifest. The pushed manifest had `mediaType application/vnd.oci.image.index.v1+json`. ECR tags are immutable, so it needed a new tag | `scripts/push-image.sh` builds with `--provenance=false --sbom=false` (commit `cf4b70e89ead`). The new image has `application/vnd.docker.distribution.manifest.v2+json`. Services stay on `e1ff11c2506a` (ECS accepts an index); Upload Events runs `cf4b70e89ead` |
| F2 | `terraform apply` without `-auto-approve` fails here (`error asking for approval: EOF`, no stdin). Nothing was created | Applies were run with `-auto-approve`, each approved at the permission prompt |
| F3 | The Object Store buckets carry the account id: `docbeam-dev-object-store-346208529537` (not `docbeam-dev-object-store`) | M2-TESTING check 0 and 16 corrected |
| F4 | The Object Store policy denies object reads to every principal outside the four roles, so the admin user cannot `head-object` (403). By design (D-M2-18) | The checksum is proved through Delivery, which makes the same `HeadObject` with `ChecksumMode ENABLED` and fails a task without a matching checksum on AWS (check 0 below) |
| F5 | The platform ran out of memory under many large deliveries (details in 3, checks 11b and 12) | D-M2-22: limiter, one 5 MB part at a time, 1 vCPU / 2 GB |

## 3. Verify on dev (2026-10-16)

`APP=https://d20vwpie25gfdb.cloudfront.net`. Driver scripts were run from the session scratchpad (not in the repo): a curl script for single files and a Node script that runs the web app's own upload queue (`web/src/upload/manager.ts`) against the dev API. User: `anantim.patil@example.com` (D-M2-21).

| Check | Result |
|---|---|
| **0. Checksum from real S3** | **PASS.** A tiny PDF (about 35 bytes) through the presigned POST: upload `204`, scan `clean`, job `201`, Delivery log `task delivered` (job `c2b89c35…`). Delivery has no `S3_CHECKSUM_OPTIONAL` on dev, so it fails a task whose staged object has no matching SHA-256. So real S3 stored and returned the SHA-256 for a POST-form object. The 120 MB file (8 parts, `partCount 8`) uploaded, was `verified` and delivered the same way (job `774f10a6…`, `task delivered`), so the composite value matched too |
| 1. Demo through CloudFront | Upload, scan, send, fan-out, delivery and the platform all ran through `https://d20vwpie25gfdb.cloudfront.net`. The browser steps are in 3.1 below |
| 2. Swapped body refused by S3 | **PASS.** Wrong bytes: `400` `<Code>BadDigest</Code>`. Right bytes: `204` |
| 3. EICAR | **PASS.** Upload `204`, `scanStatus infected`. Upload Events log: `file refused`, `"status":"infected"`, `"reason":"MALWARE"` |
| 4. 120 MB scan time | **PASS.** Upload Events `Duration 49039 ms` (billed 49365 ms) for the 120 MB file, `Max Memory Used 1446 MB` of 3008, no timeout |
| 5. 3 files x 3 folders | **PASS.** `taskCount 9`; Delivery log: 9 distinct `task delivered` for job `2a8166a3…` |
| 6. Documents in the platform | **PASS.** Platform log: 9 `statusCode 201` for `POST /documents` (job above), zero 4xx or 5xx; the Platform File Store holds the documents (`aws s3 ls … --recursive`, 11 objects after the first 3 jobs) |
| 7. Queues | **PASS.** All six queues (job, task, upload-events and their DLQs) at 0 visible, 0 in flight, 0 delayed after each run |
| 8. Alarms and SNS | **PASS.** Four alarms `OK`: `docbeam-dev-delivery-error-rate`, `-job-dlq-not-empty`, `-task-dlq-not-empty`, `-upload-events-dlq-not-empty`. SNS subscription `email` is confirmed (a real subscription ARN; it was `PendingConfirmation` until the person clicked the link) |
| 9. Schedules | **PASS.** `docbeam-dev-sweeper-resend` `rate(1 minute)` and `docbeam-dev-sweeper-cleanup` `rate(1 day)`, both `ENABLED` |
| 10. S3 notification | **PASS.** One configuration: `staging/`, `s3:ObjectCreated:*`, to `docbeam-dev-upload-events`. Scanned objects were accepted by Delivery, which needs the `clean` tag |
| 11. Platform stopped mid-run | **PASS on the third attempt.** Attempt 1 (3 x 5, 15 tasks) and attempt 2 (30 x 5, 150 tasks) finished before the stop took effect, so they proved nothing. Attempt 3 (100 files x 14 destinations, 1,400 tasks, job `b5455c82…`): platform scaled to 0 at 11:25:07 UTC; 538 delivered before the stop; 862 went back to the queue (1,724 `temporary delivery error` lines, none lost); platform back at 11:30:35; **1,400 of 1,400 distinct tasks delivered by 11:33:49**; all six queues at 0; four alarms `OK`; Task DLQ never held a message |
| 11b. Stress: 50 concurrent large deliveries | **See 3.2.** |
| 12. Forced platform deploy during an ingest | **PASS** (second attempt, after the fix). A 120 MB file sent to 14 destinations 30 s into `deploy-service.sh … --force`: `deploy exit=0`, 14 of 14 delivered, Task DLQ 0. The first attempt (before the fix) failed because the platform was out of memory (see 3.2) |
| 13. Security groups | **PASS.** The ALB group allows the Delivery group on ports 3001 and 3002 only (3003 is not open to it). Delivery outbound is open (it needs S3, the database and the platform) |
| 14. Lambda skip | **PASS.** `deploy-lambda.sh dev fanout …` prints `already runs this code. Nothing to do` |
| 15. `POST /jobs` time | Three single-file jobs from the session machine: `0.93 s`, `0.97 s`, `0.86 s` end to end. This includes a new TLS connection from outside AWS to CloudFront, so it is not the server-side p99. **The 500 ms p99 is measured in M5 (check 5.1).** |
| 16. CORS preflight on the dev bucket | **PASS.** `Origin: https://d20vwpie25gfdb.cloudfront.net` with `Access-Control-Request-Method` POST, PUT, GET and DELETE: each `HTTP/1.1 200 OK`, `Access-Control-Allow-Origin: https://d20vwpie25gfdb.cloudfront.net`, `Access-Control-Allow-Methods: POST, GET, DELETE, PUT`. `Origin: https://evil.example`: `403 AccessForbidden`, no allow-origin header |

### 3.1 Browser steps on dev: done by the person on 2026-10-16

All 9 steps of `M2-TESTING.md` section 3.1 passed, at https://d20vwpie25gfdb.cloudfront.net as `anantim.patil@example.com`.

| Steps | Status | Evidence |
|---|---|---|
| 1 (sign in, three teams), 2 (add four files, no CORS error), 3 (EICAR refused), 4 (map to three folders), 5 (preview), 6 (Send, toast, `POST /api/jobs` 201), 7 (**remove the 120 MB file mid-upload: the `DELETE` abort works, no CORS error**), 8 (leave warning on reload during an upload), 9 (sign out and in, page empty) | **YES (all 9)**, reported by the person | The person ran every step. Notes: the leave warning appeared when the page was reloaded during an upload; the console warnings from `contentscript.js` come from a browser extension, not DocBeam |

Two changes followed from the run:

- **Leave warning (D-M2-20):** it fired only while files were uploading, so a reload with everything `Verified` lost the prepared batch without a warning. It now fires whenever the page holds files that were not sent. Test: `Distribute.test.tsx` > "asks before the page is closed whenever it holds files that were not sent, and not when it is empty" (uploading, verified, refused, then empty). Step 8 in `M2-TESTING.md` now also reloads after `Verified`; the person has not repeated it yet.
- **Favicon:** `web/public/favicon.svg` and `<link rel="icon">` in `web/index.html`. Redeployed to dev: `/favicon.svg` answers `200 image/svg+xml` and the page carries the link. **`/favicon.ico` still answers `403`** (there is no such file in the bucket; a browser that sees the `<link>` does not ask for it). A binary `.ico` cannot be written with the Write tool; see STATUS known issues.

### 3.2 The platform out of memory, and the stress check (F5)

| Run | Platform | Result |
|---|---|---|
| Check 12, first attempt: 1 file of 120 MB x 14 destinations during a forced deploy | 0.25 vCPU, 0.5 GB | **Failed.** Three platform tasks in a row stopped with exit 137 `OutOfMemoryError`; Delivery logged `The platform answered 502` (155), `503` (32), `504` (13). After 5 failed attempts the 14 tasks reached the Task DLQ |
| Stress check, first run: 5 files of 120 MB x 10 destinations (50 at once) | 0.25 vCPU, 1 GB, one 5 MB part at a time | **Failed.** CloudWatch `MemoryUtilization` peak 98% and `CPUUtilization` 100%; three tasks killed (exit 137). All 50 tasks later reached the Task DLQ |
| Stress check, re-run (job `889b8c09…`) | 1 vCPU, 2 GB, at most 6 ingests at once, 503 after 30 s waiting | **PASS.** 50 of 50 tasks delivered, 0 `retries exhausted`, no platform task stopped (service 1/1). `MemoryUtilization` peak **13.9%** (limit 80%), average 12.3%. `CPUUtilization` peak 99.6% for about two minutes while the limiter held the other ingests back. **32 `PLATFORM_BUSY` 503 retries** across 26 tasks (26 first attempts, 6 second attempts); Task DLQ 0 |

Decision and reasoning: D-M2-22. The platform is a stand-in; the real platform's ingest capacity is for the client to confirm.

### 3.3 Evidence that the DLQ path works on AWS

Two real runs sent tasks to the Task DLQ (both because the platform kept running out of memory, before the fix):

- Job `a9b445ee…`: 14 tasks. DLQ Consumer log: 14 distinct `task failed: retries exhausted`, `receiveCount 6`; the last one logged `"jobClosed":true`.
- Job `36b51817…`: 50 tasks. 50 distinct `retries exhausted`; the last logged `"jobClosed":true`.

Both times the queue and its DLQ were empty again after the Consumer ran, and the `task-dlq-not-empty` alarm stayed `OK` (the Consumer drains the DLQ faster than the alarm's evaluation period).

## 4. Final check: YES / NO (2026-10-16)

Each line of the M2 prompt (`docs/agent/PROMPTS.md`, Session 3) and of TDD Steps 2.1 to 2.6. **All are YES except the lines marked NO or "at hand-over"; every NO is an accepted gap with its reason in 4.3.** Test names are in `tests/integration` unless a path is given. "Dev" means the checks of section 3.

### 4.1 The M2 prompt: outputs

| # | Requirement | YES / NO | Evidence |
|---|---|---|---|
| P1 | Upload routes: single-part POST policy, multipart start, re-sign, complete; file rows; `GET /files?ids=` | YES | `services/docbeam-api/src/routes/uploads.ts:55` (`POST /uploads`), `:93` (start), `:130` (re-sign), `:149` (complete); `routes/files.ts:11`. `uploads.test.ts` (18 tests, e.g. "starts, uploads every part, re-signs one, and completes with the combined checksum", "reports the state of the caller's own files only"). Dev: check 0, check 2 |
| P2 | Upload Events Lambda as a container image with ClamAV, sizes/timeout/queue visibility/concurrency per Step 2.1 | YES | `workers/upload-events/Dockerfile`; `infra/envs/dev/async.tf:49-51` (3008 MB, 10240 MB storage, 600 s), `:59` (concurrency 10); `infra/modules/sqs/main.tf:27-28` (visibility 3600, receive 5); `modules/lambda/variables.tf:83` (batch 1). Dev: Lambda ran with `Max Memory Used 1446 MB`, 49 s for 120 MB |
| P3 | The clean tag, the conditional update, the `file.refused` event | YES | `workers/upload-events/src/process.ts:127-136` (tag first, then `UPDATE files … scan_status = 'clean'`), `:83-118` (`refuse`). "a clean file is tagged scan-status=clean and confirmed, and a repeated event changes nothing"; "EICAR is refused as infected by the real ClamAV" |
| P4 | The daily image rebuild wired to it | YES | `.github/workflows/upload-events-image.yml:17-18` (cron `17 3 * * *`), `:49` (`no-cache` on schedule), `:57` (deploy job, skipped until `LAMBDA_DEPLOY_ENABLED`). The workflow has not yet run against dev (it needs the merge) |
| P5 | `POST /jobs` with every check, one transaction, queue message after commit | YES | `routes/jobs.ts:97`, transaction with `unnest` at `:174`, `queue.sendJob` after it at `:213`. `jobs.test.ts` (13 tests: 201, each 4xx creates nothing, repeated and parallel same key, 100 x 20, platform down). Dev: jobs `c2b89c35…`, `2a8166a3…`, `b5455c82…` |
| P6 | Job and Task queues and DLQs in Terraform with exact limits | YES | `infra/modules/sqs/main.tf:15-28,37-48` (14-day retention, SSE-SQS, visibility 360/720, receive 3/5); `async.tf:78` (Fan-out 60 s), `:104-105` (Delivery 1024 MB, 120 s). Dev: `terraform plan` = `No changes` |
| P7 | Fan-out, Delivery (claim, checksum, service token, permanent and temporary errors, retry gaps, job row lock, pushes), DLQ Consumer, Sweeper (every minute and daily) | YES | `workers/fanout/src/index.ts`; `workers/delivery/src/deliver.ts:57` (claim), `:184` (HEAD with checksum), `:108` (401 once), `classify.ts:11-37` (errors and gaps 30/120/300/600/0); `packages/shared/src/task-outcome.ts:72,144` (job row lock); `push.ts`; `workers/dlq/src/process.ts`; `workers/sweeper/src/index.ts`; `modules/scheduler` (`rate(1 minute)`, `rate(1 day)` on dev). Tests: `fanout.test.ts`, `delivery.test.ts` (9), `dlq-sweeper.test.ts` (9) |
| P8 | Delivery capped at 50, Upload Events at 10, by trigger maximum concurrency | YES | `async.tf:117` (`max_concurrency = 50`), `:59` (`10`). Dev stress run: 50 concurrent deliveries |
| P9 | Web app part 2: allow-list, SHA-256 in a Web Worker, parallel uploads with resume, Checking/Verified/Refused, mapping as in the mockup with live task count, Review with Preview and remove, Send | YES | `web/src/distribute/files.ts:22` (`acceptFiles`, 100 cap, allow-list), `web/src/upload/worker-hash.ts:5`, `hash.worker.ts`, `manager.ts:89` (waves of 20, 4 at once, resume), `distribute/mapping.ts:44` (`deliveryCount`), `components/Review.tsx`, `Preview.tsx`, `SendBar.tsx`. 334 unit tests; `web-upload.test.ts`; local browser steps 1 to 19 and dev browser steps 1 to 9: YES (the person) |
| P10 | Platform draining: target group deregistration delay and container `stopTimeout` of 120 s in dev and prod (module variable, default 30) | YES | `infra/envs/dev/services.tf:76,164`, same lines in `prod/services.tf`; `modules/alb/variables.tf:24` (default 30); `modules/ecs-service/main.tf:139`. `platform-drain.test.ts` "finishes an upload that is running when it gets SIGTERM". Dev check 12: a forced deploy during a 14-destination ingest, `deploy exit=0`, 14 of 14 delivered |
| P11 | The four alarms and their SNS topic sending to `ALARM_EMAIL` | YES | `infra/modules/alarms/main.tf:20-21,27,45`. Dev: four alarms `OK`; subscription confirmed (check 8) |
| P12 | Lambda deploy jobs that skip with a notice when dev does not exist or the function runs that code | YES | `scripts/deploy-lambda.sh:38,45,59`; `workers.yml:66`, `upload-events-image.yml:57`; `tests/scripts/deploy-lambda.test.ts`. Dev: check 14 "already runs this code. Nothing to do" |
| P13 | Plan: whether to keep `image_tag` required | YES | D-M2-1 (`docs/DECISIONS.md:316`): it stays optional (default `bootstrap`); one-off tasks run only marked revisions. Approved in the plan |
| P14 | Tests: EICAR by the real scanner | YES | `upload-events.test.ts:65` |
| P15 | Tests: the same task message twice | YES | `delivery.test.ts:139` "stores one document and writes one audit event when the same message arrives twice" |
| P16 | Tests: a temporary error puts a task back to pending | YES | `delivery.test.ts:160` "puts a task back to pending when the platform is down, and finishes it when it returns" |
| P17 | Tests: two last tasks finishing together | YES | `delivery.test.ts:182` "closes the job exactly once when its last two tasks finish together" |
| P18 | Tests: the sweeper re-sending a job | YES | `dlq-sweeper.test.ts:160` "sends the job message again for a job whose fan-out never started" |
| P19 | `M2-TESTING.md`, `M2-RESULTS.md`, `STATUS.md` updated | YES | `docs/testing/M2-TESTING.md`, this file, `docs/STATUS.md` |

### 4.2 The M2 prompt: "Done when" and TDD Steps 2.1 to 2.6

| # | Requirement | YES / NO | Evidence |
|---|---|---|---|
| D1 | The demo works locally: pick files, upload, map, submit, see the documents in the platform | YES | Local browser steps 1 to 19 (the person, 2026-10-16); `web-upload.test.ts` |
| D2 | The demo works on dev | YES | Dev browser steps 1 to 9 (the person); checks 0, 5, 6 |
| D3 | Stopping the platform mid-run and watching the backlog drain | YES | Check 11, third attempt: 1,400 tasks, platform stopped at 11:25:07 UTC, 538 delivered before, **1,400 of 1,400 delivered by 11:33:49**, DLQs 0 |
| D4 | Tell the person when to set `LAMBDA_DEPLOY_ENABLED`; remind them to merge while dev is up | At hand-over | In the hand-over message after the PR checks are green |
| D5 | Plan first and wait for approval; branch `m2`; YES/NO check; pull request | YES | `docs/PLAN.md` M2 task list (approved); branch `m2`; this section; the PR (see STATUS) |
| 2.1a | Four upload routes; file rows; single-part `s3_checksum` = declared SHA-256 | YES | See P1; `uploads.test.ts` "returns one form per file, in order, and stores a pending file row"; dev check 2: wrong bytes `400 BadDigest`, right bytes `204` |
| 2.1b | S3 events on `staging/` to the Upload Events Queue (receive 5, Upload DLQ); the Lambda checks size and checksum against the row, then scans; clean file tagged and confirmed in one conditional update; infected file deleted, marked, `file.refused`; repeat changes nothing | YES | Dev check 10 (notification on `staging/`); `process.ts:38-48` (`checkAgainstRow`), `:127-136`; `upload-events.test.ts` (6 tests incl. "refuses a file whose stored size is smaller than declared", "refuses bytes that differ from the declared SHA-256…", "ignores an event for a file that has no row"). Dev check 3: `file refused`, `MALWARE` |
| 2.1c | Scanner image, limits raised to 1 GB, 3,008 MB, 10 GB, 600 s, batch 1, visibility 3,600, concurrency 10; daily rebuild | YES | `scanner.ts:22,116-117` (1100 MB); see P2 and P4. **Image format finding F1** (provenance flag in `push-image.sh`) |
| 2.2a | `POST /jobs` checks: limits, ownership, age, fingerprints, upload checks, one destination check call | YES | `jobs.test.ts` (422 INVALID_BATCH, FILE_NOT_READY, FILE_TOO_OLD, 409 FILE_ALREADY_SUBMITTED, CHECKSUM_MISMATCH, ownership, DESTINATION_NOT_FOUND) |
| 2.2b | Service token fetched at startup and renewed in the background | YES | `packages/shared/src/service-token.ts`; `service-token.test.ts` |
| 2.2c | One transaction; `job_id IS NULL` claim gives 409; tasks in one `unnest` statement; `job.submitted` audit event | YES | `jobs.ts:174`; "creates the job, claims the files, writes one pending task per delivery and one audit event" |
| 2.2d | After commit one message; a failed send still returns 201 and the sweeper re-sends | YES | `jobs.ts:213`; "sends the job message again for a job whose fan-out never started" |
| 2.3a | Queues and DLQs, receive 3 and 5, 14-day retention, SSE-SQS on all five, Fan-out 60 s, Job visibility 360, Delivery 1,024 MB / 120 s (platform call limit 100 s), Task visibility 720, batch 1 with ReportBatchItemFailures | YES | See P6; `modules/lambda/main.tf:172-173`; `deliver.ts:17` (`PLATFORM_TIMEOUT_MS = 100_000`) |
| 2.3b | Fan-out: set `fanned_out_at`, `SendMessageBatch` in groups of 10, body is the task id only | YES | `fanout.test.ts` "sends one task message per pending task, and again for a redelivered job message" |
| 2.4a | Claim; already final: acknowledge and stop | YES | `deliver.ts:57-58`; "stores one document and writes one audit event when the same message arrives twice" |
| 2.4b | HEAD with checksum mode; missing: FILE_NOT_UPLOADED; different: CHECKSUM_MISMATCH | YES | `deliver.ts:184-195`; "fails FILE_NOT_UPLOADED when the staged file is gone", "fails CHECKSUM_MISMATCH when the stored checksum is not the declared one". Dev check 0 (real S3 returns the checksum) |
| 2.4c | Cached service token, 401 gets a new token once | YES | `deliver.ts:108`; `deliver.test.ts` |
| 2.4d | 200/201 complete; 403 NOT_A_MEMBER, 404, 422 permanent; everything else temporary with `last_error`, ChangeMessageVisibility gaps 30 s, 2, 5, 10 min, then at once | YES | `classify.ts:11-37`, `classify.test.ts` ("[30, 120, 300, 600, 0, 0]"); "fails UNSUPPORTED_TYPE when the bytes are not a PDF"; dev: 1,724 `temporary delivery error` lines in the outage run, none lost |
| 2.4e | Each final status: one transaction, job row lock, conditional write, audit event, close job | YES | `task-outcome.ts:72,144`; "closes the job exactly once when its last two tasks finish together" |
| 2.4f | Pushes to subscribers; errors never fail a delivery | YES (code and local) | `push.ts`, `push.test.ts`; "deletes a dead connection after a push, and leaves an expired one alone". **On AWS no push is sent yet** (see N1) |
| 2.4g | Dev: one connection per Lambda copy; Task Queue concurrency 50 | YES | `lambda-db.ts`; `async.tf:117`. Dev stress run used the full 50 |
| 2.5a | DLQ Consumer: Task DLQ RETRIES_EXHAUSTED with `last_error`; Job DLQ FANOUT_FAILED; Upload DLQ marks the file failed; closes the job and pushes | YES | `workers/dlq/src/process.ts:67,74,95-107`; `dlq-sweeper.test.ts` (6 consumer tests). **Dev: 14 and 50 tasks went through the Task DLQ, all marked `retries exhausted`, the job closed (3.3)** |
| 2.5b | Sweeper: re-send after 2 minutes, daily cleanup of unsubmitted files older than 24 hours, objects deleted, multipart aborted; partial indexes | YES | `sweeper/src/index.ts:23,37,58-63`; `0000_docbeam_schema.sql:78` (`idx_files_unsubmitted … WHERE job_id IS NULL`); "deletes unsubmitted files older than 24 hours with their objects, and aborts open multipart uploads". Dev: both schedules `ENABLED` (check 9) |
| 2.6a | File picker capped at 100 with the allow-list; SHA-256 in a Web Worker | YES | `files.ts:22`, `files.test.ts`; `worker-hash.ts`, `hashing.test.ts` |
| 2.6b | Queue: 4 to 6 parallel uploads, waves of 20, progress, multipart resume | YES (4) | `manager.ts:89`, `manager.test.ts`. 4 parallel uploads (see N3) |
| 2.6c | Mapping as in the mockup with a live task count; the same batch limits as the API | YES | `mapping.ts:44`, `mapping.test.ts`; `packages/shared/src/batch.ts` shared with the API |
| 2.6d | Checking until scanned, then Verified or Refused with the reason; Send enabled once every file is verified | YES | `Distribute.test.tsx`; browser steps (local 1 to 19, dev 1 to 9) |
| 2.6e | Full-width Review: every destination with its files, Preview and a cross; a file left with no folder drops out; Preview from the browser copy | YES | `Review.tsx`, `Preview.tsx`; "removes a file from one folder with the cross in Review, and drops a file left with no folder"; sandboxed iframe (D-M2-20) |

### 4.3 Accepted NOs and deviations (each with its reason)

| # | Gap | Reason |
|---|---|---|
| N1 | **NO live push on AWS.** Delivery logs `WS_MANAGEMENT_ENDPOINT is not set; no pushes`; its role has no `execute-api:ManageConnections` | The WebSocket API is M3, Step 3.2. Code and tests are in place (2.4f) |
| N2 | `POST /jobs` 500 ms p99 not measured | M5, check 5.1. From a laptop outside AWS one job took 0.86 to 0.97 s including a new TLS connection (check 15) |
| N3 | 4 parallel uploads, parts of one file one after another | TDD says 4 to 6 and does not say whether parts run in parallel. Four is the low end of the range |
| N4 | A failed file shows Retry and Remove together | The mockup shows Retry alone, which would leave a refused file that cannot be removed except with Clear |
| N5 | **Platform sizing differs from TDD Step 1.4** (1 vCPU / 2 GB, at most 6 ingests at once, 503 after 30 s) | The dev stress run with 50 concurrent 120 MB deliveries killed the 0.25 vCPU task three times. D-M2-22. The platform is a stand-in; the real platform's capacity is the client's to confirm |
| N6 | The 503 for a long wait is sent when 30 s are up, not predicted on arrival | No reliable estimate of the wait exists; D-M2-22 says so |
| N7 | `/favicon.ico` answers `403` on dev | Only `favicon.svg` exists; browsers that see `<link rel="icon">` do not ask for `/favicon.ico`. A binary `.ico` cannot be written with the Write tool (STATUS known issues) |
| N8 | The `task-dlq-not-empty` alarm did not fire in the two DLQ runs | The DLQ Consumer drains the queue faster than the alarm's one-minute evaluation. The alarm itself is `OK` and wired (check 8); a slower consumer would raise it |
| N9 | The daily Upload Events rebuild workflow has not run on AWS | It deploys only after the merge and `LAMBDA_DEPLOY_ENABLED=true`; the deploy path itself (`deploy-lambda.sh` with an image) was run by hand (check 18) |
| N10 | The AWS provider moved to 6.69.0 by `terraform init -upgrade` | Recorded in STATUS (M2 task 8) |
| N11 | Dev load tests (3 x 3, 1,400 tasks, 50 x 120 MB) used driver scripts, not a browser | A browser cannot be driven here. The browser path was run by the person (3.1) |
| N12 | The leave warning change (step 8, reload after `Verified`) has not been re-run in a browser | Unit test passes; the person has not repeated step 8 since the change |
| N13 | UI polish list (STATUS) | The person's decision: after M4 |
