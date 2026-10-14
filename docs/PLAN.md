# DocBeam build plan

This plan builds DocBeam from M0 to M5, in the order of the milestones and steps in `docs/design/05-technical-design.md` (the TDD). It was written at kickoff on 2026-10-14 and approved the same day.

Sources, in order of precedence: the TDD, then `04-adrs.md`, then `02-blueprint.md`, then `03-user-flows.md`, then `01-design-requirements.md`. `AGENTS.md` sets the working rules. `docs/DECISIONS.md` records every agreed change to the design. Where it disagrees with `docs/design/`, it wins.

## How every milestone runs

1. Fresh session. Read `docs/STATUS.md`, this file and the milestone's TDD steps. Write the milestone plan (one task per line, inputs, outputs, check, expected AWS cost), then wait for approval.
2. Work on branch `m{n}`. Commit after each task.
3. Unit tests for the logic the TDD testing strategy lists. Integration tests on Docker Compose with LocalStack.
4. Write `docs/testing/M{n}-TESTING.md` (local, deploy to dev, verify on dev, prod later, tear down). Run sections 1 to 3, asking before every AWS change. Record the evidence in `docs/testing/M{n}-RESULTS.md`.
5. Final check: every requirement of the milestone prompt and TDD steps gets YES or NO, with evidence. One NO means the milestone fails.
6. Update `docs/STATUS.md`, push `m{n}`, run `gh pr create` to `main`. Tell the person what to check, which switch to turn on, and the teardown command (`terraform -chdir=infra/envs/dev destroy`).

Never apply or deploy to prod from a session. Prod runs only through the GitHub workflow after M5, on the Paid plan (see D-G3 in `docs/DECISIONS.md`).

## Fixed values

| Item | Value |
|---|---|
| AWS account and region | `346208529537`, `ap-southeast-2` (Sydney) |
| AWS plan | Free plan, 100 USD credits at kickoff, ends 2027-04-13 |
| State bucket | `docbeam-tfstate-346208529537` (repo variable `TF_STATE_BUCKET`), `use_lockfile = true`, no DynamoDB |
| GitHub | `Anantim/docbeam`, repository secrets `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (deploy user `docbeam-github-deploy`), variable `AWS_REGION`, environments `dev` and `prod` (main only) |
| Switches (repo variables) | `INFRA_APPLY_ENABLED` (from M0), `ECS_DEPLOY_ENABLED` (from M1, also gates the web deploy), `LAMBDA_DEPLOY_ENABLED` (from M2), `ALARM_EMAIL` (set by the person before M2) |
| Stack | TypeScript strict, ESM, Node 22, npm workspaces, Fastify, Drizzle and drizzle-kit, vitest, esbuild, React with Vite, PostgreSQL 16, Terraform |
| Architecture | x86_64 everywhere (ECS, Lambda, images) |
| Local ports | auth 3001, platform 3002, docbeam-api 3003, ws-local 3004, web 5173, Postgres 5432, LocalStack 4566, ClamAV 3310 |
| Public API path | Browser calls `https://<cloudfront>/api/*`. A CloudFront Function strips `/api` before API Gateway (D-G5) |
| Sizes | 1 GB = 1 GiB; multipart above 100 MiB; part size 16 MiB |

## Decisions taken at kickoff

All gaps found at kickoff, with their answers. The ones that change the design are written up in `docs/DECISIONS.md` (D-G numbers match).

