# DocBeam design decisions

Changes to the design in `docs/design/`, agreed with the person. `docs/design/` is never edited. Where it disagrees with this file, this file wins. Each entry: date, what changed, the design section it changes, and why.

---

## D-G1. Deploy user and GitHub setup made by hand

- **Date:** 2026-10-14
- **Changes:** ADR-012 consequences ("one resource is created by hand: the state store"); TDD Step 0.3 (AWS access).
- **What:** Besides the state bucket, a second manual bootstrap step exists. The person created the IAM user `docbeam-github-deploy` (AdministratorAccess), stored its access key as GitHub repository secrets, set the repository variables `AWS_REGION` and `TF_STATE_BUCKET`, and created the `dev` and `prod` environments. No script creates the deploy user. The README will describe this step.
- **Why:** Terraform needs the deploy user before it can run in CI, and the key must go to GitHub without passing through a file or a log.

## D-G2. Repository secrets, not environment secrets

- **Date:** 2026-10-14
- **Changes:** TDD Step 0.3 ("access keys are stored as GitHub environment secrets").
- **What:** The deploy user's keys are repository secrets `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, as AGENTS.md says.
- **Why:** One deploy user serves dev and prod until the move to OIDC; repository secrets are what the person set up.

## D-G3. Prod gate without a required reviewer

- **Date:** 2026-10-14
- **Changes:** TDD Step 0.3 ("manual approval for prod"); Launch plan ("approval gate").
- **What:** Prod plan, apply and deploy jobs run only on `workflow_dispatch`. They check `github.ref == 'refs/heads/main'`, require an input that must equal `deploy-prod`, and use the `prod` environment (main-only branch rule). They never run on push or merge.
- **Why:** GitHub Free allows no required reviewers on a private repository. A manual run with a typed confirmation is the approval.

## D-G4. Dev apply gated by a switch

- **Date:** 2026-10-14
- **Changes:** TDD Step 0.3 ("apply on merge").
- **What:** The infra workflow always runs plan on pull requests. The dev apply on merge to `main` runs only while the repository variable `INFRA_APPLY_ENABLED` is `true`.
- **Why:** Dev is torn down between testing rounds to save credits, and AGENTS.md needs a yes before AWS changes. Without the switch, every merge would rebuild dev.

## D-G5. The API is served through CloudFront under /api

- **Date:** 2026-10-14
- **Changes:** ADR-015 consequences ("the web app and the API must share one site, for example app. and api. under one domain"); TDD Step 1.4 (CORS and one site), Step 1.6; the Auth Service cookie in the Auth Service contract (`limited to /auth`).
- **What:**
  - CloudFront serves the web app and forwards `/api/*` to the API Gateway HTTP API. The browser only ever calls the CloudFront address for the API.
  - A CloudFront Function on viewer-request strips the `/api` prefix. API Gateway routes, ALB rules and service paths stay as the TDD lists them, and internal callers use the same paths.
  - The `/api/*` behaviour: caching disabled, all methods allowed, the Authorization header, cookies and query strings forwarded to the origin (Host is not).
  - The refresh cookie is `Secure; HttpOnly; SameSite=Strict; Path=/api/auth`.
  - Token issuer `iss` is `https://<cloudfront domain>/api`. The API Gateway JWT authorizer and the services' own JWT checks are otherwise unchanged.
  - The WebSocket API keeps its own execute-api address. It authenticates with the access token, not the cookie, so it does not need the same site.
  - S3 upload and download links stay direct to S3.
  - Locally, the Vite dev server proxies `/api` to the services the same way, so it is one site there too.
  - A custom domain can be added to CloudFront later without changing anything else.
- **Why:** Dev has no domain. `*.cloudfront.net` and `*.execute-api.ap-southeast-2.amazonaws.com` are different sites, so a `SameSite=Strict` cookie would never be sent and the quiet refresh would fail.

## D-G6. Names of people

- **Date:** 2026-10-14
- **Changes:** TDD Auth Service contract (user token claims), DocBeam DB `jobs` and `audit_events`, `GET /jobs` response.
- **What:** User tokens add a `name` claim. `jobs` gets `submitted_by_name text NOT NULL`, filled from the token at submit. Audit events store `actorName` and `actorEmail` in `detail`. `GET /jobs` returns `submittedBy` as `{userId, name}`.
- **Why:** The UI shows who sent a distribution and who did each audited action, but DocBeam stored only user IDs and had no allowed way to look names up.

## D-G7. Names of destinations

- **Date:** 2026-10-14
- **Changes:** TDD `POST /destinations/check` response, DocBeam DB `tasks`.
- **What:** `POST /destinations/check` also returns `teamName` and `path` (for example `Cardio / CARDIO-301 Regulatory / Protocol amendments`) for each destination. `tasks` gets `destination_path text NOT NULL`, stored at submit. The dashboard and `failure_reason` use it.
- **Why:** Tasks held only IDs, and DocBeam may not read Platform DB, so the dashboard could not show where a delivery went.

## D-G8. Owner role and app role per database

- **Date:** 2026-10-14
- **Changes:** TDD Database design ("each reachable only with its owning service's credentials"), audit_events note ("the app role gets INSERT and SELECT only"), Step 0.2 ("one Secrets Manager secret per database role").
- **What:** Each database has a NOLOGIN owner role that owns the tables and runs migrations, and a login app role used at runtime. The DocBeam app role has only INSERT and SELECT on `audit_events`. Six roles in all.
- **Why:** A role that owns a table can always update and delete it, whatever the grants. Without the split the audit trail would not be append-only.

## D-G10. Service clients upserted by the migrate task

- **Date:** 2026-10-14
- **Changes:** TDD Step 1.1 ("seed the four service clients by migration").
- **What:** The Auth Service migrate task runs the migrations, then upserts the four service clients. Their secrets are injected from Secrets Manager (from `.env` locally) and stored as SHA-256 hashes. Re-running it rotates them.
- **Why:** A migration file is in git and cannot hold secret hashes.

## D-G11. ECS cluster, ECR module and DB bootstrap in M0

- **Date:** 2026-10-14
- **Changes:** TDD Repository layout (module list has no `ecr`), Step 0.2.
- **What:** `infra/modules/ecr` is added. M0 also creates the ECS cluster and runs the DB bootstrap task (databases, roles, citext) as a one-off ECS task. The signing-key bootstrap task runs in M1 with the Auth Service.
- **Why:** Step 0.2 names an `ecr` module and says databases and roles are made by a bootstrap task, but that task needs an ECS cluster, which no step created.

## D-G12. Alarms placed in M2, email from a variable

- **Date:** 2026-10-14
- **Changes:** TDD Launch plan "Monitoring" (no step owned the alarms; no threshold for the Delivery error rate).
- **What:** The Upload DLQ alarm is built in Step 2.1, the Job and Task DLQ alarms in Step 2.3, the Delivery error alarm in Step 2.4. The Delivery alarm fires when Errors divided by Invocations is over 1% for 15 minutes. One SNS topic sends email to the address in the repository variable `ALARM_EMAIL`, set by the person before M2.
- **Why:** The four alarms back the no-silent-loss promise, so they need a home and a recipient.

## D-G13. Retry and audit routes built in Step 3.1

- **Date:** 2026-10-14
- **Changes:** TDD Milestone steps (`POST /jobs/:jobId/retry` and `GET /audit` were in the contracts but in no step).
- **What:** Both routes are built in Step 3.1, with cancel.
- **Why:** Step 3.4 builds their buttons and screens, so the routes must exist by then.

## D-G15. Mapping screen follows the mockup

- **Date:** 2026-10-14
- **Changes:** TDD Step 2.6 ("mapping grid with select-all shortcuts").
- **What:** Mapping works as in `docs/design/ui/Main.dc.html`: select files (or "Use all files"), then tick folders in the Destinations tree, with the Review section below. No separate grid.
- **Why:** The mockup is the screen specification. It covers select-all and the live delivery count.

## D-G16. Mockup extras left out

