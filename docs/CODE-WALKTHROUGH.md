# DocBeam Code Walkthrough

Read this top to bottom: it follows the order the code depends on itself, from shared rules to services, workers, the web app, then the machinery that runs and checks them. Every file in the repository is accounted for, either by name or as part of a named group. Last checked against the code on 20 October 2026 (`main` after the F1 round, PR #29, plus the F1 documents pull request).

## 0. The map

DocBeam is one npm workspace holding three web services, six Lambda workers, one React app and the Terraform that builds AWS around them. Every folder exists because one box in the architecture needs a home.

| Folder | What it is | Where it runs on AWS | Where it runs locally |
| --- | --- | --- | --- |
| `packages/shared` | Rules and helpers every other package imports | Inside each service and Lambda | Same |
| `packages/worker-runtime` | Pretends to be Lambda's SQS triggers and the WebSocket API | Never | `workers` and `ws-local` containers |
| `services/auth` | Accounts, sign-in, tokens | ECS Fargate service | `auth` container, port 3001 |
| `services/platform` | Stand-in for the client's Document Platform | ECS Fargate service | `platform` container, port 3002 |
| `services/docbeam-api` | Uploads, jobs, tracking, downloads, audit | ECS Fargate service | `docbeam-api` container, port 3003 |
| `workers/*` (6) | Fan-out, Delivery, Upload Events, DLQ Consumer, WS Handlers, Sweeper | Lambda | Inside `workers` / `ws-local` |
| `web` | The React single-page app | S3 behind CloudFront | Vite dev server, port 5173 |
| `docker`, `docker-compose.yml` | Images and the whole local stack | Images only | Compose |
| `bootstrap`, `infra` | Terraform state bucket and the AWS environments | Run from your laptop or CI | Never |
| `scripts` | Deploy, operate, M5 checks, demo | Laptop or CI | Laptop |
| `.github/workflows` | CI and deployments | GitHub Actions | Never |
| `tests` | Integration, browser and script tests | Never | Laptop, CI |
| `docs` | Design, decisions, evidence, walkthroughs | Never | Never |

Two rules explain most of the layout:

- **Each service owns one database.** Auth, Platform and DocBeam each have their own schema, migrations and database role (ADR-009). No service reads another's tables; they talk over HTTP with tokens.
- **The same handler code runs in Lambda and in Docker.** Each worker exports one `handler`. On AWS, Lambda calls it. Locally, `packages/worker-runtime` polls LocalStack's queues and calls the same function, so local tests exercise the real code.

## 1. Root files

These files make the twelve packages behave as one project: one install, one type check, one test command.

| File | Why it exists |
| --- | --- |
| `package.json` | Declares the npm workspace (the 12 packages), pins Node 22, and defines the commands everyone uses: `lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `test:e2e:dev`, `build`. Root dev tools (TypeScript, Vitest, ESLint, Playwright) live here once instead of in every package. |
| `package-lock.json` | Exact versions of every dependency, so CI and your laptop install the same thing. |
| `tsconfig.base.json` | The strict TypeScript settings every package extends (`strict`, `noUncheckedIndexedAccess`, NodeNext modules). |
| `tsconfig.json` | A project-references file: `tsc -b` builds the packages in dependency order (shared first). |
| `tsconfig.check.json` | Type-checks everything, tests and scripts included, straight from source with path aliases, without building. Used by `npm run typecheck`. |
| `vitest.config.ts` | Unit tests: every `*.test.ts` under packages, services, workers, web and `tests/scripts`. |
| `vitest.integration.config.ts` | Integration tests in `tests/integration`, one file at a time, with long timeouts, because they share the Compose stack. |
| `vitest.aliases.ts` | Maps `@docbeam/shared` and the worker package names to their source files, so tests need no build first. |
| `eslint.config.js` | Lint rules: TypeScript recommended, unused variables, and `import type` for types (which `verbatimModuleSyntax` needs). |
| `playwright.config.ts` | Browser tests against the local stack, one at a time, starting Vite if needed. |
| `playwright.dev.config.ts` | The same tests pointed at dev on AWS; only the download and M5 browser specs, because the others stop local containers. |
| `.env.example` | The names and safe local values `.env` needs. Real generated secrets are added by `scripts/local-env.sh`, never committed. |
| `.gitignore`, `.dockerignore` | Keep build output, `.env`, Terraform state and plans out of git, and keep docs and infra out of Docker build contexts. |
| `.mailmap` | Shows every commit under your GitHub noreply address in `git log` (D-M5-2). |
| `AGENTS.md` | The rules every coding-agent session follows: regions, secrets, never touching prod, how to test. |
| `README.md` | The front page: what DocBeam is, the architecture, the demo video, how to run it. |

## 2. packages/shared: the rules everyone shares

Anything two places must agree on lives here exactly once: limits, status names, how a token is checked, how a delivery is finished. Read this package first; every later file imports it.

It has two entry points. `index.ts` exports everything, for Node. `browser.ts` exports only the pure parts (batch rules, checksums, constants, file types, limits), so the web app can enforce the same rules without pulling in Node or AWS code.

| File | Why it exists |
| --- | --- |
| `constants.ts` | The vocabulary: task, job and scan statuses, the failure codes (FILE\_NOT\_UPLOADED, RETRIES\_EXHAUSTED, CANCELLED and the rest), error codes, scopes, the JWT audience. |
| `limits.ts` | Every number of the design in one object: 100 files, 20 destinations, 2,000 tasks, 1 GiB, 100 MiB multipart threshold, 16 MiB parts, 15-minute upload links, 2-minute download links, upload waves of 20. |
| `batch.ts` | `validateBatch`: the submission rules in the contract's order. The API uses it to refuse a bad batch; the page uses it to keep Send off. |
| `checksum.ts` | SHA-256 travels as hex in DocBeam and as base64 in S3; this converts between them and spots S3's combined multipart checksum. |
| `file-types.ts` | The allow-list (PDF, PNG, JPEG, DOCX, XLSX) and the first bytes each must start with, so a renamed `.exe` is refused. |
| `errors.ts` | The one error shape `{ error: { code, message } }`, the `ApiError` routes throw, the Fastify error handler, and `acceptEmptyBodies` (the M5 fix that lets a POST with no body through, D-M5-5). |
| `jwt.ts` (shared: `packages/shared/src/jwt.ts`, `createRemoteKeys`) | The Fastify plugin every service registers: checks the RS256 token against the Auth Service's public keys (kept 10 minutes; a failed fetch keeps the old keys, and with none the answer is 503, not 401, D-F1-14), and gives routes `requireAuth({ use: 'user' })` or `({ use: 'service', scope })`. |
| `service-token.ts` | Gets and caches a 15-minute service token for internal callers, renewing it before it expires so no request waits on Auth (ADR-013). |
| `db.ts` | Connection-pool sizes for services and Lambdas, kept under the database's connection limit, plus the query timeout and keep-alive added after the failover drill (D-M5-13). |
| `db-url.ts` | Builds the database URL on AWS from host, name, user and password, always with `sslmode=verify-full` and the RDS certificate bundle; refuses to build one without it (D-M5-4). |
| `lambda-db.ts` | The same for Lambdas, reading the user and password from Secrets Manager. |
| `secrets.ts` | Reads a secret: the plain value locally, the Secrets Manager ARN on AWS, fetched once per cold start. |
| `sqs.ts` | Lets a Lambda hide its own message for a chosen time, which is how retry gaps of 30 s, 2 min, 5 min and 10 min are made (ADR-005). |
| `task-outcome.ts` | `finishTask` and `failPendingTasks`: the only code that gives a task its final status. It locks the job row, writes the result only if the task is still open, writes the audit event, and closes the job when the last task ends. It also works out job status from counts (status is never stored). |
| `push.ts` | Sends live updates to the browsers watching a job, through the WebSocket API. A failed push is logged and never fails a delivery. |
| `upload-events.ts` | Reads S3's "object created" events and keeps only real uploads under `staging/<owner>/<fileId>`. |
| `logger.ts` | A small JSON-lines logger for the workers (services use Fastify's own). |
| `certs/rds-ca-bundle.pem` | Amazon's public RDS certificates, copied into every image so database TLS can check the chain. Public, not a secret. |

Each `*.test.ts` beside these files is its unit test. The most important are `task-outcome.test.ts` (the finishing rules), `batch.test.ts` and `jwt.test.ts`.

## 3. The three services share one layout

Auth, Platform and DocBeam API are all Fastify servers built the same way, so learn the pattern once:

| File | Role in every service |
| --- | --- |
| `server.ts` | The entry point: loads config, opens the database pool, builds the app, listens, and shuts down cleanly on SIGTERM so ECS can replace a task without dropping requests. |
| `app.ts` | `buildApp`: creates Fastify, registers the error handler and token plugin, the `/health` route the load balancer calls, then each route file. Tests call `buildApp` directly with fakes. |
| `config.ts` | Reads environment variables through a zod schema, so a missing or wrong setting stops the service at start, not on the first request. |
| `db.ts` | The `pg` pool and Drizzle, with the shared pool limits. |
| `schema.ts` | The service's tables, written in Drizzle. The single source of truth for its database. |
| `migrate.ts` | Runs the SQL migrations as a one-off task before each deploy, logging in as the migration user and acting as the owner role, so the running app's role can never alter tables (D-G8). |
| `drizzle.config.ts` | Tells `drizzle-kit generate` to turn `schema.ts` changes into a new SQL file. |
| `migrations/*.sql` | The forward-only SQL that actually builds the tables. `meta/` holds drizzle-kit's snapshot and journal, which it needs to work out the next migration. |
| `package.json`, `tsconfig.json` | The service's dependencies and its build settings. |

## 4. services/auth: who you are

Auth proves identity and nothing else. It never knows teams; that is the platform's job.

Tables: `users` (email, bcrypt hash, name, failed-login count, pause time), `refresh_tokens` (hashes only, one row per token, grouped into families) and `service_clients` (the four internal callers).

| File | Why it exists |
| --- | --- |
| `routes/accounts.ts` | `POST /auth/register`, `/login`, `/refresh`, `/logout`. Login returns a 15-minute access token and sets the refresh token in an HttpOnly cookie on `/api/auth`. |
| `routes/internal.ts` | `/.well-known/jwks.json` (the public key every service checks tokens against), the OpenID configuration, `POST /auth/token` (service tokens for internal callers), and `GET /internal/users` (the seed script looks up user ids). |
| `tokens.ts` | Signs access and service tokens with RS256, 15 minutes each. |
| `keys.ts` | Loads the RSA private key and publishes its public half with a stable key id. |
| `sessions.ts` | Refresh-token rotation: each token works once; using one twice revokes the whole family, which ends a stolen session (ADR-015). Sign-ins last 12 hours. |
| `passwords.ts` | bcrypt at cost 12, and the 12-to-72-byte length rule (bcrypt ignores bytes past 72). |
| `login-attempts.ts` | Five wrong passwords in a row pause sign-in for 15 minutes. Pure functions, so they are unit tested. |
| `service-clients.ts` | The four internal clients and their scopes: delivery-worker (ingest documents), docbeam-api and ws-handlers (read memberships), seed-script (read users). |
| `bootstrap-signing-key.ts` | One-off task that writes a new RSA key into the empty Secrets Manager secret, and never overwrites one. That keeps the private key out of Terraform state. |
| `unlock-user.ts` | Support script that ends a sign-in pause early. |
| `migrations/0000_auth_schema.sql` | Creates the three tables. |

## 5. services/platform: the stand-in Document Platform

The brief treats the Document Platform as an existing system DocBeam delivers into. It doesn't exist for this project, so this service plays it. It owns teams, memberships, binders, folders and delivered documents, and it is the only source of truth for who belongs to which team.

Tables: `teams`, `team_members`, `binders`, `folders` (nested through a parent id) and `documents`. Nothing in v1 creates teams or folders; the seed loads them.

| File | Why it exists |
| --- | --- |
| `routes/browse.ts` | `GET /teams`, `/teams/:teamId/binders`, `/binders/:id/contents`, `/folders/:id/contents`: the destination tree, a page at a time (`limit`, opaque `cursor`, `nextCursor`, D-F1-6). Only your own teams, and a bad id gets the same 404 as someone else's, on every page.
| `paging.ts`, `paging.test.ts` | The limit and cursor rules: the cursor is the position of the last row, so rows added while paging never repeat or skip one. |
| `routes/internal.ts` | For services only: `POST /destinations/check` (one query confirms every binder and folder exists, sits in the right binder, and belongs to a team the user is in; returns each team and readable path) and `GET /users/:userId/teams`. This is why the browser never says which team a destination belongs to. |
| `routes/documents.ts` | `POST /documents`, called by the Delivery Lambda. It checks the destination and membership before reading any bytes, checks the file's first bytes, streams it to S3 while recomputing SHA-256, refuses a mismatch, and stores at most one document per task (`ON CONFLICT (source_task_id) DO NOTHING`), so a repeated delivery never duplicates. |
| `ingest-limiter.ts` | At most 6 files are stored at once; a request waiting over 30 s gets 503, so Delivery retries later instead of timing out (D-M2-22). |
| `server.ts` | Same as the others, but drains: on shutdown it stops taking new requests and lets running uploads finish. |
| `seed.ts` | Makes the database match a seed file: adds and renames, removes memberships no longer listed, never deletes teams or folders. |
| `seed-run.ts` | The deploy step that runs `seed.ts`: looks up each user's id from Auth with the seed-script token, and locally or on dev can create the demo users. |
| `sql.ts` | A helper that passes JS arrays to Postgres correctly. |
| `seed/generate.mjs` | Writes the seed files with fixed UUIDv5 ids, so every run produces identical files and the seed is safe to re-run. |
| `seed/demo.json` | The small demo world: Priya, Raj, Sam, Anantim and the Cardio, Oncology and Neuro teams. |
| `seed/dev-load.json` | The load-test world: one user in 50 teams, used by the browse and 2,000-delivery checks, and a paging user whose folder holds 60 subfolders. |
| `seed/dev-load-m5-removed.json` | The same world with that user removed from one team, for check 5.2 (removed member). |
| `migrations/0000_platform_schema.sql` | Creates the five tables. |

## 6. services/docbeam-api: the product itself

This is DocBeam's own backend. It never touches file bytes: browsers upload straight to S3 with signed links, and Lambdas do the delivering. Its job is to record, check and answer quickly.

Tables: `files` (each upload, its checksum and scan status), `jobs` (one per distribution), `tasks` (one per file x destination, up to 2,000 a job), `audit_events` (append-only history) and `ws_connections` (which browser watches which job).

Read the routes in the order a user meets them:

| File | Why it exists |
| --- | --- |
| `routes/uploads.ts` | Step 1 of a send. `POST /uploads` creates the file rows and returns signed S3 links in waves of 20. Small files get a presigned POST that makes S3 itself check the declared SHA-256. Files over 100 MiB use the three multipart routes: start, re-sign parts, complete (which asks S3 what it holds rather than trusting the browser). |
| `routes/files.ts` | `GET /files?ids=…`: the page polls this every 2 seconds while files show "Checking", until the scanner marks them clean or refused. |
| `routes/jobs.ts` | `POST /jobs`, the heart of the system. Requires an Idempotency-Key, runs `validateBatch`, checks the files and asks the platform about every destination at the same time, then in ONE transaction writes the job, claims the files, inserts all tasks and the audit event. After the commit it sends one Job Queue message; if that send fails, the Sweeper sends it later. |
| `routes/jobs-read.ts` | `GET /jobs`, `/jobs/:id`, `/jobs/:id/tasks`. The sender sees every delivery; anyone else sees only deliveries to their own teams, with counts covering only those. |
| `routes/jobs-actions.ts` | `POST /jobs/:id/cancel` and `/retry`. Sender only (others get 404 or 403 NOT\_SENDER). Retry reopens only system failures (RETRIES\_EXHAUSTED, FANOUT\_FAILED). |
| `routes/downloads.ts` | `POST /files/:fileId/downloads`: a 2-minute signed GET link for download or preview, only for the sender or a member of a team the file reached. Anyone else gets the same 404 as a missing file; 410 after 33 days. |
| `routes/audit.ts` | `GET /audit`: the full history, filtered by who may see what (sender sees all; others see their teams' events and job-wide events). |
| `job-access.ts` | One rule used by every job route: who may see this job. |
| `tracking.ts` | Pure rules for reading a job: counts, status, and when Retry and Cancel are open. |
| `platform.ts` | The client for the platform's internal routes, with a service token and a 60-second cache of each user's teams. |
| `s3.ts` | Everything the routes need from S3, behind one interface so tests can fake it: presigned POST, multipart, signed GET with the right download name. Signing happens in-process; it never calls AWS. |
| `queue.ts` | Sends the one Job Queue message (the job id only, never a token). |
| `validate.ts` | Parses a body with zod and turns any failure into one 400 shape. |
| `sql.ts` | Passes whole arrays as one parameter each, the fix that made the 2,000-row insert fast (D-M5-10). |
| `timing.ts` | The per-phase timing line on every `POST /jobs`, added to diagnose check 5.1 (D-M5-14, D-M5-16). |
| `failure-rate.ts`, `failure-rate-run.ts` | The delivery failure-rate metric, and the one-off task that prints it on dev. |
| `migrations/0000_docbeam_schema.sql` | Creates the five tables. |
| `migrations/0001_audit_grants.sql` | Takes UPDATE, DELETE and TRUNCATE on `audit_events` away from the app role, so the history really is append-only. |

## 7. workers/: the background work

Each worker is one Lambda with one job. In every worker, `index.ts` exports the `handler` Lambda calls and wires up real AWS clients; the logic lives in a separate file that takes its dependencies as arguments, so tests can call it with fakes. Each `package.json` has a `bundle` script that builds one minified file with esbuild and copies in the RDS certificate bundle.

In the order a distribution passes through them:

| Worker | Trigger | Files and what they do |
| --- | --- | --- |
| `upload-events` | S3 "object created" events, via the Upload Events queue | `process.ts` reads every byte once, recomputing SHA-256 and size while scanning. Clean files are tagged in S3 and then marked clean, so a row that says clean always has a tagged object. Refused files are marked, audited and deleted. `scanner.ts` talks to the `clamav` container locally and runs `clamscan` inside the Lambda. `Dockerfile` builds this one Lambda as a container image with ClamAV and fresh virus definitions; it is rebuilt daily. |
| `fanout` | The Job Queue (one message per job) | `index.ts` sets `fanned_out_at`, then sends one Task Queue message per pending task, 10 per call. Safe to repeat, because Delivery ignores a task that is already final. |
| `delivery` | The Task Queue, up to 50 at once | `deliver.ts` claims the task in one statement (a late or repeated message stops here), checks the staged object and its checksum, streams it to the platform's `POST /documents`, then calls `finishTask`. `classify.ts` sorts the platform's answer into completed, permanent failure or temporary failure, and sets the retry gaps: 30 s, 2 min, 5 min, 10 min. `multipart.ts` builds a streamed form body, text fields first, so the platform can refuse before reading any bytes. |
| `dlq` | The three dead-letter queues | `process.ts` makes messages that ran out of attempts visible to the user instead of lost: a task becomes RETRIES\_EXHAUSTED, a job whose fan-out failed gets its pending tasks marked FANOUT\_FAILED, and an upload that could not be checked is refused. |
| `ws` | The WebSocket API's `$connect`, `subscribe` and `$disconnect` routes | `handler.ts` checks the token from the query string on connect, checks access on subscribe, records the connection in `ws_connections`, and answers `subscribed` before the page fetches tasks, so no update falls in the gap. |
| `sweeper` | Two EventBridge schedules | `index.ts` re-sends the Job Queue message for any job not fanned out 1 minute after it was queued (every minute); deletes uploads nobody submitted within 24 hours and aborts their multipart uploads (daily); removes WebSocket rows past their token's expiry. |

Each worker's `*.test.ts` tests that logic with fakes; `tests/integration` tests them against real Postgres and LocalStack.

### packages/worker-runtime: Lambda on a laptop

Locally there is no Lambda and no API Gateway, so this package stands in for both. It only runs in Docker Compose.

| File | Why it exists |
| --- | --- |
| `workers.ts` | Entry point of the `workers` container: polls each LocalStack queue and runs the Sweeper on timers. |
| `poller.ts` | Long-polls one queue and deletes the messages a handler reports as done. |
| `batch.ts` | Turns raw SQS messages into the exact event shape Lambda sends, and applies partial-batch failures. |
| `ws-local.ts`, `ws-local-main.ts` | A small WebSocket server shaped like API Gateway: calls the WS handler for connect, subscribe and disconnect, and accepts pushes on the same management URL. |

## 8. web/: the React app

A single-page app with two tabs: Distribute, and Status (one list of distributions with a side panel that holds the deliveries; no audit view, D-F1-7, D-F1-9, D-F1-13). Logic lives in plain TypeScript folders (tested without React); `components/` only draws it. No UI library: small components and one stylesheet that starts with the design tokens (D-F1-5).

**Entry and build:** `index.html` (the page shell), `src/main.tsx` (mounts React), `src/App.tsx` (keeps the current screen and distribution in the URL hash, so a reload or shared link opens the same place), `src/styles.css` (the design tokens, then all styling), `public/favicon.svg`, `vite.config.ts` (the dev server proxies `/api/*` to the right service, the same single-site shape CloudFront gives on AWS), `package.json`, `tsconfig.json`.

| Folder | Files | Why it exists |
| --- | --- | --- |
| `auth/` | `session.ts`, `token.ts`, `errors.ts` (tests: `session.test.ts`, `session.clock.test.ts`, which moves a fake clock past 15 minutes and 12 hours) | Sign-in state. The access token lives in sessionStorage, the refresh token only in its HttpOnly cookie. `apiFetch` refreshes once on a 401; one tab at a time refreshes (Web Locks) and tells the others. Only a refused refresh opens the sign-in dialog; a request that hits it waits and is sent again after sign-in; an unreachable server is a retryable error, not a sign-out (D-F1-14). There is no `register` call: the web app has no sign-up (D-F1-17). |
| `upload/` | `manager.ts`, `api.ts`, `api-types.ts`, `transport.ts`, `browser-transport.ts`, `hashing.ts`, `hash.worker.ts`, `worker-hash.ts`, `instance.ts` | The upload queue (the largest file, about 500 lines): hashes each file in a Web Worker so a 1 GB file doesn't freeze the tab, asks for links in waves of 20, uploads with progress (XMLHttpRequest, because fetch has no upload progress), resumes multipart uploads from the parts already stored. The transport is an interface, so the integration test runs the same queue in Node. |
| `destinations/` | `tree.ts`, `selection.ts` | The destination tree: loading one page of a level when it is opened (20 rows, the next page on scroll, D-F1-6), ticking folders (binders and teams are headings, D-F1-3), the 20-destination cap. |
| `distribute/` | `files.ts`, `mapping.ts`, `rows.ts`, `submit.ts` | Picking files (type and size rules up front), mapping each file to folders (a folder ticked for all files stays ticked for files added later, D-F1-5), how a click, Ctrl-click and Shift-click select rows, and submitting with one Idempotency-Key kept across retries, so a double click can't send twice. |
| `tracking/` | `api.ts`, `apply.ts`, `format.ts`, `links.ts`, `route.ts`, `useJob.ts`, `usePagedJobs.ts`, `useFileLink.ts`, `virtual.ts` | The Status view's data: the list of distributions (20 at a time, with scope and status filters, and the count for the Status tab badge) and one distribution. There is no audit client: the web app shows job history only (D-F1-13). `apply.ts` ignores a push older than what is shown (pushes can arrive out of order). `virtual.ts` draws only the visible rows of up to 2,000. `useFileLink.ts` gets preview and download links and runs the 2-minute countdown. |
| `live/` | `socket.ts`, `instance.ts` | The WebSocket client: reconnects, resubscribes, and re-reads the tasks after a gap so nothing is missed. |
| `preview/` | `render.ts`, `office.ts` | Turns DOCX and XLSX into read-only HTML shown in a sandboxed iframe. The two libraries load only when needed. |
| `testing/` | `icon-buttons.ts` | A test helper: every icon-only button must have a label and tooltip. |
| `src/` root | `explain.ts`, `text.ts` | One plain-English line per status and failure code, kept in one place, and the one `plural` helper. |

**components/** (each `.tsx` is one piece of the screen):

- Shell and sign-in: `Shell`, `Logo`, `AuthCard` (sign-in only, with the tagline and the line about the study administrator), `PauseNote`, `SessionDialog` (the 12-hour re-sign-in over the page), `Toasts`, `ConfirmDialog`, `Popover`, `useLeaveWarning`.
- Shared pieces: `Icons` (the one icon set), `StatusChip` (the one status look), `MoreRow` (the "load more" row of every paged list), `PanelFrame` (Esc closes it from anywhere on the page), `JobBar` (progress bar), `useFocusTrap` (dialogs), `useThrottled` (screen reader announcements).
- Distribute: `Distribute` (the screen), `AddFiles` (the Files card and its drop area), `FileTable`, `Destinations` (the tree, with a memoised row), `DestinationChips`, `SendBar`, `SendDialog` (the question before Send), `TypeBadge`, `FileActions`, `Preview`.
- Status: `StatusPage` (filters, list and panel; the list narrows beside the open panel), `OpenById` (the icon button and its one-field card), `DistributionList`, `DistributionPanel` (status, Retry failed, Cancel distribution, deliveries), `TaskTable`.

The `*.test.ts(x)` files beside them are the unit tests, run with jsdom; `Destinations.perf.test.tsx` and `DistributionList.perf.test.tsx` count renders (ticking one of 40 folders draws one row, a refresh with nothing changed draws none).

## 9. Running it locally: docker-compose and docker/

The whole system runs on a laptop, with LocalStack standing in for S3 and SQS. Start it with `scripts/local-env.sh` then `docker compose up -d --wait`.

`docker-compose.yml` starts nine containers: `postgres`, `localstack`, `clamav`, `auth`, `platform`, `docbeam-api`, `workers`, `ws-local`, and `seed` (only when asked, through the `seed` profile).

| File | Why it exists |
| --- | --- |
| `docker/service.Dockerfile` | One Dockerfile for all three services; the `SERVICE` build argument picks which. The same image runs the server and, as a one-off task, the migrations. Used locally and pushed to ECR for AWS. |
| `docker/workers.Dockerfile` | Local only: builds the `workers` and `ws-local` containers that run the Lambda handlers through worker-runtime. On AWS the handlers ship as Lambda bundles instead. |
| `docker/db-bootstrap/bootstrap.sh` | Creates the three databases and six roles (an owner role that can't log in and an app role that can, per database) and the citext extension. Safe to run again. |
| `docker/db-bootstrap/Dockerfile` | Packages that script with psql and the RDS certificate bundle, for the one-off bootstrap task on AWS. |
| `docker/postgres/10-bootstrap.sh` | Runs the same bootstrap script when the local Postgres volume is first created, so local and AWS databases are set up identically. |
| `docker/localstack/init/ready.d/init.sh` | Creates the local buckets and queues with the same settings as AWS: receive limits, visibility timeouts, 14-day retention, and the S3 event on `staging/`. |
| `scripts/local-env.sh` | Fills `.env`: copies `.env.example`, then generates the signing key, client secrets and seed password if missing. |

## 10. bootstrap/ and infra/: AWS in Terraform

Every AWS resource is defined here, except the state bucket and the deploy user. The pattern: `modules/` describe one kind of building block each; `envs/dev` and `envs/prod` call those modules with their own sizes.

`bootstrap/create-state-backend.sh` creates the one thing Terraform can't create for itself: the versioned, encrypted S3 bucket that holds Terraform's state (ADR-012). Run once, safe to repeat.

**Each environment** has the same five files, plus `.terraform.lock.hcl`, which pins the exact provider versions so every plan uses the same AWS provider:

| File | What it builds |
| --- | --- |
| `main.tf` | The foundation: network, database, secrets, image repositories, CloudFront and the ECS cluster. Also the state backend settings (the bucket name comes from the command line, so no account id is in git). |
| `services.tf` | The internal load balancer, the API Gateway, and the three ECS services with their sizes. |
| `async.tf` | Everything behind the queues: the six SQS queues, the six Lambdas and their triggers, the WebSocket API, the Sweeper's schedules, and the alarms. |
| `variables.tf` | Settings that differ per run: task count, Multi-AZ for the drill, public registration on or off, the seed files. |
| `outputs.tf` | Addresses and names the scripts and workflows read after an apply (site URL, queue URLs, function names). |

Dev and prod differ only in size: dev has 1 NAT gateway, 1 task per service, a `db.t4g.micro` Single-AZ database and no RDS Proxy (the Free plan blocks it); prod has 2 NAT gateways, 2 tasks per service, a `db.t4g.small` Multi-AZ database with RDS Proxy and deletion protection. Task sizes are the same in both: Auth 0.5 vCPU (bcrypt is slow by design), the platform 1 vCPU, the DocBeam API 0.25 vCPU.

**The 15 modules**, roughly in the order a request meets them:

| Module | Why it exists |
| --- | --- |
| `cloudfront` | The one public address: serves the web app from S3 and forwards `/api/*` to API Gateway, so the cookie can be same-site without a custom domain. Two small CloudFront Functions strip `/api` and handle page routes. |
| `api-gateway` | The HTTP API with the built-in JWT authorizer, so a request without a valid token never reaches a service. Holds the route list, throttles and access log, and reaches the services through a VPC Link. |
| `websocket-api` | The WebSocket API browsers connect to for live updates. |
| `alb` | The internal load balancer behind the VPC Link, one listener per service. |
| `ecs-cluster` | The cluster, plus the one-off database bootstrap task. |
| `ecs-service` | One service: task definitions (server, migrate, seed), roles, log group, security group. Used three times. |
| `lambda` | One worker Lambda inside the VPC, with its role, logs, security group and SQS trigger. Used six times. Terraform creates it from a placeholder; the deploy script ships the real code. |
| `sqs` | Job, Task and Upload Events queues, each with a dead-letter queue. |
| `scheduler` | The Sweeper's two schedules: every minute and daily. |
| `s3` | Three buckets: the Object Store (staged uploads, expire after 33 days), the Platform File Store (delivered documents), and the web app bucket. Includes the CORS rule and the upload event. |
| `rds` | The Postgres instance, its parameter group (fixed connection limit), and the optional RDS Proxy. |
| `secrets` | Generates the four service-client secrets and creates the empty signing-key secret. |
| `ecr` | The image repositories, keeping the last images by git SHA tag. |
| `network` | The VPC, public and private subnets, NAT gateways and an S3 endpoint, so traffic to S3 stays off the internet. |
| `alarms` | Four alarms (each dead-letter queue, and Delivery errors over 1%) emailed through one SNS topic. |

Each module has `main.tf` (the resources), `variables.tf` (its inputs) and `outputs.tf` (what it hands back); `scheduler` has no outputs.

## 11. scripts/ and .github/workflows/: shipping and operating

Terraform builds empty infrastructure; these scripts put code into it and keep it healthy. The workflows call the same scripts, so a deploy from your laptop and from GitHub behave the same.

**Deploying** (used by the runbook and the workflows):

| Script | Why it exists |
| --- | --- |
| `push-image.sh` | Builds a linux/amd64 image and pushes it to ECR, tagged with the git SHA, so a tag always means one exact commit. |
| `deploy-service.sh` | Deploys one ECS service: runs its migrations as a one-off task first, then switches the service to the new image and waits. Skips if that image is already running. |
| `deploy-lambda.sh` | Deploys one worker Lambda from a bundle or a container image. |
| `deploy-web.sh` | Builds the web app, uploads it to its bucket and clears the CloudFront cache. |
| `run-db-bootstrap.sh` | Runs the database bootstrap task (three databases, six roles) once per new environment. |
| `run-task.sh` | Runs any one-off task (migrate, seed, a support script) in the service's own network and prints its log. |
| `check-internal.sh` | Checks every service answers `/health` from inside the network, before the gateway sends it traffic. |
| `update-rds-ca.sh` | Refreshes the RDS certificate bundle when AWS rotates it. |

**Operating and tearing down:** `empty-dev-buckets.sh` empties the versioned dev buckets (every version and delete marker), because `terraform destroy` can't. `check-public.sh` scans the whole git history for secrets and stray personal data before the repo goes public.

**M5 checks:** one script per check, each printing PASS or FAIL with its numbers: `m5-submit-load` (5.1), `m5-removed-member` (5.2), `m5-platform-outage` (5.3), `m5-file-checks` (5.4), `m5-browse-timing` (5.5), `m5-multipart-1gb` (5.6), `m5-team-viewer` (5.7), `m5-failover` (5.8), `m5-eicar` (5.9), `m5-cancel` (5.10), `m5-auth` (5.11), `m5-security` (5.12), `m5-sweeper` (5.13). `m5-all.sh` runs them in order and keeps the output. The diagnosis tools from the 5.1 investigation are `m5-submit-report`, `m5-server-metrics`, `m5-pg-sample`, `m5-schema-timing` and `m5-failure-rate`. They are thin wrappers around `scripts/m5/`: `checks.ts` (every check), `lib.ts` (sign in, upload, submit, poll, without ever printing a secret), `pg-sampler.js` and `schema-timing.ts`. Any script that changes AWS says what it will do and needs `--yes`.

**Demo:** `demo-files.sh` makes the demo's files (12 PDFs, a PNG and the EICAR test file), `demo-send.sh` sends 2,000 deliveries as the load user, `demo-outage.sh` stops and starts the platform for the outage scene, and `demo/record.ts` is the Playwright recorder that plays the whole script (1280x720, a visible cursor, a caption per step) and writes the video and one frame per step.

**Workflows:**

| Workflow | Runs on | What it does |
| --- | --- | --- |
| `ci.yml` | Every PR and push to main | Lint, type check, unit tests, build, integration tests against Compose, and gitleaks. |
| `_service.yml` | Called by the three below | The shared pipeline for a service: test, build the image, deploy to dev on main, deploy to prod only by typed confirmation. |
| `auth.yml`, `platform.yml`, `docbeam-api.yml` | Changes to that service or shared code | Call `_service.yml` for their service. |
| `workers.yml` | Changes to the five bundled workers | Test, bundle, deploy each to dev. |
| `upload-events-image.yml` | Changes, and daily at 03:17 UTC | Rebuilds the scanner image, so ClamAV's virus definitions stay current. |
| `web.yml` | Changes to `web/` | Test, build, publish to the web bucket. |
| `infra.yml` | Changes to `infra/` | Format and validate; plan dev on PRs; apply dev only when `INFRA_APPLY_ENABLED` is true; prod only by typed confirmation. |
| `dev-up-check.yml` | Daily, 23:00 IST | Fails, and so emails you, if dev is still running. |
| `dev-teardown.yml` | By hand from the Actions tab; its one scheduled run was 20 Oct 2026 | Empties the buckets and destroys dev, then checks nothing is left. A date guard stops it from firing again next year. |

## 12. tests/: four layers of checking

Each layer catches what the one below can't. Unit tests sit beside the code they test; the `tests/` folder holds the layers that need more than one file.

| Layer | Where | Command | What it proves |
| --- | --- | --- | --- |
| Unit | `*.test.ts(x)` next to the code | `npm test` | Each rule alone, with fakes: batch limits, token checks, retry gaps, finishing a task, a push applied out of order. |
| Script | `tests/scripts/` | `npm test` | The deploy scripts are safe to run twice and target only what they should. |
| Integration | `tests/integration/` | `npm run test:integration` | Real Postgres, LocalStack and ClamAV in Compose: the pieces work together. |
| Browser | `tests/e2e/` | `npm run test:e2e` (local), `test:e2e:dev` (AWS) | A real browser clicks through the app. |

**tests/integration** (one file per area, run one at a time against the Compose stack):

- `postgres.test.ts`, `docbeam-db.test.ts`, `localstack.test.ts`: the local databases, roles and grants (the app role can't edit audit rows) and the queues and buckets match the design.
- `services.test.ts`, `auth.test.ts`: the services start and answer; register, login, refresh rotation, reuse detection, the sign-in pause.
- `platform.test.ts`, `ingest.test.ts`, `platform-drain.test.ts`: browse shows only your teams; `POST /documents` refuses bad types and checksums and never stores twice; a draining platform finishes running uploads.
- `uploads.test.ts`, `web-upload.test.ts`, `upload-events.test.ts`: signed links, single and multipart uploads, the web app's real upload queue driven from Node, and scanning that refuses EICAR.
- `jobs.test.ts`, `fanout.test.ts`, `delivery.test.ts`, `dlq-sweeper.test.ts`: submit, fan-out, delivery and its retries, dead letters, and the Sweeper re-sending a lost job.
- `tracking.test.ts`, `ws.test.ts`, `downloads.test.ts`: who sees which deliveries, live pushes over the WebSocket, and download links with their 404 rules.
- `helpers.ts`: shared sign-in, upload and wait helpers.

**tests/e2e** (Playwright):

- `m1.spec.ts`, `m2.spec.ts`, `track.spec.ts`, `download.spec.ts`: one end-to-end story per milestone: an account, an upload and send, live counts that survive a reload, preview and download.
- `browse-paging.spec.ts`: a folder of 60 children loads 20 at a time as the list is scrolled. `status-dev.spec.ts`: sending with the question first, then the list, a filter, the panel and Esc (runs locally and on dev). `screens.spec.ts`: takes the screenshots of every screen and dialog at 1440, 1280 and 1024 px (only when `SHOT_DIR` is set). `openid.spec.ts` and `status-fixes.spec.ts`: the Open by ID card, the sign-in dialog (no errors behind it, full-viewport backdrop), the Status badge and the six-delivery panel. `helpers.ts` has `newAccount`, which makes a throw-away account through the Auth Service because the page has no sign-up.
- `ui.spec.ts`, `tooltips.spec.ts`, `popover.spec.ts`, `openid.spec.ts`, `status-fixes.spec.ts`: the interface rules: disabled buttons say why, icon buttons have labels, the "+N" popover behaves, and fixes found during testing stay fixed.
- `download-dev.spec.ts`, `m5-browser-dev.spec.ts`: run only against dev: cross-team downloads, a slow connection, multipart resume after going offline, WebSocket reconnect, PNG and JPG preview.
- `global-setup.ts`, `helpers.ts`: start-up and shared steps.

**tests/scripts:** `deploy-service.test.ts`, `deploy-lambda.test.ts`, `run-task.test.ts` and `empty-dev-buckets.test.ts` run each script against a fake `aws` command and check exactly what it would call.

## 13. docs/: the why behind the code

The code says what happens; `docs/` says why, and proves it was checked. Code comments cite these documents by id (ADR-008, D-M5-13, Step 2.4), so you can jump from any line to its reason.

| Path | Why it exists |
| --- | --- |
| `design/02-blueprint.md` | What DocBeam must do and how success is measured. |
| `design/03-user-flows.md` | The four flows step by step: browse, distribute, track, retrieve. |
| `design/04-adrs.md` | The 16 architecture decisions (the `ADR-` numbers in comments). |
| `design/05-technical-design.md` | Tables, API contracts, the build steps (the `Step 2.4` numbers) and milestones. |
| `design/diagrams/detailed/`, `simplified/` | The five Eraser diagrams as code, detailed and presentation versions. |
| `design/ui/` | The source of the interactive UI mockup. |
| `DECISIONS.md` | Every change made during the build (the `D-` numbers). Where it differs from the design, it wins. |
| `PLAN.md`, `STATUS.md` | The task list per milestone, and where things stand now, including dev's state. |
| `RUNBOOK-first-bring-up.md` | Building an environment from nothing, in order; proven by M5. |
| `DEMO-SCRIPT.md`, `demo/docbeam-demo.webm` | The demo's steps and the recorded video (`scripts/demo/record.ts` makes it). |
| `TESTER-GUIDE.md` | What a tester signs in as and tries. No password in it. |
| `agent/PROMPTS.md` | The prompt for each agent session, milestone by milestone. |
| `testing/M0-TESTING.md` to `M5-TESTING.md` | What to check for each milestone, and how. |
| `testing/M0-RESULTS.md` to `M5-RESULTS.md` | What was found, with the YES/NO table. |
| `testing/F1-RESULTS.md` | The F1 round (the reviewer's feedback): what was done per part, with YES/NO per point. |
| `testing/m4-evidence/`, `m5-evidence/`, `f1-evidence/` | Screenshots (F1: before and after, at 1440, 1280 and 1024 px, the demo frames and the dev numbers), the Playwright report and each check's raw output. |
| `walkthrough/M0.md` to `M5.md`, `F1.md` | Plain-language notes per milestone and for the F1 round, for interviews. |

Ids starting `D-G` (such as D-G5, the `/api` prefix) are decisions from the gap review done before the build; they open `DECISIONS.md`.

## 14. Keeping this walkthrough current

Every PR that adds, removes, renames or moves a file updates this document in the same PR (rule in `AGENTS.md`). The repository was audited for stray files on 19 October 2026: the only one found, an accidentally committed test report under `.vitest/`, was removed and `.vitest/` added to `.gitignore`.