| # | Topic | Answer |
|---|---|---|
| G1 | Deploy user, secrets, variables, environments | Made by hand by the person on 2026-10-13. A manual bootstrap step next to the state bucket. Deploy user has AdministratorAccess (known issue) |
| G2 | Repository or environment secrets | Repository secrets |
| G3 | Prod gate | `workflow_dispatch` from `main` only, required input `deploy-prod`, `prod` environment. Never on push or merge |
| G4 | Dev apply on merge | Only while `INFRA_APPLY_ENABLED` is `true` |
| G5 | One site for the refresh cookie | CloudFront forwards `/api/*` to API Gateway. A CloudFront Function strips `/api`. Cookie `Path=/api/auth` |
| G6 | People's names | `name` claim in user tokens, `jobs.submitted_by_name`, actor name and email in `audit_events.detail` |
| G7 | Destination names | `POST /destinations/check` returns `teamName` and `path`. Stored as `tasks.destination_path` |
| G8 | Append-only audit | Owner role (runs migrations, no login) and app role per database. The DocBeam app role has INSERT and SELECT only on `audit_events` |
| G9 | Multipart event before `complete` | Upload Events Lambda waits 30 s (ChangeMessageVisibility) when `s3_checksum` is not set yet |
| G10 | Service client secrets | Migrate task upserts the four clients from injected secrets, hashed with SHA-256 |
| G11 | Bootstrap tasks and `ecr` | M0 adds the `ecr` module and the ECS cluster and runs the DB bootstrap task. The signing key task runs in M1 |
| G12 | Alarms | DLQ alarms in Steps 2.1 and 2.3, Delivery alarm in 2.4 (Errors / Invocations over 1% for 15 min). SNS email from `ALARM_EMAIL` |
| G13 | Retry and audit routes | Built in Step 3.1 |
| G14 | Web deploy switch | Uses `ECS_DEPLOY_ENABLED` |
| G15 | Mapping screen | As the mockup: pick files, tick folders, Review |
| G16 | Mockup extras | No demo controls or system activity panel. Audit actions as the TDD lists them. Job ID shown as the first 8 characters of the UUID |
| G17 | Register | Register card styled like sign-in. Password 12 to 72 bytes. 400 VALIDATION_ERROR, 409 REGISTRATION_FAILED for an email in use |
| G18 | Seed users and prod seed | One generated dev seed password (Secrets Manager on AWS, `.env` locally). Prod seed waits for the client's hierarchy |
| G19 | Throttling | Default 50 req/s, burst 100. `/auth/login` and `/auth/refresh` 5 req/s, burst 10 |
| G20 | LocalStack | Check in M0 whether an auth token is needed. Checks LocalStack cannot enforce are proved on dev |
| G21 | Local routing | Vite dev server proxies `/api/*` to the services and strips `/api` |
| G22 | Failover drill | Dev RDS switched to Multi-AZ for the M5 drill only, then back |
| G23 | Remove a member before delivery | Pause the Task Queue trigger, re-run the seed, resume the trigger |
| G24 | Client open questions | TDD's current answers kept for v1 |
| G25 | Credits | Dev up only while testing. Expected spend stated in each milestone plan |

Small choices: one `task.failed` audit event per cancelled or fan-out-failed task; previews logged as `download.issued` with `detail.mode = "preview"`; multipart complete uses ListParts for part sizes and checksums; one scanner interface (clamd over TCP locally, `clamscan` in Lambda); Terraform deploys each Lambda once from a local build, CI updates code after that; citext, GRANTs and partial indexes in custom SQL migrations; API and WebSocket URLs set at web build time; DOCX preview with `docx-preview`, XLSX with ExcelJS (confirmed in M4); `GET /jobs` page size 20, at most 100.

## Cost per milestone (dev, while up)

| Milestone | What runs in dev | Rough cost while up |
|---|---|---|
| M0 | VPC, 1 NAT, RDS `db.t4g.micro`, RDS Proxy, buckets, CloudFront, ECR, ECS cluster | about 3 USD a day |
| M1 to M4 | M0 plus ALB, 3 Fargate tasks, API Gateway, Lambdas, queues | about 4 to 5 USD a day |
| M5 | M4 plus load runs, Multi-AZ during the failover drill | about 5 to 6 USD a day |

Tear dev down at the end of every AWS testing round unless the person wants it kept up.

---

## M0: Foundations (4.5 d), branch `m0`

Demo: infra live in dev, pipelines green, local stack runs.