- **Date:** 2026-10-14
- **Changes:** The mockup (Demo controls, System activity, audit events "Files registered" and "Distribution finished", job IDs like `JOB-2040`).
- **What:** The Demo controls and System activity panels are not built. Audit actions are the TDD's list only. A job ID is shown as the first 8 characters of its UUID; "Open by ID" takes the full UUID or a link.
- **Why:** These exist only to explain the mockup, or they conflict with the TDD's schema.

## D-G17. Register screen and password rule

- **Date:** 2026-10-14
- **Changes:** TDD Step 1.1 ("the same error for an existing email"); the mockup has no register screen.
- **What:** A register card in the sign-in style. Passwords are 12 to 72 bytes (bcrypt reads at most 72). Bad input gets 400 VALIDATION_ERROR. An email already in use gets 409 REGISTRATION_FAILED with one generic message.
- **Why:** The design gave no screen, no password rule and no exact error.

## D-G19. Throttle values

- **Date:** 2026-10-14
- **Changes:** ADR-015 and TDD Step 1.4 ("throttles /auth/login and /auth/refresh tightly", no values).
- **What:** Default stage throttling 50 requests a second, burst 100. `/auth/login` and `/auth/refresh` 5 requests a second, burst 10.
- **Why:** Values were needed to build and test it.

## D-G22. Failover drill on dev

- **Date:** 2026-10-14
- **Changes:** TDD M5 checklist ("a database failover (reboot with failover)") against Step 0.2 (dev is single-AZ).
- **What:** For the M5 drill only, dev RDS is switched to Multi-AZ by a Terraform variable, the drill is run, then dev goes back to single-AZ.
- **Why:** A reboot with failover needs Multi-AZ.

## D-G23. Removing a member before deliveries start

- **Date:** 2026-10-14
- **Changes:** TDD M5 checklist ("removing the sender from one of the 20 destination teams right after submitting, before deliveries start").
- **What:** The check pauses the Task Queue trigger, re-runs the seed without that membership, then resumes the trigger.
- **Why:** Deliveries start within seconds of submitting, so without the pause the check races.

## D-M0-1. ecs-cluster and secrets modules

- **Date:** 2026-10-14
- **Changes:** TDD Repository layout (module list), Step 0.2; D-G11.
- **What:** Two modules are added: `infra/modules/ecs-cluster` (the ECS cluster, plus the DB bootstrap task definition, its roles and its log group) and `infra/modules/secrets` (the four service client secrets from `random_password`, and the signing-key secret). Terraform creates the signing-key secret empty, with no secret version, and never manages its value, so the private key never lands in Terraform state. The M1 bootstrap task writes it. Database role passwords stay in the `rds` module.
- **Why:** The layout's module list had no home for the cluster (D-G11) or for secrets that are not database secrets.

## D-M0-2. Migrations run as the owner role through SET ROLE

- **Date:** 2026-10-14
- **Changes:** D-G8 (owner roles are NOLOGIN and "run migrations").
- **What:** Each service's migrate entrypoint connects with the migration login (the RDS master user on AWS, `postgres` locally), then runs `SET ROLE <db>_owner` before migrating, so every object is owned by the owner role. The DB bootstrap makes the master user a member of the three owner roles and sets default privileges from each owner role to its app role.
- **Why:** A NOLOGIN role cannot connect, and the app role must not be a member of the owner role, or it could edit the audit trail.

## D-M0-3. Local stand-ins and build choices

- **Date:** 2026-10-14
- **Changes:** TDD Step 0.1 and Step 0.3 (no detail given).
- **What:**
  - `ws-local` is a second entrypoint of `packages/worker-runtime`, so the repository layout stays as designed.
  - In Docker Compose each service container runs its migrations, then starts. On AWS, migrations stay a one-off ECS task.
  - The Upload Events image is Debian bookworm-slim with Node 22, ClamAV from apt and `aws-lambda-ric`. Amazon Linux 2023 has no ClamAV package.
  - gitleaks runs from its pinned container image.
- **Why:** These were open implementation choices with one simple answer each.

## D-M0-4. State bucket access by IAM only, and dev teardown settings

- **Date:** 2026-10-14
- **Changes:** TDD Step 0.2 ("only the deploy user and the admin user can read it"); PLAN 0.2a.
- **What:** The state bucket has versioning, SSE-KMS with a Bucket Key, Block Public Access and a TLS-only policy, but no bucket-policy deny for other principals. Only the admin user and the deploy user exist in the account, so IAM keeps access to those two. In dev only, every secret has a 0-day recovery window, every bucket `force_destroy`, every ECR repository `force_delete`, and RDS skips the final snapshot with deletion protection off. Prod keeps the safe settings. All of these are module variables.
- **Why:** A wrong deny could lock out the admin user, and this account has no root login to recover. Dev is destroyed and re-created often to save credits, so names must free up at once.

## D-M0-5. LocalStack pinned to 4.14

- **Date:** 2026-10-14
- **Changes:** PLAN G20 ("check in M0 whether an auth token is needed"); TDD Step 0.1 (LocalStack for S3 and SQS).
- **What:** The latest LocalStack image (2026.10.0) exits at start without `LOCALSTACK_AUTH_TOKEN`. LocalStack `4.14` runs without a token and covers S3 and SQS, so Compose and CI pin `localstack/localstack:4.14`. No token is needed in `.env` or in GitHub. Checks LocalStack cannot enforce are proved on dev.
- **Why:** The person did not have to create an account or store another secret. Move to a newer image when a token is set up.

## D-M0-6. No RDS Proxy in dev (Free plan)

- **Date:** 2026-10-14
- **Changes:** ADR-011 consequences ("Every Lambda reaches PostgreSQL through RDS Proxy"); TDD Step 0.2 (module `rds`: "RDS Proxy"; the AWS account plan paragraph, which lists RDS Proxy as allowed on the Free plan); TDD Steps 2.4 and 3.2 ("All database access through RDS Proxy").
- **What:**
  - The Free plan blocks RDS Proxy: `CreateDBProxy` returns `FreeTierRestrictionError: This feature isn't available with free plan accounts`. Found on the first dev apply on 2026-10-14.
  - The `rds` module has a variable `enable_rds_proxy`. Dev is `false`, prod is `true`. With it off, no proxy, proxy role or proxy security group exists, and dev Lambdas connect directly to the instance. The module output `lambda_db_host` is the proxy address when there is one, and the instance address otherwise.
  - No code depends on the proxy. Only the database host in config differs.
  - Every Lambda opens at most 1 connection (`LAMBDA_POOL` in `packages/shared/src/db.ts`: pool max 1, idle timeout 1 second). ECS services use a pool of 2 (`SERVICE_POOL`).
  - Dev sets `max_connections = 100` in a parameter group, so the budget below is a known number. The default for `db.t4g.micro` is about 80 to 110 and cannot be read before the instance exists.
  - **Worst case in dev: 79 connections, which is 79% of 100 and under the 80% limit.** Delivery 50, Upload Events 10, Fan-out 2, DLQ Consumer 2, Sweeper 1, WS Handlers 3 (68 Lambda copies at 1 connection each), 3 ECS services at a pool of 2 (6), 2 one-off tasks (migrate, seed, bootstrap) (2), 3 kept by RDS (3). The unit test `packages/shared/src/db.test.ts` fails if a number changes without this budget changing too.
  - Fan-out, DLQ Consumer, Sweeper and WS Handlers get trigger or reserved concurrency limits in Terraform that match these numbers (Steps 2.3, 2.5 and 3.2). Delivery 50 and Upload Events 10 stay as the design says.
  - **M5 runs with `enable_rds_proxy = true` in dev**, after the account moves to the Paid plan, so the release checks test the prod setup.
- **Why:** The design assumed RDS Proxy is available on the Free plan, and it is not. Without a proxy, 60 Lambda copies could open many connections to a 1 GB instance, so the budget is written down and enforced.

## D-M1-1. Local secrets, signing key and client secret names

