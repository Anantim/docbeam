# DocBeam status

Updated 2026-10-16, **during M3** (branch `m3`, all local work done and committed; stopped before the first AWS step, D-M2-14).

## M3 progress (read this first)

**Done and committed on `m3`:** every task of the plan except the AWS round and the close. Plan: `docs/PLAN.md` (M3 task list). Decisions: `docs/DECISIONS.md` D-M3-1 to D-M3-8. Local evidence: `docs/testing/M3-RESULTS.md`. Testing document: `docs/testing/M3-TESTING.md`.

- Unit/web: 71 files, 527 tests. Integration: 17 files, 157 tests. **Browser (Playwright, `npm run test:e2e`, local only, D-M3-11): 34 tests in 5 files (M3 tracking 10, tooltips 2, look 7, M1 pack 7, M2 pack 8), two full runs passed. All 22 browser steps of `M3-TESTING.md` 1.3 are YES by test.** Each suite ran twice in a row, green.
- UI pass of 2026-10-17 (D-M3-10 amended, D-M3-12, D-M3-13): one disabled look, Cancel only while running, one status chip, content-sized columns (the Documents table is one grid; draggable widths removed), icon Preview/Download on both pages, coloured type badges, the fixed sign-in pause note. Also fixed from screenshots: a CSS class clash, attempts carried by the live push, the open card following live counts. Lint, typecheck, build, `terraform fmt/validate` for dev and prod are clean. Read-only dev plan: 275 to add.
- Added after the first report: D-M3-9 (the Sweeper's daily run deletes expired `ws_connections` rows), D-M3-10 (tooltip rules, `web/src/explain.ts`), D-M3-11 (Playwright). `scripts/empty-dev-buckets.sh` has `--dry-run` (run for real against LocalStack, M3-RESULTS 1.2c).
- Playwright needs Chromium (`npx playwright install chromium`) and, on WSL, the system libraries once: `sudo env "PATH=$PATH" npx playwright install-deps chromium`.
- DocBeam API: `GET /jobs`, `GET /jobs/:id`, `GET /jobs/:id/tasks`, `POST /jobs/:id/cancel`, `/retry`, `GET /audit`, with team visibility and the 60-second teams cache (`services/docbeam-api/src/routes/jobs-read.ts`, `jobs-actions.ts`, `audit.ts`, `job-access.ts`, `tracking.ts`).
- WS Handlers (`workers/ws/src/handler.ts`), Terraform `infra/modules/websocket-api`, the `ws` Lambda (reserved concurrency 3), push permissions for Delivery, the DLQ Consumer and the DocBeam API, six new gateway routes (both envs).
- Web: `web/src/live/` (client with catch-up), `web/src/tracking/`, `StatusPage`, `JobDetailView`, `TaskTable` (virtualized), `AuditTrailPage`, `Popover`/`DestinationChips` (the "+N" chip, D-M3-2), hash routing in `App.tsx`.
- `scripts/empty-dev-buckets.sh` with its test; README and every Tear down section updated. `/favicon.ico` served from the SVG by the CloudFront Function (D-M3-1).

- Copy change, 2026-10-17 (asked by the person, before the dev web deploy): the sign-in page subtext is now "Pick your files, tick the folders, and follow every delivery." (`web/src/components/AuthCard.tsx`), and the heading and subtext have `text-wrap: balance` (`web/src/styles.css`). Both differ from the mockup text in `docs/design/ui/Main.dc.html` on purpose. No test checked the old text. New Playwright test in `ui.spec.ts` (35 tests now) measures words per line at 375, 1280 and 1920 px: no last line has a single word (heading 2/2/3, 3/4, 7; subtext 6/4, 10, 10).

- D-M3-14 (2026-10-17): `.github/workflows/dev-up-check.yml`, a daily 17:30 UTC read-only check that fails while a `docbeam-dev` ECS cluster exists. Its schedule starts after the merge to `main`.

**Left to do:**
1. **The person's yes**, then the AWS round: `M3-TESTING.md` sections 2 and 3 (new dev bring-up; ~25 min apply; ~4.5 USD a day), record in `M3-RESULTS.md`. Then tear down with `scripts/empty-dev-buckets.sh dev` and `terraform destroy` (section 5). The script's JMESPath query has never run against real S3; its first real run is the teardown.
2. One look by the person at Distribute and Status (colours and spacing, laptop and wide width; Playwright covers every numbered step) and on dev the two-browser checks (section 3). On dev, run `scripts/empty-dev-buckets.sh dev --dry-run` after the checks, show the output, and only then run it for real in the teardown.
3. The final YES/NO check (`M3-RESULTS.md` section 4), `docs/walkthrough/M3.md`, this file's final update, push `m3`, `gh pr create`.

**Working-rule slip to note:** a few edits early in the M3 session were made with `cat >>`, `sed -i` and inline Python instead of the Edit/Write tools (AGENTS "Style"); every change is in git and was reviewed in the diff. The rest of the session used Edit/Write only.

## Previous status (end of M2)

**M2 is built and verified locally and on dev,** including the browser checks done by the person (19 local steps, 9 dev steps). A user can pick up to 100 files, upload them (single-part and multipart), have them scanned for malware, map them to up to 20 folders, send them and see the documents arrive in the platform. Stopping the platform mid-run and starting it again drains the backlog (1,400 tasks, all delivered once). **Merged (PR #5) on 2026-10-16; the deploy jobs ran green against dev, and dev AWS is now DESTROYED** (see "Set up so far"; the two data buckets needed emptying by hand first, D-M2-23). Plan: `docs/PLAN.md`. Decisions: `docs/DECISIONS.md` (D-M1-1 to D-M1-15, D-M2-1 to D-M2-22). Evidence: `docs/testing/M2-RESULTS.md` (YES/NO check in its section 4). Teaching text: `docs/walkthrough/M1.md`, `docs/walkthrough/M2.md`.

## Milestones

| Milestone | Flow | Estimate | Status |
|---|---|---|---|
| M0 | Foundations | 4.5 d | Merged (PR #1, #2). Two NOs accepted |
| M1 | Flow 1: Browse destinations | 11 d | Merged (PR #3, #4) |
| M2 | Flow 2: Upload and distribute | 13 d | Merged (PR #5). Verified on dev. 12 accepted NOs (M2-RESULTS 4.3) |
| M3 | Flow 3: Track a job | 7 d | Built and tested locally on branch `m3`; AWS round, browser checks and the pull request still to do |
| M4 | Flow 4: Download a file | 2 d | Not started |
| M5 | Hardening and end-to-end checks | 2 d | Not started |

## What M2 did

- **DocBeam API:** `POST /uploads` (single-part presigned POST with the SHA-256 signed in), multipart start, re-sign and complete, `GET /files?ids=`, `POST /jobs` (every check, one transaction, repeat-safe by Idempotency-Key, message after commit).
- **Upload Events Lambda** (container image with ClamAV): checks size and checksum against the row, scans, tags `scan-status=clean`, refuses and deletes infected files, writes `file.refused`. Daily rebuild workflow.
- **Queues and workers:** Job, Task and Upload Events queues with DLQs; Fan-out, Delivery (claim, checksum, service token, error classes, retry gaps, job row lock), DLQ Consumer, Sweeper (re-send each minute, daily cleanup). Delivery capped at 50, Upload Events at 10.
- **Platform:** drains for 120 s on a deploy; ingest limited to 6 files at once with a 503 after 30 s waiting; 1 vCPU / 2 GB (D-M2-22).
- **Web app part 2:** file picker, SHA-256 in a Web Worker, upload queue (resume, 13-minute link refresh), mapping with live task count, Review, sandboxed Preview, Send, leave warning, favicon.
- **Infra:** modules `sqs`, `lambda`, `alarms`, `scheduler`; four alarms and an SNS topic; Lambda and image deploy scripts and jobs that skip safely.
- **Tests:** 334 unit and web tests (53 files), 129 integration tests (15 files), all green. On dev: checksum from real S3, CORS per method, swapped body refused by S3, EICAR refused, outage drain, 50-delivery stress, DLQ path.

## What M1 did

- **Auth Service:** register, login, RS256 tokens with `kid`, JWKS and OpenID configuration, refresh rotation with reuse detection, logout, the 5-wrong-password pause, service tokens, internal user lookup, four service clients upserted by the migrate task, a support script to end a pause.
- **Document Platform:** schema, four browse routes with membership in each query, destination check, user teams, `POST /documents` (repeat-safe ingest), seed script and files (demo and 50-team load).
- **DocBeam API:** service and full DocBeam DB schema, with an append-only audit trail for the app role.
- **Public edge:** API Gateway HTTP API, JWT authorizer, VPC Link, ten routes listed one by one, throttles, CloudFront `/api/*` with the prefix stripped.
- **Web app:** register, sign in, quiet refresh with Web Locks, 12-hour dialog, lazy destination tree, up to 20 destinations.
- **Infra:** modules `alb`, `ecs-service`, `api-gateway`; scripts `run-task.sh`, `check-internal.sh`, a seed step in `deploy-service.sh`.

## Decisions taken in M2 (see `docs/DECISIONS.md`)

D-M2-1 `image_tag` stays optional, one-off tasks run marked revisions; D-M2-2 alarms and `ALARM_EMAIL`; D-M2-3 file age from `created_at`; D-M2-4 503 on submit and same-key retry; D-M2-5 Lambda secrets by ARN; D-M2-6 Lambdas from a placeholder, code by script; D-M2-7 checksum encodings; D-M2-8 mismatched upload refused and deleted; D-M2-9 concurrency of the smaller Lambdas; D-M2-10 web libraries; D-M2-11 presigned links locally; D-M2-12 ClamAV scan limits; D-M2-13 daily rebuild skips while dev is down; D-M2-14 working rule for a large milestone; D-M2-15 a missing S3 checksum fails delivery on AWS; D-M2-16 a push follows each final status only; D-M2-17 platform draining; D-M2-18 Terraform for the async half; D-M2-19 Upload DLQ writes `file.refused`; D-M2-20 web upload and preview choices (no Send bar summary, leave warning whenever files are unsent); D-M2-21 demo user Anantim Patil; **D-M2-22 platform ingest limiter, 5 MB upload parts and 1 vCPU / 2 GB, after the dev out-of-memory finding (a deviation from TDD Step 1.4; the platform is a stand-in and the real platform's capacity is the client's to confirm)**.

## Decisions taken in M1 (see `docs/DECISIONS.md`)

D-M1-1 local secrets and signing key; D-M1-2 ALB listener per service, plain HTTP (accepted risk); D-M1-3 seed format; D-M1-4 seed users; D-M1-5 first-bytes check; D-M1-6 ingest field order; D-M1-7 pause details; D-M1-8 new tab refresh; D-M1-9 tree; D-M1-10 DB connection parts; D-M1-11 web tests; D-M1-12 CORS origins and the CloudFront page rewrite; D-M1-13 authorizer switch, native bcrypt, bigger auth task; D-M1-14 image tag default, seed as its own compose run, deploy guards; D-M1-15 deploys skip when the service already runs the image.

## Set up so far

- AWS account `346208529537`, region `ap-southeast-2`, Free plan, credits end 2027-04-13.
- State bucket `docbeam-tfstate-346208529537`. Deploy user `docbeam-github-deploy`, GitHub secrets and variables `AWS_REGION`, `TF_STATE_BUCKET`, environments `dev` and `prod`.
- Dev is **DOWN** (brought up and checked 2026-10-16, destroyed the same day after the merge). Terraform state is empty; `aws s3 ls` shows only `docbeam-tfstate-346208529537`; no ECS cluster, ECR repository, Lambda or RDS instance is left. The last dev app was `https://d20vwpie25gfdb.cloudfront.net`; a new bring-up gives a new address (README "Build dev"). Last tags: services `e1ff11c2506a`, platform `ce2d4a97030e`, upload-events `cf4b70e89ead`.
- **Teardown needs one extra step** (D-M2-23): `terraform destroy` fails on the two data buckets once they hold many versions (`bufio.Scanner: token too long`). Empty `docbeam-dev-object-store-<account id>` and `docbeam-dev-platform-files-<account id>` with the AWS CLI first (all versions and delete markers, 1,000 at a time), never the tfstate bucket, then destroy. A script for this is proposed for M3.
- Set: `ECS_DEPLOY_ENABLED=true`, `LAMBDA_DEPLOY_ENABLED=true` (the person set it before the M2 merge), `INFRA_APPLY_ENABLED=false` (keep `false` while dev is down), `ALARM_EMAIL`. With dev down the deploy jobs skip with a notice.

## Known issues

- **No live push on AWS until M3.** Delivery logs `WS_MANAGEMENT_ENDPOINT is not set; no pushes`, and its role has no `execute-api:ManageConnections`. The WebSocket API is M3, Step 3.2.
- **`/favicon.ico` answers 403 on dev.** The web app has `favicon.svg` and the `<link rel="icon">`, so browsers do not ask for `/favicon.ico`. A binary `.ico` cannot be written with the Write tool. To fix: put a real `favicon.ico` in `web/public` (or map `/favicon.ico` to the SVG in the CloudFront `spa` function).
- **The platform is a stand-in.** D-M2-22 sizes it (1 vCPU / 2 GB, 6 ingests at once, 503 after 30 s). The real platform's ingest capacity is for the client to confirm.
- **The `task-dlq-not-empty` alarm did not fire** when 14 and 50 tasks went through the Task DLQ: the DLQ Consumer emptied the queue before the alarm's one-minute evaluation. The alarm is wired and `OK`.
- **`POST /jobs` 500 ms p99** is measured in M5 (check 5.1). From a laptop outside AWS a job took 0.86 to 0.97 s including a new TLS connection.
- **The daily Upload Events rebuild** has not yet run against dev (it needs the merge and `LAMBDA_DEPLOY_ENABLED`).
- **Uploads:** 4 in parallel; the parts of one file go one after another. A failed file shows Retry and Remove together (the mockup shows Retry alone).
- `terraform init -upgrade` moved the AWS provider to 6.69.0.
- **Images:** `push-image.sh` must build with `--provenance=false --sbom=false` (it does now). ECR tags are immutable, so an image pushed the wrong way needs a new tag.
- **Prod bring-up is not a one-click workflow.** The `infra` workflow's prod job runs one `terraform plan` and `apply` with `jwt_authorizer_enabled` at its default `true`. On a brand-new prod that apply fails at the authorizer exactly as dev did (D-M1-13), and the repositories, images, bootstrap tasks and signing key have to exist in a set order. Prod is not deployed in this project (README "Prod"); the M5 plan records that.
- **After the first apply, task definitions in Terraform carry the image `bootstrap`** (D-M1-14) unless `image_tag` is passed. Running `scripts/run-task.sh` on a family needs a `deploy-service.sh` first.
- The first-time `terraform apply` for the web distribution can take 3 minutes and the VPC Link 2 minutes. A full first apply of dev took about 25 minutes (229 resources).
- Internal traffic is plain HTTP inside the VPC (D-M1-2, accepted).
- The M0 items still stand: no RDS Proxy in dev (D-M0-6), the deploy user has AdministratorAccess, GitHub Free has no required reviewer for prod (D-G3), `npm audit` shows four moderate findings in drizzle-kit's dev chain.
- Deploy jobs skip with a notice when the service, function or environment does not exist, or already runs the image (D-M1-14, D-M1-15). A manual run of a workflow from `main` with `force` redeploys dev.
- Credits are limited. Dev costs about 4.5 USD a day while up.

## UI polish (after M4)

Noted by the person after the M2 browser runs (2026-10-16). Not done in M2.

- No horizontal scroll in the Documents table: truncate long names with a tooltip, fold Size into the name line.
- The destinations column shows a count ("3 folders") with a popover listing every path; "+N" chips must not hide information.
- Short status pills, with the details in a tooltip.
- One accent colour; red only for errors, amber only for warnings.
- Fewer repeated hints (step indicator, "or select files below...").
- Tooltips and consistent sizes on all icon buttons; Remove less prominent than Retry.
- After a reload, restore files that were already uploaded and verified (from sessionStorage and `GET /files`), so only the mapping and the sending need redoing. Today the leave warning (D-M2-20) only protects the batch; it cannot save it.

## How to run it

```bash
scripts/local-env.sh
docker compose up -d --build --wait    # rebuild after any service or worker change
docker compose run --rm seed
npm run lint && npm run typecheck && npm test && npm run build
npm run test:integration
npm run dev -w @docbeam/web      # http://localhost:5173
```

Dev on AWS: the README "Build dev" block and `docs/testing/M2-TESTING.md` sections 2 and 3. Gotchas: use absolute paths in Bash; `packages/shared/dist` is stale until `npm run build`; Compose services must run `exec node` to get SIGTERM (D-M2-17); the job tests deliver documents into the Cardio binder, so no test may expect an empty folder level; a test that stops a container must start it again in `finally`; the web upload queue (`web/src/upload/manager.ts`) must not import the session module, because the integration test runs it in Node; `terraform apply` needs `-auto-approve` when it has no terminal.

## Next: M3 (Track a job)

M3 needs from the person:
- a yes before each dev apply, image push and task run, as before;
- the M3 plan to include the teardown helper of D-M2-23 (`scripts/empty-dev-buckets.sh`, or a dev-only lifecycle rule), so the next destroy does not stop on the data buckets;
- a new dev bring-up for the M3 AWS checks (README "Build dev": push images with the provenance flag, two-step apply, bootstrap, signing key, deploys, confirm the SNS email again).

M3 builds on:
- the `tasks`, `jobs` and `ws_connections` tables and the audit trail from M1 and M2;
- Delivery's and the DLQ Consumer's push code (`packages/shared/src/push.ts`, `task-outcome.ts`), which already posts to subscribers and deletes dead connections; it only needs `WS_MANAGEMENT_ENDPOINT` and `execute-api:ManageConnections` once the WebSocket API exists (Step 3.2);
- `ws-local` and the worker runtime for local checks;
- the Status page the web app does not have yet (after Send the page only shows the toast);
- Step 3.1 endpoints: `GET /jobs`, `GET /jobs/:jobId`, `GET /jobs/:jobId/tasks`, `POST /jobs/:jobId/cancel` and `/retry`, `GET /audit`, with the team visibility rules.
