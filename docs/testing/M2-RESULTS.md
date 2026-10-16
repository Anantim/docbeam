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

### 3.1 Browser steps on dev

Waiting on the person. The steps are in `M2-TESTING.md` section 3.1. None is recorded as YES yet.

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
