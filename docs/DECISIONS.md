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