**0.1a Monorepo and tooling**
- Inputs: TDD "Repository layout", "Rules for implementation"; AGENTS.md "Style"; existing `.gitignore`.
- Outputs: root `package.json` (workspaces), `tsconfig.base.json` (strict, ESM, Node 22), ESLint flat config, vitest config, `.env.example` (names and safe local defaults only), `README.md` (what it is, run locally, deploy, folder map), the layout folders.
- Check: `npm install`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` pass.
- You: nothing.

**0.1b `packages/shared`**
- Inputs: TDD Auth Service contract (claims, `token_use`, RS256, `kid`), error shape, ADR-013.
- Outputs: JWT check as a Fastify plugin (JWKS fetch and cache, `iss`, `aud`, `exp`, `token_use`, scopes); error shape helper; shared types (task statuses, failure codes, error codes); unit tests for token checks.
- Check: vitest green.
- You: nothing.

**0.1c Service skeletons**
- Inputs: TDD layout, ADR-006, ADR-009.
- Outputs: `services/auth`, `services/platform`, `services/docbeam-api`: Fastify app, `/health`, config from env, Drizzle setup, `migrations/`, a migrate entrypoint; the shared service Dockerfile in `docker/`.
- Check: each `/health` answers 200 in Compose.
- You: nothing.

**0.1d Workers, worker runtime, ws-local**
- Inputs: TDD Step 0.1, ADR-011, WebSocket API contract.
- Outputs: handler skeletons in `workers/fanout`, `delivery`, `upload-events`, `dlq`, `ws`, `sweeper`; `packages/worker-runtime` (polls LocalStack queues, calls the handler, honours `batchItemFailures` and visibility changes, runs the sweeper on a timer); `ws-local` (WebSocket server plus a `POST /@connections/{id}` endpoint shaped like the API Gateway management API).
- Check: each handler logs a test message in Compose.
- You: nothing.

**0.1e Docker Compose**
- Inputs: TDD Step 0.1; G8, G20, G21.
- Outputs: `docker-compose.yml` with Postgres 16 (init script: 3 databases, owner and app roles), LocalStack (Object Store and Platform File Store buckets, 6 queues with redrive, `staging/` event to the Upload Events Queue), `clamav`, `workers`, `ws-local`, the three services, all with healthchecks; `docker/` init scripts.
- Check: `docker compose up` brings every container to healthy.
- You: a free LocalStack auth token in `.env`, and as a GitHub secret, if G20 shows one is needed.

**0.2a State bucket**
- Inputs: ADR-012; AGENTS.md "Terraform state"; `TF_STATE_BUCKET`.
- Outputs: `bootstrap/create-state-backend.sh`. It checks first, then creates the bucket: versioned, encrypted, Block Public Access, TLS only, readable only by `anantim-admin` and `docbeam-github-deploy`. README notes the manual deploy-user step (G1).
- Check: `aws s3api get-bucket-versioning`, `get-bucket-encryption`, `get-public-access-block`.
- You: say yes before the script runs.

**0.2b Terraform modules and envs**
- Inputs: TDD Step 0.2 (network, rds, ecr, s3, CloudFront, account plan, secrets); ADR-003, ADR-009; G5, G11.
- Outputs: `infra/modules/network` (2 AZs, private subnets, one NAT in dev and one per AZ in prod, S3 gateway endpoint); `rds` (PostgreSQL 16, single-AZ `db.t4g.micro` in dev, Multi-AZ in prod, KMS storage, RDS Proxy, one secret per role, RDS-managed master password); `ecr`; `s3` (Object Store: SSE-KMS with the AWS key and Bucket Keys, Block Public Access, TLS only, role allow-list, clean-tag rule, 33-day expiry, 7-day multipart cleanup, CORS for the CloudFront origin exposing ETag, event to the Upload Events Queue once it exists; Platform File Store: same encryption, versioning, 90-day old versions, DeleteObjectVersion denied; web bucket); `cloudfront` (web app; the `/api/*` behaviour is added in Step 1.4); ECS cluster; generated secrets (`random_password`, an empty signing-key secret); `infra/envs/dev` and `infra/envs/prod` that only call modules.
- Check: `terraform fmt -check`, `terraform validate`, `terraform plan` for dev.
- You: nothing yet.

**0.2c DB bootstrap task and scripts**
- Inputs: TDD Step 0.2 (databases and roles by a bootstrap task); G8.
- Outputs: the DB bootstrap script (3 databases, owner and app roles, citext), run as a one-off ECS task; `scripts/push-image.sh`; `scripts/deploy-web.sh`.
- Check: runs locally against Compose. On dev, the task log shows the databases and roles created.
- You: say yes to the image push, the dev apply (about 3 USD a day while up) and the task run.

**0.3a Service and web workflows**
- Inputs: TDD Step 0.3; AGENTS.md switches; G14.
- Outputs: one workflow each for auth, platform, docbeam-api and web, filtered by path. Lint, test and Docker build always. Push to ECR tagged with the git SHA, migrate task and ECS update (web: S3 sync and CloudFront invalidation) only when `ECS_DEPLOY_ENABLED` is `true`. Prod deploy jobs follow the G3 rule.
- Check: green on the pull request, with deploy jobs skipped.
- You: nothing.

**0.3b Worker workflows**
- Inputs: TDD Step 0.3; ADR-016.
- Outputs: worker workflow (esbuild bundles, Lambda code update only when `LAMBDA_DEPLOY_ENABLED` is `true`); Upload Events image build; the daily scheduled rebuild with fresh ClamAV definitions.
- Check: green, with deploy jobs skipped.
- You: nothing.

**0.3c Infra and CI workflows**
- Inputs: TDD Step 0.3, "Testing strategy"; G3, G4.
- Outputs: infra workflow (fmt, validate, plan posted on the pull request; dev apply on merge only when `INFRA_APPLY_ENABLED` is `true`; prod plan and apply only by `workflow_dispatch` from `main`, `github.ref` checked, input equal to `deploy-prod`, `prod` environment); CI workflow (lint, typecheck, unit tests, integration tests on Compose, gitleaks); rollback steps in the README.
- Check: Actions green; gitleaks clean.
- You: create the repo variable `INFRA_APPLY_ENABLED` (`false` while dev is down).

**M0 close.** `docs/testing/M0-TESTING.md`, `M0-RESULTS.md`, YES/NO check, STATUS, pull request, teardown reminder.

## M1: Browse destinations (11 d), branch `m1`

Demo: a user registers, logs in and browses only their own teams, binders and folders.

**1.1a Auth DB, register, login, pause**
- Inputs: TDD "Auth DB", Auth Service contract, Step 1.1; ADR-015; G6, G17.
- Outputs: migrations for `users`, `service_clients`, `refresh_tokens`; `POST /auth/register` (bcrypt cost 12, G17 errors) and `POST /auth/login` (constant-time compare, same 401 for every failure, 15-minute pause after 5 wrong passwords in a row).
- Check: unit tests for counting wrong passwords; integration tests for register and login.
- You: nothing.

**1.1b Tokens and keys**
- Inputs: TDD token claims; ADR-013; G5 (issuer `https://<cloudfront>/api`), G6 (`name` claim).
- Outputs: RS256 signing with `kid`, key from Secrets Manager (from `.env` locally); `/.well-known/jwks.json`, `/.well-known/openid-configuration`; the signing-key bootstrap task.
- Check: unit tests for issuing and checking tokens (`iss`, `aud`, `token_use`).
- You: say yes to the bootstrap task run on dev.

**1.1c Refresh and logout**
- Inputs: ADR-015; G5.
- Outputs: `POST /auth/refresh` (new token on every use, reuse revokes the family), `POST /auth/logout`, cookie `Secure; HttpOnly; SameSite=Strict; Path=/api/auth`, 12 hours.
- Check: unit tests for rotation and reuse detection.
- You: nothing.

**1.1d Service tokens and user lookup**
- Inputs: ADR-013; TDD service clients table; G10.
- Outputs: `POST /auth/token` (SHA-256 secret check, scopes), `GET /internal/users?email=`, the client upsert in the migrate task.
- Check: integration tests.
- You: nothing.

**1.1e Auth on AWS**
- Inputs: TDD Step 1.1; ADR-001.
- Outputs: `alb` module (internal) and `ecs-service` module; Auth with 1 task in dev and 2 in prod, target group and health check; a one-off curl task to check from inside the network.
- Check: target group healthy; `/health` answers from inside the network.
- You: say yes to the apply.

**1.2a Platform schema and routes**
- Inputs: TDD "Platform DB", Document Platform contract; flows "Who can see what"; G7.
- Outputs: migrations; `GET /teams`, `GET /teams/:teamId/binders`, `GET /binders/:binderId/contents`, `GET /folders/:folderId/contents` (membership checked inside each query, 404 otherwise); `POST /destinations/check` (with `teamName` and `path`) and `GET /users/:userId/teams`.
- Check: integration tests, including 404 for another team's binder.
- You: nothing.

**1.2b Seed**
- Inputs: TDD Step 1.2; the mockup's teams, binders, folders and users; G18.
- Outputs: `services/platform/seed/`: script, demo seed file (Cardio, Oncology, Neuro; Priya, Raj, Sam), dev load file (50 teams with nested folders). Safe to re-run, prunes memberships, skips unknown emails with a warning, runs as a deploy step.
- Check: two runs in a row change nothing; the warning appears for an unknown email.
- You: say yes to the seed run on dev.

**1.3 Platform ingest**
- Inputs: TDD Step 1.3, `POST /documents` contract; ADR-013.
- Outputs: `POST /documents` (membership and destination check, repeat by `source_task_id`, first-bytes type check, streaming SHA-256 into `documents/{documentId}`, object deleted on a mismatch or a lost race, `ON CONFLICT DO NOTHING`).
- Check: integration tests for 201, 200 on repeat, 403, 404, 422 CHECKSUM_MISMATCH, 422 UNSUPPORTED_TYPE, two parallel repeats.
- You: nothing.

**1.4 Public edge**
- Inputs: TDD Step 1.4; ADR-001; G5, G19.
- Outputs: `api-gateway` module (HTTP API, JWT authorizer with issuer `https://<cloudfront>/api`, VPC Link to the ALB, every public route listed, CORS, throttling); in `cloudfront`, the `/api/*` behaviour (CachingDisabled, all methods, AllViewerExceptHostHeader so Authorization, cookies and query strings reach the origin) and the CloudFront Function that strips `/api`.
- Check: `curl https://<cloudfront>/api/teams` without a token gets 401 and the ALB request count does not move; the login cookie shows `Path=/api/auth; SameSite=Strict`; the quiet refresh works in the browser.
- You: say yes to the apply.

**1.5 DocBeam API skeleton**
- Inputs: TDD Step 1.5, "DocBeam DB"; G6, G7, G8.
- Outputs: the service with the full DocBeam DB schema (files, jobs with `submitted_by_name`, tasks with `destination_path`, ws_connections, audit_events with app-role grants), health check, deployed behind the ALB.
- Check: migrations run against a database that already holds seed data; `/health` from inside the network.
- You: nothing.

**1.6 Web app part 1**
- Inputs: TDD Step 1.6; flow 1; mockup sign-in, shell and Destinations panel; G5, G16, G17, G21.
- Outputs: `web/` (React and Vite): register and sign-in; access token in sessionStorage; quiet refresh a minute before expiry with Web Locks and BroadcastChannel; one refresh on a 401, then the dialog; the 12-hour sign-in dialog; the app shell; the lazy destination tree with filter and up to 20 destinations; Vite proxy for `/api`. Deployed to S3 and CloudFront.
- Check: by hand locally and on dev; two users in different teams see different trees.
- You: set `ECS_DEPLOY_ENABLED=true` when told.

**M1 close.** As M0.

## M2: Upload and distribute (13 d), branch `m2`

Demo: pick files, upload, map, submit, see documents land in the platform, including stopping the platform mid-run and watching the backlog drain.

Reminder for the M2 plan: **the person sets the repo variable `ALARM_EMAIL` before M2's first apply** (G12), then confirms the SNS email.

**2.1a Upload routes**
- Inputs: TDD Step 2.1, DocBeam API contract, multipart notes; ADR-002, ADR-004.
- Outputs: `POST /uploads` (presigned POST: size, exact type, `x-amz-checksum-sha256`, 15 minutes), `POST /files/:fileId/multipart-uploads`, `.../:uploadId/parts`, `.../:uploadId/complete` (ListParts), `GET /files?ids=`.
- Check: unit tests for the POST policy and part signing; integration tests for single and multipart uploads.
- You: nothing.

**2.1b Upload Events and scanning**
- Inputs: TDD Step 2.1; ADR-016; G9, G12.
- Outputs: Upload Events Lambda as a container image with ClamAV (scan limits 1 GB); size and checksum check, clean tag, conditional update, delete of an infected file, `file.refused`; Terraform for the Upload Events Queue and DLQ, the S3 event, the Lambda (3,008 MB, 10 GB storage, 600 s, batch 1, max concurrency 10, queue visibility 3,600 s), the Upload DLQ alarm; the daily rebuild wired to the Lambda.
- **Carried over from M0 (accepted NO, 2026-10-14):** Step 0.1 says the Upload Events handler scans through the `clamav` container locally, and M0 built only the container, the image and a handler that logs. This task must deliver the scanning logic behind one scanner interface (clamd over TCP in Compose, `clamscan` in Lambda), so the EICAR test file is refused locally by the real ClamAV.
- Check: integration tests for the EICAR file refused by the real ClamAV and for a repeated event.
- **M2 YES/NO line (must be YES, or M2 fails):** "Locally, in Docker Compose, the EICAR test file is refused as infected by the real `clamav` container through the Upload Events handler. Carried over from M0 (Step 0.1)." Evidence: the integration test name and its output.
- You: say yes to the image push and the apply.

**2.2 Job submission**
- Inputs: TDD Step 2.2, `POST /jobs` contract, "Concurrency".
- Outputs: `POST /jobs` with every check and error code, Idempotency-Key, service token renewed in the background, one `POST /destinations/check`, one transaction (job, files claim, tasks by `unnest`, `job.submitted`), Job Queue message after commit.
- Check: unit tests for batch limits; integration tests for each error and a repeated key while the first request runs.
- You: nothing.

**2.3 Queues and Fan-out**
- Inputs: TDD Step 2.3; ADR-005, ADR-008; G12.
- Outputs: Terraform for Job Queue and Task Queue with DLQs (maxReceiveCount 3 and 5, 14 days, SSE-SQS), the `lambda` module, Fan-out Lambda (60 s, queue visibility 360 s), Job and Task DLQ alarms.
- Check: integration test for a redelivered job message.
- You: say yes to the apply.

**2.4 Delivery Lambda**
- Inputs: TDD Step 2.4, task status table, failure codes; ADR-011; G12.
- Outputs: claim; HEAD with checksum mode; cached service token with one retry on 401; stream to `POST /documents`; permanent and temporary errors as Step 2.4 lists; gaps of 30 s, 2, 5 and 10 minutes from the receive count; final write with the job row lock and audit event; pushes, deleting rows that return 410; trigger max concurrency 50; Delivery error alarm.
- Check: unit tests for the claim, job status and error sorting; integration tests for the same message twice, a temporary error back to pending, two last tasks finishing together, FILE_NOT_UPLOADED, CHECKSUM_MISMATCH, UNSUPPORTED_TYPE.
- You: nothing.

**2.5 DLQ Consumer and Sweeper**
- Inputs: TDD Step 2.5; ADR-014.
- Outputs: DLQ Consumer (all three DLQs; closes the job and pushes); Sweeper (re-send every minute; daily cleanup with multipart abort); two EventBridge Scheduler schedules.
- Check: integration tests for DLQ marking (tasks and a file) and the sweeper re-send.
- You: say yes to the apply.

**2.6 Web app part 2**
- Inputs: TDD Step 2.6; flow 2; mockup Distribute screen; G15, G16.
- Outputs: file picker with the allow-list and limits; SHA-256 in a Web Worker; 4 to 6 parallel uploads, links in waves of 20; multipart resume in the session; Checking, Verified, Refused; file scope and folder ticks; live delivery count; Review with Preview and remove; Send.
- Check: by hand locally and on dev, including stopping the platform mid-run.
- You: set `LAMBDA_DEPLOY_ENABLED=true` when told.

**M2 close.** As M0.

## M3: Track a job (7 d), branch `m3`

Demo: submit a job, watch counts and rows change live, see failure reasons inline, refresh mid-run without losing anything.

**3.1 Status, retry, cancel and audit endpoints**
- Inputs: TDD Step 3.1, DocBeam API contract, job status table; G13.
- Outputs: `GET /jobs`, `GET /jobs/:jobId`, `GET /jobs/:jobId/tasks` with the page count query and paging; team visibility with the 60-second cache; `POST /jobs/:jobId/retry`; `POST /jobs/:jobId/cancel` with the job_update push; `GET /audit`.
- Check: integration tests for cancel during a run, the retry window, and team-scoped jobs, tasks and audit events.
- You: nothing.

**3.2 WebSocket API and WS Handlers**
- Inputs: TDD Step 3.2, WebSocket contract; ADR-007.
- Outputs: WebSocket API in Terraform; WS Handlers for `$connect`, `subscribe`, `$disconnect` through RDS Proxy.
- Check: integration tests through ws-local; `wscat` on dev.
- You: say yes to the apply.

**3.3 Catch-up**
- Inputs: TDD Step 3.3.
- Outputs: web WebSocket client: connect, subscribe, then fetch; reconnect after every token refresh; refetch once on every reconnect; ignore pushes older than the row.
- Check: by hand, dropping the connection mid-run.
- You: nothing.

**3.4 Web app part 3**
- Inputs: TDD Step 3.4; mockup Status, job detail, Audit tab, Audit trail.
- Outputs: job list (Mine and My teams, 30-second refresh); job detail (virtualized table, status filter, reasons, Retry and Cancel for the sender, Audit tab, expired-file message); Audit trail page with filters.
- Check: by hand with two browsers on dev (sender and team viewer).
- You: nothing.

**M3 close.** As M0.

## M4: Download a file (2 d), branch `m4`

Demo: Preview shows the file in the page and Download saves it; anyone not allowed gets 404.

**4.1 Team-scoped download and preview**
- Inputs: TDD Step 4.1, `POST /files/:fileId/downloads` contract, "Retention"; ADR-002, ADR-004.
- Outputs: `POST /files/:fileId/downloads` (sender or delivered-team check, 404, 410 FILE_EXPIRED after 33 days, 2-minute GET link, attachment or inline, audit event); web viewer (PDF, PNG, JPG directly; DOCX and XLSX as a read-only page) and Download.
- Check: integration tests for allowed, not allowed, missing and expired; by hand as an outsider on dev.
- You: nothing.

**M4 close.** As M0.

## M5: Hardening and end-to-end checks (2 d), branch `m5`

Run against deployed dev. All must pass before any prod apply. Each check gets a re-runnable script in `scripts/m5-*`, its AWS change and cost in the M5 plan, and evidence in `docs/testing/M5-RESULTS.md`.

**Run M5 with the RDS Proxy on (D-M0-6).** The Free plan blocks RDS Proxy, so dev runs without it in M1 to M4. Before the M5 checks, the account moves to the Paid plan and dev is applied with `enable_rds_proxy = true`, so the release checks test the prod setup (Lambdas through the proxy). The M5 plan states the cost (the proxy adds about 0.85 USD a day) and asks first. The Lambda config needs only a new database host, with no code change.

| # | Check | How it is checked | You |
|---|---|---|---|
| 5.1 | 100 x 20 job accepted in under 500 ms at p99 | `scripts/m5-submit-load.sh`; p99 read from API Gateway and CloudWatch, not the laptop | nothing |
| 5.2 | Sender removed from one destination team: its 100 deliveries fail NOT_AUTHORIZED_AT_DELIVERY, 1,900 complete | Pause the Task Queue trigger, re-run the seed, resume (G23) | yes to the AWS change |
| 5.3 | Platform stopped 5 minutes mid-run: backlog drains, DLQ empty | Scale the platform service to 0, then back | yes |
| 5.4 | Never-uploaded file gets 422 FILE_NOT_READY; a file removed after submit fails only its tasks with FILE_NOT_UPLOADED | Script | yes (object delete) |
| 5.5 | Browse under 1 s for a user in 50 teams | Timed calls with the dev load seed | nothing |
| 5.6 | 1 GB multipart upload completes, checked by its combined checksum, delivered with a matching SHA-256 | Script | nothing |
| 5.7 | Team viewer sees only their team's deliveries and audit events, 404 for a file sent only to another team | Script and browser | nothing |
| 5.8 | Database failover during a run: deliveries pause, then finish | Dev RDS to Multi-AZ, reboot with failover, back to single-AZ (G22) | yes (about +0.6 USD a day while on) |
| 5.9 | EICAR refused as infected before submit, never downloadable | Script | nothing |
| 5.10 | Cancel mid-run: running deliveries finish, waiting ones CANCELLED, job reads cancelled | Script and browser | nothing |
| 5.11 | Refresh token used twice ends the sign-in; 5 wrong passwords pause sign-in for 15 minutes | Script | nothing |
| 5.12 | No-token calls get 401 at the gateway; cross-team download or preview 404; expired links fail; gitleaks clean | Script and CI | nothing |
| 5.13 | Job message dropped after commit: sweeper starts fan-out within 3 minutes | Disable the Fan-out trigger, submit, purge the Job Queue, re-enable the trigger, time the sweeper's re-send (no code change) | yes |
| 5.14 | Manual: slow-connection upload, multipart resume, WebSocket reconnect | Step-by-step in M5-TESTING.md | run them yourself |

Plus a failure-rate SQL script (system failures over all tasks, 7 days). STATUS gets a release summary. **Never prod.** After M5: move the account to the Paid plan, then the person runs the prod workflow (G3).