- **Date:** 2026-10-14
- **Changes:** TDD Step 0.1 and Step 1.1 (no detail on local secrets); D-G10.
- **What:** `scripts/local-env.sh` creates `.env` from `.env.example` and adds random values that are missing: `JWT_PRIVATE_KEY` (RSA 2048, PEM on one line with `\n`), `CLIENT_SECRET_DELIVERY_WORKER`, `CLIENT_SECRET_DOCBEAM_API`, `CLIENT_SECRET_WS_HANDLERS`, `CLIENT_SECRET_SEED_SCRIPT` and `SEED_USER_PASSWORD`. `.env` is git-ignored; `.env.example` holds names only. CI runs the same script. On AWS the migrate task gets the same four `CLIENT_SECRET_*` names from Secrets Manager (key `client_secret`), and the auth service gets `JWT_PRIVATE_KEY` from the signing-key secret. A one-off task (`node dist/bootstrap-signing-key.js`) writes that secret once and never replaces a key already there. `kid` is the RFC 7638 thumbprint of the public key.
- **Why:** Nothing secret may be in git, and the same names must work locally and on AWS.

## D-M1-2. Internal ALB: one listener per service, plain HTTP (accepted risk)

- **Date:** 2026-10-14
- **Changes:** ADR-001 (internal ALB, no listener detail).
- **What:** The internal ALB has one listener and one target group per service, on the service's own port (auth 3001, platform 3002, docbeam-api 3003). Each API Gateway integration points at its service's listener, so the gateway's route list is the only path list. Services call each other at `http://<alb>:<port>`, so the ALB accepts traffic from the VPC Link and from the services' own security groups, and nothing else.
- **Accepted risk:** Traffic between the VPC Link, the ALB and the services is plain HTTP inside the private network. Security groups limit who can reach it. Internal TLS needs a private certificate and is left for later.
- **Why:** There is no domain, so no public certificate, and path-based ALB rules would copy the gateway's route list.

## D-M1-3. Seed file format

- **Date:** 2026-10-14
- **Changes:** TDD Step 1.2 (no format given).
- **What:** JSON files in `services/platform/seed/`. `demo.json` has Cardio, Oncology and Neuro with Priya Shah, Raj Mehta and Sam Ito, as in the mockup. `dev-load.json` has 50 teams, each with 2 binders and 21 nested folders, and one user `load.user@example.com` in all of them. Both are written by `seed/generate.mjs` with UUIDv5 ids, so a re-run changes nothing. Local and dev load both; prod loads neither until the client's hierarchy exists (G18, `SEED_FILES` empty).
- **Why:** The design gave no format, and fixed ids make the script safe to re-run.

## D-M1-4. Seed users in dev

- **Date:** 2026-10-14
- **Changes:** TDD Step 1.2 ("creating seed users first in dev").
- **What:** With `SEED_CREATE_USERS=true` (local and dev) the seed script registers each user through `POST /auth/register` with the one seed password and treats 409 as "already there". Every email is then resolved with `GET /internal/users` and the `seed-script` token. A 404 means no account and the email is skipped with a warning; any other answer stops the run, so a blip cannot prune memberships.
- **Why:** The Auth Service is the only owner of user ids (ADR-009).

## D-M1-5. First-bytes check

- **Date:** 2026-10-14
- **Changes:** TDD Step 1.3 ("checks the file's first bytes against the declared type").
- **What:** PDF `%PDF-`, PNG signature, JPEG `FF D8 FF`. DOCX and XLSX are both ZIP files, so both are checked against `PK\x03\x04`; the first bytes cannot tell them apart.
- **Why:** A rule per type was needed.

## D-M1-6. POST /documents field order

- **Date:** 2026-10-14
- **Changes:** TDD `POST /documents` contract (multipart, no field order).
- **What:** The text fields must come before the file part. Membership, destination and the repeat check run before one byte of the file is read; otherwise 400 VALIDATION_ERROR.
- **Why:** A repeat must return 200 without reading a possible 1 GB file.

## D-M1-7. Sign-in pause details

- **Date:** 2026-10-14
- **Changes:** ADR-015 (pause, no mechanics).
- **What:** The fifth wrong password in a row sets `locked_until` to 15 minutes ahead and resets `failed_logins` to 0, inside a transaction that locks the user row. A right password resets the count. A paused account gets the same 401 even with the right password, after the same password comparison. An unknown email compares against a dummy hash, so timing does not show whether an account exists. `services/auth/src/unlock-user.ts` ends a pause early (support script).
- **Why:** The same message and timing for every failure.

## D-M1-8. A new tab tries one quiet refresh

- **Date:** 2026-10-14
- **Changes:** TDD Step 1.6 (silent on a tab with no token).
- **What:** The access token is in sessionStorage, which each tab has separately. A tab with no usable token calls `/auth/refresh` once, under the Web Lock, before it shows sign-in. Other tabs get the new token over a BroadcastChannel.
- **Why:** So opening a second tab does not ask for the password.

## D-M1-9. Destination tree

- **Date:** 2026-10-14
- **Changes:** Mockup Destinations panel.
- **What:** The tree shows teams, binders and folders; documents are not destinations and are left out. Both binders (top level) and folders can be ticked. The filter searches the levels already opened. With 5 teams or fewer the teams open at once; with more they open on click. Team colours come from a fixed palette by position.
- **Why:** The browse API is one level at a time, and 50 teams would send 50 requests on load.

## D-M1-10. Database connection on AWS

