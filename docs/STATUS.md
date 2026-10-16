# DocBeam status

Updated 2026-10-16, at the end of M2 (branch `m2`, pull request open).

**M2 is built and verified locally and on dev,** including the browser checks done by the person (19 local steps, 9 dev steps). A user can pick up to 100 files, upload them (single-part and multipart), have them scanned for malware, map them to up to 20 folders, send them and see the documents arrive in the platform. Stopping the platform mid-run and starting it again drains the backlog (1,400 tasks, all delivered once). **Dev AWS is UP** (cost about 4.5 USD a day); the person merges while it is up and then tells me to destroy it. Plan: `docs/PLAN.md`. Decisions: `docs/DECISIONS.md` (D-M1-1 to D-M1-15, D-M2-1 to D-M2-22). Evidence: `docs/testing/M2-RESULTS.md` (YES/NO check in its section 4). Teaching text: `docs/walkthrough/M1.md`, `docs/walkthrough/M2.md`.

## Milestones

| Milestone | Flow | Estimate | Status |
|---|---|---|---|
| M0 | Foundations | 4.5 d | Merged (PR #1, #2). Two NOs accepted |
| M1 | Flow 1: Browse destinations | 11 d | Merged (PR #3, #4) |
| M2 | Flow 2: Upload and distribute | 13 d | Built, verified on dev. 13 accepted NOs (M2-RESULTS 4.3). Pull request open; the person merges while dev is up |
| M3 | Flow 3: Track a job | 7 d | Not started |
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
- Dev is **UP** (brought up 2026-10-16). App: `https://d20vwpie25gfdb.cloudfront.net` (distribution `E19G06V1T65GK8`). Image tags in use: auth, docbeam-api and db-bootstrap `e1ff11c2506a`; **platform `ce2d4a97030e`** (task definition `docbeam-dev-platform:12`, 1 vCPU / 2 GB); **upload-events `cf4b70e89ead`** (the first push, `e1ff11c2506a`, was an OCI index and Lambda refused it). Terraform's own service task definitions still name `e1ff11c2506a`; the services ignore that after the first apply. The SNS subscription for `ALARM_EMAIL` is confirmed. The web app on dev has the leave-warning change and the favicon.
- Set: `ECS_DEPLOY_ENABLED=true`, `INFRA_APPLY_ENABLED=false` (keep `false`: a merge must not apply infra), `ALARM_EMAIL`. **Not yet: `LAMBDA_DEPLOY_ENABLED`**; the person sets it to `true` before the merge so the `workers` and `upload-events-image` deploy jobs run once against dev.
- To destroy dev after the merge (the person decides when): `terraform -chdir=infra/envs/dev destroy -var image_tag=e1ff11c2506a -var upload_events_image_tag=cf4b70e89ead -var alarm_email="$(gh variable get ALARM_EMAIL)"`. In an agent session add `-auto-approve`, after the person agrees.

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
- the merge of the M2 pull request (with `LAMBDA_DEPLOY_ENABLED=true` set first, while dev is up), and then the word to destroy dev;
- a yes before each dev apply, image push and task run, as before.

M3 builds on:
- the `tasks`, `jobs` and `ws_connections` tables and the audit trail from M1 and M2;
- Delivery's and the DLQ Consumer's push code (`packages/shared/src/push.ts`, `task-outcome.ts`), which already posts to subscribers and deletes dead connections; it only needs `WS_MANAGEMENT_ENDPOINT` and `execute-api:ManageConnections` once the WebSocket API exists (Step 3.2);
- `ws-local` and the worker runtime for local checks;
- the Status page the web app does not have yet (after Send the page only shows the toast);
- Step 3.1 endpoints: `GET /jobs`, `GET /jobs/:jobId`, `GET /jobs/:jobId/tasks`, `POST /jobs/:jobId/cancel` and `/retry`, `GET /audit`, with the team visibility rules.
