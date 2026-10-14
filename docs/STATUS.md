# DocBeam status

Updated 2026-10-14, at the end of M1 (branch `m1`, pull request open).

**M1 is built and verified locally and on dev,** including the browser checks done by the person. A user can register, sign in and browse only their own teams, binders and folders. A request with no token gets 401 at the gateway; another team's binder gets 404. Dev AWS is **down** (destroyed on 2026-10-14 after the merge: 175 resources, nothing billable left). Plan: `docs/PLAN.md`. Decisions: `docs/DECISIONS.md` (D-M1-1 to D-M1-15). Evidence: `docs/testing/M1-RESULTS.md`. Teaching text: `docs/walkthrough/M1.md`.

## Milestones

| Milestone | Flow | Estimate | Status |
|---|---|---|---|
| M0 | Foundations | 4.5 d | Merged (PR #1, #2). Two NOs accepted |
| M1 | Flow 1: Browse destinations | 11 d | Built, 0 NO in the YES/NO check. PR #3 ready to merge by the person |
| M2 | Flow 2: Upload and distribute | 13 d | Not started |
| M3 | Flow 3: Track a job | 7 d | Not started |
| M4 | Flow 4: Download a file | 2 d | Not started |
| M5 | Hardening and end-to-end checks | 2 d | Not started |

## What M1 did

- **Auth Service:** register, login, RS256 tokens with `kid`, JWKS and OpenID configuration, refresh rotation with reuse detection, logout, the 5-wrong-password pause, service tokens, internal user lookup, four service clients upserted by the migrate task, a support script to end a pause.
- **Document Platform:** schema, four browse routes with membership in each query, destination check, user teams, `POST /documents` (repeat-safe ingest), seed script and files (demo and 50-team load).
- **DocBeam API:** service and full DocBeam DB schema, with an append-only audit trail for the app role.
- **Public edge:** API Gateway HTTP API, JWT authorizer, VPC Link, ten routes listed one by one, throttles, CloudFront `/api/*` with the prefix stripped.
- **Web app:** register, sign in, quiet refresh with Web Locks, 12-hour dialog, lazy destination tree, up to 20 destinations.
- **Infra:** modules `alb`, `ecs-service`, `api-gateway`; scripts `run-task.sh`, `check-internal.sh`, a seed step in `deploy-service.sh`.
- **Tests:** 93 unit and web tests, 75 integration tests, all green.

## Decisions taken in M1 (see `docs/DECISIONS.md`)

D-M1-1 local secrets and signing key; D-M1-2 ALB listener per service, plain HTTP (accepted risk); D-M1-3 seed format; D-M1-4 seed users; D-M1-5 first-bytes check; D-M1-6 ingest field order; D-M1-7 pause details; D-M1-8 new tab refresh; D-M1-9 tree; D-M1-10 DB connection parts; D-M1-11 web tests; D-M1-12 CORS origins and the CloudFront page rewrite; D-M1-13 authorizer switch, native bcrypt, bigger auth task; D-M1-14 image tag default, seed as its own compose run, deploy guards.

## Set up so far

- AWS account `346208529537`, region `ap-southeast-2`, Free plan, credits end 2027-04-13.
- State bucket `docbeam-tfstate-346208529537`. Deploy user `docbeam-github-deploy`, GitHub secrets and variables `AWS_REGION`, `TF_STATE_BUCKET`, environments `dev` and `prod`.
- Dev is **down**. Its last apply used image tag `2f825256fee7` and the app was `https://d2ii4puto0s1y9.cloudfront.net`; a new apply gives a new CloudFront address and needs the two-step bring-up in the README.
- Set: `ECS_DEPLOY_ENABLED=true`, `INFRA_APPLY_ENABLED=false` (keep `false` while dev is down). Not yet: `LAMBDA_DEPLOY_ENABLED` (M2), `ALARM_EMAIL` (before M2).

## Known issues

- **Prod bring-up is not a one-click workflow.** The `infra` workflow's prod job runs one `terraform plan` and `apply` with `jwt_authorizer_enabled` at its default `true`. On a brand-new prod that apply fails at the authorizer exactly as dev did (D-M1-13), and the repositories, images, bootstrap tasks and signing key have to exist in a set order. Prod therefore does **not** do the two-pass apply today. Before the prod apply (after M5), either add a `first_bring_up` input to the `infra` workflow that passes `-var jwt_authorizer_enabled=false` and add the bootstrap steps, or run the sequence in the README "Build dev" against prod by hand with the person's approval. Decide this in the M5 plan.
- **After the first apply, task definitions in Terraform carry the image `bootstrap`** (D-M1-14). Running `scripts/run-task.sh` on a family needs a `deploy-service.sh` first. The services themselves are unaffected.
- The first-time `terraform apply` for the web distribution can take 3 minutes and the VPC Link 2 minutes.
- Internal traffic is plain HTTP inside the VPC (D-M1-2, accepted).
- The M0 items still stand: no RDS Proxy in dev (D-M0-6), the deploy user has AdministratorAccess, GitHub Free has no required reviewer for prod (D-G3), `npm audit` shows four moderate findings in drizzle-kit's dev chain.
- The deploy jobs ran on the M1 merge against dev and were green. They skip with a notice when the service or the environment does not exist (D-M1-14), and since D-M1-15 they skip when the service already runs the image. A manual run of a service workflow from `main` with `force` redeploys dev.
- The M1 merge ran every workflow twice because the PR was merged twice (GitHub logged two `pr_merge` events). Both deploys succeeded. D-M1-15 makes a repeat harmless; it is on branch `fix-duplicate-runs`.
- The first image tag deployed on dev was `2d59b80efe69` for platform and docbeam-api; later builds share `2f825256fee7`. Same code.
- Credits are limited. Dev costs about 4.5 USD a day while up.

## How to run it

```bash
scripts/local-env.sh
docker compose up -d --build --wait
docker compose run --rm seed
npm run lint && npm run typecheck && npm test && npm run build
npm run test:integration
npm run dev -w @docbeam/web      # http://localhost:5173
```

Dev on AWS: `docs/testing/M1-TESTING.md` section 2 (two-step first apply). Tear down: `terraform -chdir=infra/envs/dev destroy -var image_tag=<tag>`.

## M2 progress (branch `m2`, started 2026-10-15)

Task list: `docs/PLAN.md` (M2 task list). Decisions: D-M2-1 to D-M2-14 in `docs/DECISIONS.md`. Rule (D-M2-14): commit after each task and update this section; do all local tasks first; **stop before the first AWS step and wait for the person.**

| Task | Status |
|---|---|
| 0 Branch, plan, decisions | done |
| 1 Shared building blocks | done: `packages/shared` has `limits`, `batch` (`validateBatch`), `checksum`, `file-types` (moved from platform), `service-token`, `secrets`, and a `@docbeam/shared/browser` subpath for the web. Error code `PLATFORM_UNAVAILABLE` added. 128 unit tests green |
| 2 Upload routes and `GET /files` | done: `POST /uploads`, multipart start, re-sign, complete, `GET /files` in `services/docbeam-api` (`routes/uploads.ts`, `routes/files.ts`, `s3.ts`). Integration `uploads.test.ts` (18 tests). Fastify `maxParamLength` raised (S3 upload ids are long). LocalStack 4.14 does not enforce the checksum of a presigned POST: the swapped-body refusal is a dev check (M2-TESTING 3); the Upload Events Lambda will hash the bytes itself (task 3). The ingest test now cleans up its top-level document so a second run passes |
| 3 Upload Events Lambda, scanner, EICAR | done: `workers/upload-events/src` (`scanner.ts` clamd INSTREAM and `clamscan`, `events.ts`, `process.ts`, `index.ts`); shared `sqs.ts` (visibility changer) and `lambda-db.ts`; Compose gives the workers `DATABASE_URL` and `CLAMD_HOST`, and clamd the 1100M limits. **Carried-over M0 line met:** integration test `upload-events: EICAR is refused as infected by the real ClamAV` passes (object deleted, row `infected`, one `file.refused`). The Lambda image builds and its `clamscan` flags EICAR (exit 1). 159 unit, 99 integration tests green |
| 4 `POST /jobs` | done: `routes/jobs.ts`, `platform.ts` (service-token client, 503 `PLATFORM_UNAVAILABLE`), `queue.ts`; docbeam-api now needs `JOB_QUEUE_URL`, `AUTH_URL`, `PLATFORM_URL`, `CLIENT_SECRET_DOCBEAM_API` (Compose sets them; Terraform in task 8). Integration `jobs.test.ts` (13 tests): 201, each error creates nothing, repeated and parallel same key, 100 files x 20 destinations, platform stopped then same key works. The 500 ms p99 target is measured on dev (M5 5.1). 178 unit, 111 integration tests green |
| 5 Fan-out | done: `workers/fanout/src/index.ts` (`fanOut`, `createHandler`); Compose gives the workers `TASK_QUEUE_URL`. Integration `fanout.test.ts` (job message and a redelivered one). 185 unit, 111 integration tests green |
| 6 Delivery, push, platform draining | done: `workers/delivery/src` (`classify.ts`, `multipart.ts`, `deliver.ts`, `index.ts`); shared `task-outcome.ts` (`finishTask`, `jobStatus`) and `push.ts` (`pushTaskUpdate`, `createPoster`); secrets `readField` returns a plain local value as is; Compose gives the workers `AUTH_URL`, `PLATFORM_URL`, `CLIENT_SECRET_DELIVERY_WORKER`, `OBJECT_STORE_BUCKET`, `WS_MANAGEMENT_ENDPOINT`, `S3_CHECKSUM_OPTIONAL`; services run `exec node`; platform drains idle connections on SIGTERM. D-M2-15 to D-M2-17. Integration `delivery.test.ts` (9) and `platform-drain.test.ts` (1); `platform.test.ts` no longer expects an empty top level (the job tests now deliver there). 241 unit, 120 integration tests green |
| 7 DLQ Consumer and Sweeper | done: `workers/dlq/src` (`process.ts` picks the action from the queue name: Task DLQ `finishTask` RETRIES_EXHAUSTED with `last_error`; Job DLQ `failPendingTasks` FANOUT_FAILED, one `task.failed` each, job closed, one batched push; Upload DLQ file `failed` while still `pending`, no audit event); `workers/sweeper/src` (`resend`: jobs with no fan-out and no end, 2 minutes after `queued_at`, up to 100 a run; `cleanup`: batched `DELETE ... RETURNING`, objects deleted, open multipart uploads aborted). `parseUploadEvents` moved to `packages/shared`; `pushTaskUpdates` batches pushes; Compose gives the workers `JOB_QUEUE_URL`. Integration `dlq-sweeper.test.ts` (9); `workers.test.ts` removed (its skeleton rows are covered). 255 unit, 129 integration tests green |
| 8 Terraform | done: modules `sqs`, `lambda`, `alarms`, `scheduler`; `infra/envs/{dev,prod}/async.tf`; S3 wiring (`upload_events_enabled`, role allow-list); `alb` `deregistration_delay` and `ecs-service` `stop_timeout` (platform 120 s); ECR keeps 3 upload-events images; DocBeam API task role, env, secret and six public routes; `TF_VAR_alarm_email` in the infra workflow. `terraform fmt`, `validate` (both envs) and a read-only dev `plan` (251 to add) pass. D-M2-18. **Not applied.** Known gap: Delivery's role has no `execute-api:ManageConnections` and `WS_MANAGEMENT_ENDPOINT` is unset until the WebSocket API exists (M3, Step 3.2), so no pushes on AWS yet |
| 9 Pipelines | done: `scripts/deploy-lambda.sh` (skips a missing function and an unchanged package hash or image URI; deterministic zip; `--force`; prod only in CI) with `tests/scripts/deploy-lambda.test.ts`; `scripts/run-task.sh` runs the newest revision that `deploy-service.sh` registered for service, migrate and seed, and the latest for signing-key (D-M2-1) with `tests/scripts/run-task.test.ts`; `workers.yml` deploys through the script, has a `force` input and a manual run from `main` deploys dev; `upload-events-image.yml` skips with a notice while dev is down (D-M2-13) and deploys through the script; README build order and rollback updated. 267 unit tests green |
| 10 Web app part 2 | done: `web/src/distribute` (`files`, `mapping`, `submit`), `web/src/upload` (`hashing` and `hash.worker` with `@noble/hashes`, `manager` the queue, `api`, `api-types`, `transport`, `browser-transport`, `instance`), `web/src/preview` (`render`, `office`) and components `Distribute`, `AddFiles`, `FileTable`, `Review`, `SendBar`, `Steps`, `Preview`, `useLeaveWarning`; `Destinations` has tri-state ticks, badges and the scope banner. Links in waves of 20, 4 uploads at once, 13-minute re-sign, resume, 2-second polling, Idempotency-Key reuse, sandboxed DOCX and XLSX preview, `beforeunload` while uploading. D-M2-20. Integration `web-upload.test.ts` runs the same queue in Node against Compose. 327 unit, 126 integration tests green |
| 11 Testing round (local part), `M2-TESTING.md`, `M2-RESULTS.md` | local part done: both documents written, section 1 evidence recorded, browser steps (1.3, 19 steps) **waiting on the person**; sections 2 and 3 not run (AWS) |
| 12 YES/NO check, walkthrough, STATUS, pull request | not started |

### Handover notes for the next session (written 2026-10-15 after task 10 and the local part of task 11)

- **State:** branch `m2`, local and not pushed. **Nothing in AWS has been touched** (one read-only `terraform plan` of dev, with `-lock=false`, in task 8). The Compose stack is up and healthy; after a worker or service change run `docker compose up -d --build --wait`. Last full runs: 327 unit tests (51 files), 126 integration tests (15 files), lint, typecheck, build, `terraform fmt` and `validate` (dev and prod) green.
- **Done at the start of this session:** Delivery's security group narrowed to the Auth and platform listeners (D-M2-18 updated); the Upload DLQ writes `file.refused` with `SCAN_FAILED` (D-M2-19). Task 10 decisions are in D-M2-20 (50 MB cap for DOCX and XLSX preview, sandboxed iframe, 400 and 403 as "Refused by storage", leave warning).
- **Waiting on the person (browser):** `M2-TESTING.md` section 1.3, steps 1 to 19. Record each as YES in `M2-RESULTS.md` section 1.3 only after the person reports it.
- **Next:** task 12 (YES/NO check against the milestone prompt and TDD steps, `docs/walkthrough/M2.md`, STATUS, push `m2`, `gh pr create`). The AWS block (`M2-TESTING.md` sections 2 and 3) runs when the person says yes; its results go into `M2-RESULTS.md` sections 2 and 3 before the YES/NO check is final.
- **Known gaps to list in the YES/NO check (honest NOs or accepted):** no push on AWS until M3 (no WebSocket API, no `execute-api:ManageConnections`, `WS_MANAGEMENT_ENDPOINT` unset); the 500 ms p99 is measured on dev (M5 5.1); the swapped-body refusal can only be shown on AWS (LocalStack); `terraform init -upgrade` moved the AWS provider to 6.69.0; the Documents table in the page shows Retry and Remove together on a failed file (the mockup shows Retry alone, which would leave a refused file that cannot be removed except with Clear); a part of a multipart file uploads one after another within one of the 4 slots (the TDD says "4 to 6 parallel uploads" and does not say whether parts run in parallel).
- **Gotchas:** use absolute paths in Bash (a stray `cd` changes the working directory for later calls); `packages/shared/dist` is stale until `npm run build`; Compose services must run `exec node` to get SIGTERM (D-M2-17); the job tests deliver documents into the Cardio binder, so no test may expect an empty folder level; integration test file order is not alphabetical, so a test that stops a container must start it again in `finally` and wait for it (see `platform-drain.test.ts`); the web upload queue (`web/src/upload/manager.ts`) must not import the session module, because the integration test runs it in Node (`web/src/auth/errors.ts` holds `ApiFailure` for that reason).
- **AWS:** none yet. The person runs the AWS block in the daytime (D-M2-14). Before it: `LAMBDA_DEPLOY_ENABLED` stays unset until the Lambdas exist; the person says yes to each image push, apply and task run.

## Next: M2 (Upload and distribute)

M2 needs from the person:
- the merge of the M1 pull request;
- `ECS_DEPLOY_ENABLED=true` (the browser check is done), and `LAMBDA_DEPLOY_ENABLED` when told;
- the repository variable `ALARM_EMAIL` set before M2's first apply, and the SNS email confirmed;
- a yes before each dev apply, image push and task run.

M2 also needs (decided 2026-10-14, D-M1-14 follow-up):
- **Draining.** Add a per-service `deregistration_delay` variable to the `alb` module (default 30 s) and a `stop_timeout` to `ecs-service`. The platform gets **120 s for the target group and 120 s `stopTimeout` in dev and in prod alike**, so dev tests the same draining as prod. The Delivery Lambda streams to `POST /documents` with a 100 s client limit (Step 2.4), and a 30 s drain would cut a long stream during a rolling deploy. Auth and docbeam-api stay at 30 s. Do it in the M2 step that makes Delivery call the platform (Step 2.4), with a test that a deploy during a long upload does not fail it.

M2 builds on: `ecs-service` (add task role rights for the DocBeam API), the `alb` and `api-gateway` modules (add the DocBeam API routes to `public_routes`), the DocBeam DB schema from 1.5, `POST /destinations/check` and the service token flow, the Upload Events handler skeleton (the scanner is task 2.1b, a carried-over item from M0).