- **Date:** 2026-10-14
- **Changes:** D-M0-1 (role secrets hold user and password but no host).
- **What:** Services accept `DATABASE_URL` (local) or `DB_HOST`, `DB_NAME`, `DB_USER` and `DB_PASSWORD` (ECS injects user and password from the role's secret and the host from Terraform). Migrate tasks use `MIGRATION_DB_USER` and `MIGRATION_DB_PASSWORD` from the RDS master secret. Connections built from parts use TLS without chain checks, because Node does not know the RDS certificate authority.
- **Why:** The secret has no host, and no value should be copied into Terraform.

## D-M1-11. Web tests

- **Date:** 2026-10-14
- **Changes:** TDD Testing strategy (no web layer named).
- **What:** vitest with jsdom and React Testing Library for the token and session logic (refresh, one retry on 401, the ended state), the 20-destination limit and the lazy tree. The browser checks in `docs/testing/M1-TESTING.md` are by hand.
- **Why:** These rules are where a mistake would hurt, and they run in every CI pass.

## D-M1-12. CORS origins and the page rewrite in CloudFront

- **Date:** 2026-10-14
- **Changes:** TDD Step 1.4 ("CORS for the web app's origin only"); the web distribution's error pages from M0.
- **What:**
  - CloudFront and the API share one site, so the browser never makes a cross-origin call. The gateway's CORS (credentials allowed) is set from the variable `cors_allowed_origins`: `http://localhost:5173` in dev, empty in prod. CloudFront's own address cannot be named there, because the distribution's origin is the API, and an API that names the distribution would make a cycle in Terraform.
  - The M0 error pages (403 and 404 become `index.html` with 200) apply to every behaviour, so an API 404 such as "another team's binder" would arrive as a 200 page. They are removed. A CloudFront Function on the web behaviour serves `index.html` for any path without a dot.
- **Why:** Without both changes the cookie flow works but the 404 rule is hidden from the browser.
- **Accepted by the person, 2026-10-14:** no CORS origin in prod, `http://localhost:5173` in dev.

## D-M1-13. Authorizer switch for the first bring-up, native bcrypt, bigger auth task

- **Date:** 2026-10-14
- **Changes:** TDD Step 1.1 (bcrypt cost 12, "ECS Fargate, 2 tasks"), Step 1.4 (the JWT authorizer). Found on the first dev apply.
- **What:**
  - **Authorizer.** API Gateway fetches `<issuer>/.well-known/openid-configuration` when it creates the JWT authorizer, so the Auth Service has to answer through CloudFront first. Both environments have a variable `jwt_authorizer_enabled` (default `true`). A brand-new environment is applied once with `false`: only the public routes exist, the four protected routes do not exist at all and answer 404 (never open). After the DB bootstrap, the signing-key task and the deploys, it is applied again with `true`. Later applies keep `true`.
  - **bcrypt.** The pure-JavaScript library took 1.6 s a hash on the 0.25 vCPU task and, with a transaction held open during the compare, 31 of 40 parallel logins failed with 500. The Auth Service now uses the native `bcrypt` package (228 ms a hash on the laptop) and compares the password before it opens the short transaction that updates the counters. Cost stays 12.
  - **Size.** The Auth Service task is 0.5 vCPU and 1 GB (the others stay 0.25 vCPU and 0.5 GB), because bcrypt is CPU-bound by design.
- **Why:** A first apply that always fails, and a login that fails under load, are both defects the design did not foresee.

## D-M1-14. Image tag in Terraform, seed as its own compose run, deploy guards

- **Date:** 2026-10-14
- **Changes:** TDD Step 0.3 (infra workflow), Launch plan (seed as a deploy step); found on the PR checks.
- **What:**
  - `image_tag` in `infra/envs/*` now defaults to `bootstrap`. Terraform only needs a tag to create the task definitions; the services ignore their task definition after the first apply and `scripts/deploy-service.sh` registers revisions with the git SHA. The CI plan therefore needs no value. A new environment still passes the pushed tag on its first apply (README, testing document). A later `terraform apply` registers new revisions with the image `bootstrap`; `deploy-service.sh` replaces the image, so nothing running changes, but `scripts/run-task.sh` on a family needs a deploy first.
  - The `seed` service in Docker Compose has a profile and is started with `docker compose run --rm seed`, because `docker compose up --wait` counts a container that exits as a failure (found by CI). CI runs it after `up`.
  - The ECS deploy jobs (`_service.yml`) check that the service is `ACTIVE` first and skip with a notice if it is not. The web deploy jobs do the same on the `web_bucket` output. A merge while dev is down no longer turns red.
- **Why:** Three defects in the pipeline that the local run did not show.

## D-M1-15. Deploys are idempotent per image, with a force switch

- **Date:** 2026-10-14
- **Changes:** TDD Step 0.3 and Launch plan (deploy steps, no repeat rule); found when the M1 merge ran every workflow twice.
- **What:**
  - `scripts/deploy-service.sh` first reads the service's current task definition. If it runs the target image **and** carries the tag `deployed-by=deploy-service.sh`, the script prints a notice and exits 0 before migrating, seeding or updating. The script puts that tag on every revision it registers.
  - The marker is needed because Terraform creates the first task definitions with an image tag that can equal the one being deployed. Such a revision has no marker, so the first deploy of an environment always runs.
  - `--force` or `FORCE_DEPLOY=true` skips the check. The three service workflows have a `force` boolean input on `workflow_dispatch`, passed to the deploy jobs.
  - A manual run from `main` without the prod confirmation now deploys dev (so `force` can be used there). With `confirm=deploy-prod` it deploys prod only, as before.
  - `tests/scripts/deploy-service.test.ts` runs the script against a fake `aws` and covers: skipped when already deployed, deploys on another image, deploys on a first run without the marker, deploys with `--force` and with `FORCE_DEPLOY=true`.
- **Why:** The PR was merged twice and every service ran migrations, the seed and a rolling update twice. The result was harmless but wasteful, and a re-run or a duplicate event must not roll a service.

## D-M2-1. `image_tag` stays optional; one-off tasks run only marked revisions

- **Date:** 2026-10-15
- **Changes:** D-M1-14 follow-up (a later apply registers task definitions with the image `bootstrap`).
- **What:** `image_tag` keeps its default `bootstrap`. `scripts/run-task.sh` runs the newest revision of a family that carries the tag `deployed-by=deploy-service.sh` (D-M1-15) and stops with "deploy the service first" if none does. `deploy-service.sh` marks the `-seed` family too. `tests/scripts/run-task.test.ts` covers both cases.
- **Why:** The services are path-filtered and run different tags, so one required tag would still register revisions with an image a service does not run, and CI does not know a real tag. Fixing the consumer removes the harm at its source.

## D-M2-2. Alarms module, email from `ALARM_EMAIL`

- **Date:** 2026-10-15
- **Changes:** TDD repository layout (module list), D-G12.
- **What:** `infra/modules/alarms` holds the SNS topic, the email subscription (`alarm_email`, no default) and the four alarms: Job, Task and Upload DLQ depth above 0 for 5 minutes, and Delivery Errors over Invocations above 1% for 15 minutes. CI passes `TF_VAR_alarm_email` from the repository variable.
- **Why:** No module held them, and the address must come from the variable the person set.

## D-M2-3. File age is measured from `files.created_at`

- **Date:** 2026-10-15
- **Changes:** TDD Submission checks ("uploaded more than 24 hours ago").
- **What:** FILE_TOO_OLD is decided from `created_at`, inside the same conditional claim `UPDATE`, the column the daily cleanup deletes on.
- **Why:** One column for both sides makes "claimed or deleted, never both" exact.

## D-M2-4. 503 PLATFORM_UNAVAILABLE on submit; the web retries with the same key

- **Date:** 2026-10-15
- **Changes:** TDD Submission checks (no answer for a platform that is down).
- **What:** When `POST /destinations/check` fails or times out, `POST /jobs` returns 503 `PLATFORM_UNAVAILABLE` and creates nothing. The web app shows "The platform is not answering. Try again." and the next Send reuses the same Idempotency-Key, so a retry can never create a second job.
- **Why:** The design did not say what the caller sees, and a retry must be safe.

## D-M2-5. Lambda secrets are fetched by ARN

- **Date:** 2026-10-15
- **Changes:** TDD Step 0.2 (secrets "injected at runtime"; Lambda has no ECS-style injection).
- **What:** A Lambda's environment holds only secret ARNs. `packages/shared/src/secrets.ts` reads them with GetSecretValue on a cold start and caches them. Locally the plain env names from `.env` are used.
- **Why:** Keeps secret values out of Terraform state and the function configuration.

## D-M2-6. Terraform creates Lambdas from a placeholder; a script deploys the code

- **Date:** 2026-10-15
- **Changes:** TDD Step 0.3 (Worker workflow), PLAN "Small choices" ("Terraform deploys each Lambda once from a local build").
- **What:** Zip Lambdas start from a tiny placeholder built by `archive_file`. The Upload Events Lambda starts from the pushed `upload-events` image. Both ignore later code changes in Terraform. `scripts/deploy-lambda.sh` deploys the real code, as `deploy-service.sh` does for ECS, and skips with a notice when the function does not exist or already runs that code.
- **Why:** CI has no bundles at plan time, and the ECS split already works.

## D-M2-7. Checksum encodings

- **Date:** 2026-10-15
- **Changes:** TDD DocBeam DB `files.checksum_sha256` and `s3_checksum` (encoding not stated).
- **What:** `checksum_sha256` is hex (as the browser sends it and as `POST /documents` takes it). `s3_checksum` is what S3 reports: base64, and `<base64>-<parts>` for a multipart file. A single-part file stores the base64 of its declared SHA-256.
- **Why:** The two columns meet at the Delivery check and must compare exactly.

## D-M2-8. A mismatched upload is refused and the object deleted

- **Date:** 2026-10-15
- **Changes:** TDD Step 2.1 (size and checksum "checked against the file row", no outcome for a difference).
- **What:** On a size or checksum difference the Upload Events Lambda deletes the object, sets `scan_status = 'failed'` and writes `file.refused` with `detail.reason = "MISMATCH"`. Malware gives `reason = "MALWARE"` plus the signature name. `actor_id` is NULL and `detail.ownerUserId` names the owner, so only the owner sees it.
- **Also:** The Lambda computes the SHA-256 of the bytes during the scan pass and compares it with the declared `checksum_sha256`, besides comparing S3's reported checksum. This covers a multipart file's whole-file checksum (S3 reports only a combined one) and a store that does not enforce the checksum of a presigned POST (LocalStack 4.14).
- **Retry timing:** The queue's visibility timeout is 3,600 s, so the handler sets its own gap with ChangeMessageVisibility: 30 s while a multipart upload is not yet recorded, and 30 s, 1, 2 and 5 minutes after an error.
- **Why:** The page needs a reason, and the user adds the file again.

## D-M2-9. Concurrency of the smaller Lambdas

- **Date:** 2026-10-15
- **Changes:** D-M0-6 (budget numbers), TDD Step 2.5.
- **What:** SQS triggers cannot have a maximum concurrency below 2, so three DLQ triggers would allow 6. The DLQ Consumer gets reserved concurrency 2 and the Sweeper 1. Fan-out has trigger maximum 2. Delivery 50 and Upload Events 10 stay as designed. The 79-connection budget in `db.test.ts` does not change.
- **Why:** Keeps the dev connection budget true.

## D-M2-10. Web libraries

- **Date:** 2026-10-15
- **Changes:** TDD Step 2.6 (no libraries named).
- **What:** `@noble/hashes` for the incremental SHA-256 in the Web Worker (`crypto.subtle` cannot hash in parts). Local preview: PDF in the browser's own viewer, PNG and JPG as images, DOCX with `docx-preview`, XLSX with `exceljs`, both loaded only when used (and reused in M4).
- **Why:** A 1 GB file cannot be hashed in one call, and M4 needs the same viewers.

## D-M2-11. Presigned links locally

- **Date:** 2026-10-15
- **Changes:** TDD Step 2.1 (links "signed locally").
- **What:** docbeam-api signs with a second S3 client on `S3_PUBLIC_ENDPOINT` (`http://localhost:4566` in Compose) so the browser can reach LocalStack. Unset on AWS.
- **Why:** The browser cannot resolve `localstack`.

## D-M2-12. ClamAV scan limits

- **Date:** 2026-10-15
- **Changes:** TDD Step 2.1 ("scan limits raised to 1 GB").
- **What:** The limit is 1100 MB, a little above the 1 GiB file limit, so no valid file reaches it. Lambda: `clamscan --max-filesize=1100M --max-scansize=1100M --alert-exceeds-max=yes`. Compose: the clamav image's `CLAMD_CONF_*` environment (`StreamMaxLength`, `MaxFileSize`, `MaxScanSize` 1100M, `AlertExceedsMax yes`), so no mounted config file. A file or archive over a limit is reported as found and refused; a scan that could not finish throws and the event is retried. Neither reads as clean.
- **Why:** The default limits are far below 1 GB, and without `AlertExceedsMax` ClamAV skips an over-limit file and reports it clean.

## D-M2-13. The daily ClamAV rebuild skips while dev is down; the image repository keeps 3 images

- **Date:** 2026-10-15
- **Changes:** TDD Step 0.3 (scheduled rebuild), `infra/modules/ecr` (`keep_images` 20 for every repository).
- **What:** The scheduled build in `upload-events-image.yml` first checks that the `docbeam-dev/upload-events` repository and the `docbeam-dev-upload-events` function exist, and skips with a notice if either does not (dev destroyed). The `ecr` module takes `keep_images_by_repository`; `upload-events` keeps the last 3 images, the others keep 20.
- **Why:** Dev's repository is deleted on destroy, so a daily build would fail every day, and a new 1 GB image every day would otherwise pile up.

## D-M2-14. Working rule for a large milestone

- **Date:** 2026-10-15
- **Changes:** AGENTS "How to work" (handover only at the end).
- **What:** After each M2 task: commit, then update `docs/STATUS.md` with "done" and "next task", so a new session can continue. All local tasks (0 to 10 and the local part of 11) come first; the session stops before the first AWS step and waits for the person.
- **Why:** M2 is too large for one conversation.

## D-M2-15. A missing S3 checksum fails delivery on AWS, and is allowed only locally

- **Date:** 2026-10-15
- **Changes:** TDD Step 2.4 ("A checksum different from `files.s3_checksum`: CHECKSUM_MISMATCH", silent on no checksum).
- **What:** On AWS the POST policy and the part links require a SHA-256, so every staged object has one. Delivery treats a HEAD answer with no checksum as CHECKSUM_MISMATCH. LocalStack 4.14 stores none for a presigned POST, so Compose alone sets `S3_CHECKSUM_OPTIONAL=true`, which skips the comparison only when the checksum is absent. A present checksum that differs always fails.
- **Why:** Nothing is left unchecked locally: Upload Events hashed the bytes and the platform recomputes the SHA-256. On AWS an object without a checksum must not pass.

## D-M2-16. A push follows each final status only

- **Date:** 2026-10-15
- **Changes:** TDD Step 2.4 and "WebSocket API" (when a push is sent).
- **What:** Delivery and the DLQ Consumer push `task_update` after a final write (completed or failed), never at the claim or when a task goes back to pending. The sender gets counts for the whole job; a team viewer only for their teams. An unset `WS_MANAGEMENT_ENDPOINT` means no push. `finishTask` and `pushTaskUpdate` live in `packages/shared` so both workers share them.
- **Why:** The dashboard shows counts and reasons, and a pending-to-in-progress flip carries neither.

## D-M2-17. Draining: the platform finishes what it started

- **Date:** 2026-10-15
- **Changes:** STATUS "Draining" (D-M1-14 follow-up), Compose commands.
- **What:** On SIGTERM the platform stops accepting requests, lets running ones finish and closes connections as they go idle (every 250 ms), then exits. Without that, Fastify's 72 s keep-alive held the process for about a minute after the last response. Compose runs `exec node dist/server.js`, so node is PID 1 and receives the signal (an `sh -c` wrapper did not pass it on). `tests/integration/platform-drain.test.ts` sends SIGTERM during a 4 s upload and expects 201 and the stored document. The 120 s target group delay and `stopTimeout` are set in Terraform (task 8).
- **Why:** A rolling deploy must not cut a delivery that streams a large file.

## D-M2-18. Terraform for the asynchronous half: modules, flags and one widening

- **Date:** 2026-10-15
- **Changes:** TDD Steps 2.1 to 2.5 (infrastructure), D-M2-2, D-M2-6, D-M2-9, D-M2-13.
- **What:**
  - New modules `sqs` (three queues with DLQs, SSE-SQS, 14 days, visibility 360, 720 and 3,600 s, redrive 3, 5 and 5, a queue policy for S3), `lambda` (one VPC function with its role, group, log group and SQS triggers; code changes ignored, D-M2-6), `alarms` (D-M2-2) and `scheduler` (the Sweeper's two schedules). `infra/envs/*/async.tf` wires them; dev and prod are identical there.
  - Trigger limits: Upload Events 10, Fan-out 2, Delivery 50. The DLQ Consumer has three triggers of 2 and reserved concurrency 2. The Sweeper has reserved concurrency 1 (D-M2-9).
  - The `s3` module gets `upload_events_enabled`. The notification's `count` and the clean-tag rule depended on ARNs that are unknown until apply, which `terraform plan` rejected; a flag known at plan time fixes it.
  - The queue policy takes the bucket ARN built from its name, so the queue does not wait for the bucket's notification (which waits for the queue).
  - The platform's target group drains for 120 s and its container has `stopTimeout` 120 (D-M2-17). Others stay at 30 s.
  - The ECR repository `upload-events` keeps 3 images (D-M2-13).
  - The DocBeam API routes of M2 are public routes with the JWT authorizer. The infra workflow passes `TF_VAR_alarm_email` from `ALARM_EMAIL`.
- **Widening, narrowed on 2026-10-15:** the Delivery Lambda's security group was first allowed on every ALB listener. The `alb` module now takes `clients`, each with an optional `services` list, and Delivery is allowed only on the Auth Service and platform listeners (3001 and 3002). The other clients keep every listener.
- **Also:** `terraform init -upgrade` added the `archive` provider (the placeholder zip) and moved the AWS provider from 6.68.0 to 6.69.0 in both lock files.
- **Found by:** a read-only `terraform plan` of dev from an empty state (251 resources to add, no error), run on 2026-10-15 with `-lock=false`.
- **Why:** M2 needs the queues, functions, alarms and schedules in code before the first apply.

## D-M2-19. The Upload DLQ writes `file.refused` with reason SCAN_FAILED

- **Date:** 2026-10-15
- **Changes:** TDD Step 2.5 ("mark the file `failed`", no event), D-M2-8.
- **What:** When the DLQ Consumer marks a still-pending file `failed`, the same statement writes one `file.refused` audit event: `actor_id` NULL, `detail.reason = "SCAN_FAILED"`, `detail.ownerUserId`, `fileId`, `fileName`. A repeated message changes nothing and writes no second event.
- **Why:** The other two refusals (MISMATCH, MALWARE) leave an event the owner can see; a file that could not be checked should leave the same trace.

## D-M2-20. Web upload and preview choices

- **Date:** 2026-10-15
- **Changes:** TDD Step 2.6 (no limits or error handling named), D-M2-10.
- **What:**
  - **Preview size.** DOCX and XLSX preview up to 50 MB. Above that the dialog says the file is too large to show in the page. PDF and images have no cap (the browser's viewer streams them).
  - **Sandboxed preview.** The rendered HTML of a DOCX or XLSX goes into an `<iframe sandbox>` with no `allow-scripts` and no `allow-same-origin`, through `srcdoc`, so the same viewer is safe in M4 for files other people sent. PDFs open in the browser's viewer from an object URL; images in an `<img>`.
  - **Ticks need files.** A destination can be ticked only while the page holds a file that can be sent (mockup). A tick applies to the selected files, or to all files when none are selected.
  - **Link freshness.** Upload links and part links are refreshed after 13 minutes (2 minutes of margin on 15).
  - **Storage answers.** A 400 (for example BadDigest or a size mismatch) and a 403 that is not an expired link both give "Refused by storage" with Retry and the message that the file did not match what was checked. A 403 that says the link expired gets one fresh link. A broken connection or a 5xx is retried after 2, 4 and 8 seconds, then the file shows "Upload interrupted"; Retry carries on from the parts already stored.
  - **Leaving the page.** Whenever the page holds a file that has not been sent (any file on it, whatever its state, until Send clears the page), the browser asks before the page is closed or reloaded (`beforeunload`). First written for files still uploading only; changed on 2026-10-16 after the dev browser run showed that a reload with everything `Verified` lost the prepared batch without a warning.
  - **No bottom-bar summary (deviation from the mockup, 2026-10-16).** The line "N files to N destinations, each uploaded once" is removed from the Send bar. The "This distribution" card and the Send button already show the counts. Decided by the person after the browser run.
  - **After Send.** The page clears and shows "Distribution <first 8 characters of the job id> sent. N deliveries queued." The Status page is M3.
- **Why:** The design left these open, and each one decides what the user sees when something goes wrong.

## D-M2-21. Demo user Anantim Patil in all three demo teams
- **Date:** 2026-10-16
- **Changes:** D-M1-3 and D-M1-4 (seed format and seed users).
- **What:** `demo.json` gets a fourth user, "Anantim Patil" (`anantim.patil@example.com`), a member of Cardio, Oncology and Neuro. It uses the same seed password as the other users. `seed/generate.mjs` writes it, so every id stays the same. `dev-load.json` is unchanged. The first seed run of `demo.json` now reports `membersAdded 7` (was 4).
- **Why:** One login that sees every destination makes the browser checks of M2 to M4 shorter. Priya, Raj and Sam keep their old teams, so the isolation checks still hold.

## D-M2-22. Platform memory under many large deliveries
- **Date:** 2026-10-16
- **Changes:** TDD Step 1.4 (the Document Platform runs on 0.25 vCPU and 0.5 GB), TDD Step 2.4 (Delivery streams the file to the platform), ADR-011 (Delivery cap of 50).
- **What:**
  - The platform's upload to the Platform File Store holds one 5 MB part at a time (`queueSize` 1, `partSize` 5 MB; `UPLOAD_BUFFER` in `documents.ts`).
  - The platform task has 1 vCPU and 2 GB (was 0.25 vCPU and 0.5 GB) in dev and prod. A first step to 1 GB did not pass the stress check (see below).
  - The platform ingests at most 6 files at once (`IngestLimiter`, `MAX_CONCURRENT_INGESTS`). More requests wait inside the process for their turn. A request that has waited 30 s (`MAX_INGEST_WAIT_MS`) is answered `503 PLATFORM_BUSY` with `Retry-After: 30` and the connection closed, before any of its bytes are read. Delivery already treats any 503 as temporary and retries with its own gaps, and its platform call times out only after 100 s, so a waiting call is never cut off. The check is made at the moment the 30 s are up, not predicted when the request arrives.
  - Delivery's cap of 50 is unchanged.
  - **The platform is a stand-in** for the client's real Document Platform. These numbers size the stand-in only. The real platform's ingest capacity (how many large files it takes at once, and how it answers when it is busy) is for the client to confirm.
- **Why:** The first dev run with 14 deliveries of a 120 MB file at once killed three platform tasks in a row (exit 137, `OutOfMemoryError`), and the 14 tasks got `The platform answered 502` while the platform restarted. The SDK default held about 20 MB per upload, so 50 at once needed about 1 GB of buffers alone, on a task with 512 MB. The design bounded the number of deliveries but not the memory of each. Found by the dev check "forced platform deploy during a slow ingest" (M2-RESULTS 3). The agreed stress check is 50 concurrent large deliveries (5 files of 120 MB to 10 folders) with peak MemoryUtilization under 80%, no OOM, and every task `completed`.
  - **Second run (1 GB, one 5 MB part at a time):** failed. Memory reached 95 to 98% and CPU 100% on 0.25 vCPU, and three tasks were killed. Memory is not only the upload buffer: a task with 0.25 vCPU cannot hash and re-upload 50 streams as fast as they arrive. So the work is bounded (6 at once) and the task gets more CPU.

## D-M2-23. `terraform destroy` cannot empty large versioned dev buckets (proposal for M3)
- **Date:** 2026-10-16
- **Changes:** Nothing in the design. Affects the teardown steps in the README and `docs/testing/M*-TESTING.md` (section "Tear down").
- **What happened:** The first dev teardown destroyed the VPC, RDS, ECS, ECR, Lambdas, queues and CloudFront in about 23 minutes, then failed on the two data buckets:
  `emptying S3 Bucket (docbeam-dev-object-store-346208529537): listing S3 bucket … object versions: … decomposing response: bufio.Scanner: token too long`, and the same for `docbeam-dev-platform-files-346208529537`. The AWS provider's `force_destroy` empties a bucket by listing its object versions, and that listing failed on buckets with 269 and 1,658 versions (1.9 GB and 8.6 GB after the M2 load tests). Terraform left the two buckets in state and exited 1.
- **What fixed it (by hand, with the person's yes):** a throwaway script deleted every version and delete marker of those two buckets only, 1,000 at a time with `aws s3api delete-objects`, then the same `terraform destroy` finished (`Destroy complete! Resources: 2 destroyed.`). The state bucket was never touched. The AWS CLI's listing worked where the provider's did not. Afterwards `aws s3 ls | grep docbeam` showed only `docbeam-tfstate-346208529537` and `aws ecs list-clusters` was empty.
- **Proposed fix for M3 (not built):**
  1. **Preferred: `scripts/empty-dev-buckets.sh`**, run before every dev `terraform destroy` (the README and the Tear down sections say so). It takes the environment, refuses `prod` and any bucket not named `docbeam-dev-…-<account id>` (never the `…-tfstate-…` bucket), lists versions and delete markers with the AWS CLI and deletes them in batches of 1,000. It is the script used above, with the names read from the Terraform outputs, and a test in `tests/scripts` like the other deploy scripts.
  2. **Alternative: a dev-only lifecycle rule** (a variable on the `s3` module, on in dev and off in prod) that expires noncurrent versions and delete markers after 1 day. It keeps buckets small between sessions but does not empty a bucket that was filled today, so it would not remove the need for a script before a same-day teardown.
  3. **Not recommended:** pinning an older AWS provider, which would fix the listing but trades one problem for another.
- **Why this matters:** the bucket sizes grow with every test run, so each dev teardown will hit it again unless one of the above is built. Until then, teardown is: empty the two buckets with the CLI, then `terraform destroy`. Prod buckets must never be emptied this way; prod is not deployed in this project.

## D-M3-1. `/favicon.ico` is served from the SVG by the CloudFront Function
- **Date:** 2026-10-16
- **Changes:** Nothing in the design. Closes M2 accepted NO N7 (`/favicon.ico` answered 403).
- **What:** The CloudFront Function on the web behaviour (`spa`, in `infra/modules/cloudfront`) rewrites `/favicon.ico` to `/favicon.svg`. No `.ico` file is added to `web/public`.
- **Why:** A binary `.ico` cannot be written with the Write tool, and the rewrite needs no new file. Browsers accept an SVG answer for `/favicon.ico`.

## D-M3-2. One Popover for the "+N" chip in destination cells
- **Date:** 2026-10-16
- **Changes:** M2 Distribute screen (destinations cell), mockup. Asked for by the person after the M2 browser runs.
- **What:** The tooltip that repeated the whole folder list is removed. A visible folder chip's title is its own full path. The "+N" chip is a button (`aria-label="Show N more folders"`) that opens a small `Popover` component with only the hidden folders, grouped by team with the team colour, scrolling after about 8 rows. Hover or click opens it; click keeps it open; Esc, a click outside or Tab away closes it. No library. The same component is used in the M3 job tables.
- **Why:** A native `title` cannot be reached by keyboard or touch and hid information.
- **Where it is used:** the Documents table of the Distribute screen and the "Sent to" line in the header of a distribution (the job detail). A delivery row has one destination, so it needs no "+N".

## D-M3-3. A retry also pushes a `job_update`
- **Date:** 2026-10-16
- **Changes:** TDD API contracts (`POST /jobs/:jobId/retry` names no push) and "WebSocket API" (a `job_update` is sent after a cancel).
- **What:** After the retry commits, the DocBeam API sends one `job_update` to the job's open dashboards, with the counts each viewer may see, as it does after a cancel. The pages reload their deliveries. The sender asked for "retry and cancel with their pushes".
- **Why:** A retry moves tasks from failed to pending. Another tab or a team viewer would otherwise keep showing them as failed until the next fetch.

## D-M3-4. Subscribe is answered over the connection; the management address comes from the event
- **Date:** 2026-10-16
- **Changes:** TDD "WebSocket API" (`subscribe`: "allowed: sets job_id and team_ids; not allowed: rejects").
- **What:**
  - The WS Handler answers a `subscribe` with a message on the same connection: `{type: "subscribed", jobId}`, or `{type: "subscribe_error", jobId, code}` with `NOT_FOUND` (a missing job and a hidden one give the same answer), `VALIDATION_ERROR` or `UNAVAILABLE` (the platform could not be asked). A refused subscribe also clears the connection's earlier job.
  - The page subscribes, waits for `subscribed`, and only then fetches (TDD Step 3.3). Without an answer the order could not be kept: the fetch could run before the row is updated. If no answer comes within 5 seconds the page fetches anyway, and a late answer makes it fetch once more.
  - The handler finds its management address in the event (`https://<domain>/<stage>`), so the WS Lambda does not need the API's address in its own configuration (that would be a Terraform cycle). Locally `WS_MANAGEMENT_ENDPOINT` names ws-local itself. Its permission to post is `execute-api:ManageConnections` on every API of the account in the region, because naming this API would be the same cycle. Delivery, the DLQ Consumer and the DocBeam API get the exact address and the exact resource.
  - `$connect` has no gateway authorizer: the handler checks the token in the query string against the keys, and answers 401. A service token is refused.
- **Why:** The design says the browser subscribes before fetching but gives the handler no way to say when it has finished.

## D-M3-5. Small additions to the read routes
- **Date:** 2026-10-16
- **Changes:** TDD API contracts (`GET /jobs/:jobId`, `GET /jobs/:jobId/tasks`, `GET /audit`).
- **What:**
  - Job detail adds `asOf` (the server's clock when the counts were read, so the page can ignore pushes older than its fetch without trusting the browser's clock), `destinations` (the folders the caller may see, for the header), `isSender`, and for the sender only `fileCount`, `retry` (`open`, `retryable`, `reason`) and `cancel` (`open`, `waiting`). The Retry and Cancel rules live on the server, so the page and the routes cannot disagree.
  - Counts are `{pending, in_progress, completed, failed}` everywhere, as in the pushes.
  - Tasks come as `{page, limit, total, tasks}`; each task adds `fileName`, `destinationPath`, `attemptCount` and `fileExpired` (the staged file is past 33 days) so the table needs no second call. They sort by file name, destination and id, so paging is stable. Page size 100.
  - `GET /jobs` pages 20 by default, at most 100. `GET /audit` pages 50 by default, at most 200, and returns `{page, limit, hasMore, events}`. `action` takes one action or several separated by commas (the page's Deliveries filter is two actions).
  - A job-wide event of someone else's distribution shows only `actorName`.
- **Why:** The design lists the fields but not the envelope, the paging or the sort.

## D-M3-6. Page position in the URL hash; Distribute stays mounted
- **Date:** 2026-10-16
- **Changes:** TDD Step 3.4 (no routing named); D-M2-20 (leave warning).
- **What:** The tab and the open distribution are in the URL hash (`#/status/<job id>`, `#/audit`). A reload mid-run opens the same distribution and catches up, and the link can be shared ("Copy link"; Open by ID takes the full id or a link, not the 8-character short id). The Distribute screen stays mounted (hidden) while Status or Audit shows, so a prepared batch is not lost by looking at a distribution. After Send the page opens the new distribution.
- **Why:** "Refresh mid-run without losing anything" needs the page to know where it was.

## D-M3-7. The task table is virtualized by hand
- **Date:** 2026-10-16
- **Changes:** TDD Step 3.4 ("a virtualized table for up to 2,000 tasks").
- **What:** A fixed 64 px row, a window of the rows in view plus six either side, and the 100-row page of any row that scrolls into view is loaded when needed. About 100 lines in `web/src/tracking/virtual.ts` and `TaskTable.tsx`, no library. Pushes change a loaded row in place (an older push is ignored); with a status filter on, the loaded pages are fetched again after the pushes go quiet, because a row may leave the list.
- **Why:** One small, fully tested piece is cheaper than a new dependency.

## D-M3-8. The WS Handlers' reserved concurrency is 3, and they answer 503 when throttled
- **Date:** 2026-10-16
- **Changes:** D-M0-6 (budget: WS Handlers 3).
- **What:** The `ws` Lambda has reserved concurrency 3, the number the 79-connection budget counts (`packages/shared/src/db.test.ts` is unchanged and passes). API Gateway invokes it for each connect, subscribe and disconnect. If a burst needs more than 3 at once, the extra events are throttled and a browser sees a failed connect or no `subscribed` answer; it reconnects with a back-off, or fetches without the live connection after 5 seconds. With RDS Proxy on (prod, M5), this number can rise.
- **Why:** The dev budget is a hard limit (D-M0-6), and every part of the page has a path that works without the live connection.

## D-M3-9. The Sweeper's daily run deletes expired connection rows
- **Date:** 2026-10-16
- **Changes:** TDD Step 2.5 (the Sweeper's daily run deletes old unsubmitted files only).
- **What:** The daily `cleanup` also runs `DELETE FROM ws_connections WHERE expires_at < now()`. A browser that vanished without a `$disconnect` (a closed laptop, a lost network) would otherwise leave its row for ever. The pushes already skip such rows, so this only keeps the table small. A live browser reconnects with a new token before its old one runs out, so it never loses a row it needs. The result of a run is `{files, connections}`.
- **Why:** The design says a row is deleted on `$disconnect` and on a `410` from a push, which a silent disappearance never triggers.

## D-M3-10. Tooltip rules for every screen
- **Date:** 2026-10-16
- **Changes:** The mockup and TDD Step 3.4 (no tooltip rules). Applied to the M2 screens as well as the M3 ones.
- **What:**
  1. Every icon-only button (a cross, an eye, an arrow) has a `title` and an `aria-label` with the same text, and the text names what it acts on ("Remove a.pdf", "Retry upload of a.pdf", "Sign out", "Close preview", "Dismiss all"). A checkbox drawn as a button needs the `aria-label`; its title may say why it is off instead.
  2. Text cut short with an ellipsis (file names, destination paths, the short job id, the chips' own path) shows the full text in a `title`.
  3. A disabled control says why in its title: Send ("Waiting for 2 files to be verified", "Add a file first", "1 file has no destination yet. Tick a folder", or the batch limit), Clear ("Nothing to clear"), a folder tick ("Add a file first"), Cancel ("Nothing is waiting to be delivered", "This distribution was already cancelled"), Retry ("The retry window closed: it lasts 24 hours after the distribution finished, and its files must be under 2 days old", "A cancelled distribution cannot be retried", "No failed delivery can be retried…"). The sender therefore now sees Cancel always, and Retry whenever something failed, each off with its reason (the mockup hid them).
  4. Status chips and failure codes carry a one-line plain-English meaning, all from one map, `web/src/explain.ts` (for example RETRIES_EXHAUSTED: "Tried 5 times over about 17 minutes; the platform did not accept it."). It covers the 8 failure codes, 4 delivery states, 5 distribution states and 9 upload states, and a test fails if a code is added without a line.
  5. Text that is already fully visible and self-explanatory (a button labelled "Load more events", the tabs, the filter pills, the counts) gets no tooltip.
  3a. **Amended 2026-10-17 (Cancel):** Cancel distribution is shown only while the distribution is still running (pending or in progress) and only to the sender. While deliveries run but none is waiting it is shown off, with "Nothing is waiting to be delivered". Once the distribution has finished, or was cancelled, there is no Cancel button. Retry keeps its rule: shown to the sender when something failed, off with the reason when the window closed, the distribution was cancelled, or nothing can be retried.
  6. `web/src/components/IconButtons.test.tsx` renders the shell, the Documents table in every file state, Review, the Not added list, the Destinations tree and the preview dialog, and fails for an icon-only button with no aria-label or a different title.
- **Why:** An icon alone does not say what it does or on what; a disabled button that does not say why looks broken.

## D-M3-11. Browser tests with Playwright, local only
- **Date:** 2026-10-16
- **Changes:** TDD "Testing strategy" (no browser layer; M1 to M3 browser checks were steps for the person).
- **What:** `@playwright/test` 1.64.1 is a dev dependency, with Chromium downloaded into `~/.cache/ms-playwright` (approved by the person). The tests are in `tests/e2e/` and run with `npm run test:e2e` against the local Docker Compose stack and the Vite dev server (started by Playwright if it is not already running). They are **not** part of the CI workflows and not part of `npm test`; a CI job can be added later. Chromium needs system libraries that WSL does not have by default; the person installs them with one `sudo` command (the session never runs `sudo`). The tests stop and start the `workers` container and restart `ws-local` to hold a job in a known state; a `finally` always starts them again. Steps that only make sense on AWS stay as steps for the person in `M3-TESTING.md` section 3.
- **Why:** The live behaviour (counts moving without a reload, a reload mid-run, a second person's view, Cancel and Retry, the popover) can only be seen in a real browser, and the tests make those checks repeatable.

## D-M3-12. One look for status, disabled controls, columns, file actions and type badges
- **Date:** 2026-10-17
- **Changes:** The mockup and M2 screens (Distribute), after the person's look at the local screens. Five parts, each a decision:
  1. **Disabled looks disabled.** One shared rule in `web/src/styles.css` for every button: greyed background and text, `cursor: not-allowed`, and a real `disabled` attribute (never a click handler on something that looks live). The title keeps explaining why (D-M3-10). Before, Preview and Download on Status and `btn2` buttons had no disabled style and looked clickable.
  2. **One status chip.** `web/src/components/StatusChip.tsx` (the coloured box with a dot) is used for deliveries, distributions and the file states on Distribute (Preparing, Uploading, Checking, Verified, Refused, Upload interrupted). One tone map: grey is waiting, blue is working, amber is being checked, green is done, red is a problem. `Delivered`, `Verified` and `Completed` are all green; `Failed`, `Refused` and `Completed with errors` are all red.
  3. **Columns size to their content.** The Documents table is one CSS grid (`subgrid` rows): the name column takes the spare room, Destinations, Status, Size and Actions take what their content needs (Destinations and Status are capped, and long text ends with an ellipsis and shows in full in its title). **The draggable column widths of the mockup are removed**, because a fixed width cannot also fit its content. The Deliveries table on Status draws only the rows in view, so it cannot measure all rows: the file column takes the spare room and the destination column is as wide as the longest destination path loaded so far (up to 48 characters).
  4. **Preview and Download are icon buttons on both pages** (an eye and an arrow), with a `title` and `aria-label` of the same text. On Status they stay off until M4, and the text says so: "Preview x.pdf. Available in the next version". One component, `web/src/components/FileActions.tsx`.
  5. **File type badges are coloured by type**, from one map in `web/src/fileTypes.ts`: PDF red, DOCX blue, XLSX green, PNG and JPG purple. The text label stays, and every pair has a contrast of at least 4.5 to 1 (a test computes it).
- **Why:** Controls that look live but do nothing, two different chips for the same idea, and columns wider than their content made the screens harder to read.

## D-M3-13. A fixed note about the sign-in pause
- **Date:** 2026-10-17
- **Changes:** Flow 1 sign-in screen and the 12-hour sign-in dialog (ADR-015 describes the pause but no screen says it).
- **What:** After any failed sign-in, under the error, the page shows one fixed line: "After 5 wrong passwords in a row, sign-in pauses for 15 minutes. Wait, then try again." It is the same for a wrong password, an unknown email, a paused account and the gateway throttle, and it is shown only after a failure. The error text above it is unchanged. So the page still shows neither which accounts exist nor which are paused (D-M1-7 stays as it is). The 12-hour dialog shows the same line after a failed attempt. A failed registration does not show it.
- **Why:** A person who is paused otherwise sees the same "not right" message and tries again, which does not help.

## D-M3-14. A daily check that dev is not left up
- **Date:** 2026-10-17
- **Changes:** AGENTS "Cost" (dev costs money while up; the reminder was only a sentence at the end of a task). New workflow `.github/workflows/dev-up-check.yml`.
- **What:** It runs every day at 17:30 UTC (23:00 IST) and by hand (`workflow_dispatch`). It signs in with the existing deploy credentials and makes one read-only call, `aws ecs list-clusters` in `ap-southeast-2`. If a cluster whose name starts with `docbeam-dev` exists, the job fails with "Dev is still up. Tear it down: scripts/empty-dev-buckets.sh dev, then terraform destroy." Otherwise it passes. No other AWS call. GitHub runs scheduled workflows only from the default branch, so the daily run starts after `m3` is merged; until then it can be run by hand.
- **Why:** A failed run sends an email, so a forgotten dev (about 4.5 USD a day against the Free plan credits) is noticed within a day.

## D-M3-15. No access log on the WebSocket stage
- **Date:** 2026-10-17
- **Changes:** TDD Step 3.2 (`infra/modules/websocket-api`), found by the first dev apply of M3.
- **What:** The WebSocket stage has no `access_log_settings`, and the module's log group, its `log_retention_days` variable and its `log_group` output are removed. Before, `CreateStage` failed with `CloudWatch Logs role ARN must be set in account settings to enable logging`: API Gateway needs an account-wide CloudWatch role for a WebSocket stage that logs (the HTTP API's stage does not). That role is one setting for the whole account and is not removed by `terraform destroy` of dev, so it is not added here. The `ws` Lambda already logs every `$connect`, `subscribe` and `$disconnect` event, and the checks use those logs (`M3-TESTING.md` section 3, check 7).
- **Why:** The check only needs the Lambda's log. An account-level IAM role is a bigger change than the log is worth. It can be added later in one place if the person wants gateway access logs.
