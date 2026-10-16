# DocBeam: agent prompts

One fresh agent session per milestone keeps each context clean. `AGENTS.md` loads by itself in every session, so the prompts below stay short. Paste each prompt as it is.

How to use them:

- Start each session as a new conversation in the Claude Code panel in VS Code (connected to WSL: Ubuntu), in **Plan** mode, so the agent can read and plan but not change files until you approve. After approving, switch to **Edit automatically**.
- Read the plan with the review checklist under each prompt before you approve it. A wrong plan costs days; a careful review costs minutes.
- When the agent reports back, check its YES/NO list yourself against the evidence. Any NO means the milestone is not done.

---

## Session 0: Kickoff (plan only, no code)

```text
We are building DocBeam, a batch document distribution system, exactly as designed in docs/design/. Follow AGENTS.md.

1. Read docs/design/01-design-requirements.md, then 02-blueprint.md, 03-user-flows.md and 04-adrs.md, then 05-technical-design.md, all in full. Look at docs/design/ui/Main.dc.html for the screens.
2. Tell me whether everything is clear enough to implement the full system. List every gap, contradiction or open question you find, each with the file and section, and your suggested answer. Do not guess silently.
3. Write docs/PLAN.md: the plan to build M0 to M5 in order, taken from the milestones and steps in the technical design. For every task give: its step number, inputs (documents and sections, existing files, values needed), outputs (files, routes, tables, queues, AWS resources, tests), how it is checked, and what I must do or provide.
4. Write docs/STATUS.md with "Nothing built yet" and the list of milestones.
5. List anything you need from me before M0 starts (tools, versions, access, settings). The AWS and GitHub setup in AGENTS.md is already done; check it with read-only commands (aws sts get-caller-identity, gh auth status, gh variable list, gh secret list, terraform version, docker version, node --version) and report what you see.

Do not write any code in this session. Commit only docs/PLAN.md and docs/STATUS.md, on main, after I approve.
```

**Review checklist (your part):**
- Every gap it lists has a sensible answer; answer the ones it asks you.
- `docs/PLAN.md` covers every step from 0.1 to 4.1 plus the M5 checklist, in the technical design's order, with nothing added that the design does not ask for.
- Each task names inputs and outputs. If one says only "implement X", ask for the details.
- Region is `ap-southeast-2`, scanning is ClamAV, GitHub uses the deploy user's keys, and nothing mentions GuardDuty or OIDC except as a later option.
- The read-only checks all passed.

---

## Session 1: M0, Foundations (Steps 0.1 to 0.3)

```text
Implement M0: Foundations, Steps 0.1 to 0.3 in docs/design/05-technical-design.md. Follow AGENTS.md. Read docs/STATUS.md and docs/PLAN.md first.

Inputs: the technical design (Overview, Repository layout, Step 0.1 to 0.3, Testing strategy, Launch plan), ADR-009, ADR-011, ADR-012 and ADR-016, AGENTS.md (account, region, GitHub variables and secrets).

Outputs:
- The monorepo exactly as in "Repository layout", with a root README (what it is, run it locally, deploy, folder map), shared TypeScript and ESLint config, .gitignore, .env.example.
- packages/shared (one JWT check for every service, the common error shape) and packages/worker-runtime (runs each Lambda handler locally against LocalStack queues).
- The three services and six workers as working skeletons: each service answers /health; each worker's handler runs and logs.
- docker-compose.yml with everything Step 0.1 lists (Postgres with three databases and roles, LocalStack with the bucket and queues, clamav, workers, ws-local).
- bootstrap/create-state-backend.sh; Terraform modules and envs/dev and envs/prod for Step 0.2, sized for dev as the technical design says; scripts to push images and deploy the web app.
- GitHub Actions for Step 0.3: one workflow per service filtered by path, the worker workflow, the daily Upload Events image rebuild, the infra workflow (plan on pull request; apply dev on merge only while INFRA_APPLY_ENABLED is true; prod only on a manual run from main with the typed input deploy-prod), and gitleaks. Deploy jobs skip unless ECS_DEPLOY_ENABLED or LAMBDA_DEPLOY_ENABLED is true.
- docs/testing/M0-TESTING.md and docs/testing/M0-RESULTS.md, docs/STATUS.md updated.

Done when: the M0 demo in the technical design works: infra live in dev, pipelines green, local stack runs. Locally: npm install, lint, typecheck, test and build pass and docker compose up brings every container to healthy. On AWS (ask before each apply): the state bucket exists, terraform apply for dev succeeds, and every resource in Step 0.2 is visible in the Sydney console.

Start with the plan and wait for my approval. Work on branch m0. Finish with the YES/NO check from AGENTS.md and a pull request.
```

**Review checklist:**
- Folder names match the repo layout in the technical design exactly.
- Dev sizing: one NAT gateway, single-AZ `db.t4g.micro`, one task per service. Prod: Multi-AZ, a NAT per zone, two tasks.
- The state bucket name is `docbeam-tfstate-<account id>` with `use_lockfile`, no DynamoDB.
- No secret values anywhere; `.env` is git-ignored.
- After it reports: run `docker compose up` yourself and open the web app; check the Actions tab is green; look at the Sydney console; then tear dev down.

---

## Session 2: M1, Browse destinations (Steps 1.1 to 1.6)

```text
Implement M1: Browse destinations, Steps 1.1 to 1.6 in docs/design/05-technical-design.md. Follow AGENTS.md. Read docs/STATUS.md and docs/PLAN.md first.

Inputs: the technical design (Database design for Auth DB and Platform DB, API contracts for the Auth Service and Document Platform, Steps 1.1 to 1.6, Security and access), ADR-001, ADR-006, ADR-009, ADR-010, ADR-013 and ADR-015, the Browse Destinations flow in docs/design/03-user-flows.md, the login, register and destination screens in docs/design/ui/Main.dc.html.

Outputs:
- Auth Service complete for v1: register, login, RS256 user tokens, JWKS and OpenID configuration, refresh tokens with rotation and reuse detection, logout, the 5-wrong-password pause, service tokens, internal user lookup, the four service clients seeded by migration.
- Document Platform: schema, the four browse routes with membership checked in each query, the destination check and user teams routes, POST /documents ingest, the seed script and seed file (including the 50-team dev seed).
- DocBeam API skeleton with its database and migrations.
- Public edge in Terraform: HTTP API with the JWT authorizer, VPC Link, each public route listed one by one, CORS with credentials, tight throttling on /auth/login and /auth/refresh, and the CloudFront /api/* behaviour with the prefix-stripping function (D-G5).
- Web app part 1: register, login, quiet refresh with Web Locks, the 12-hour sign-in dialog, the lazy destination tree, select up to 20 destinations.
- Migrations run as one-off ECS tasks; the seed runs after migrations as a deploy step.
- Unit and integration tests the testing strategy lists for these parts. docs/testing/M1-TESTING.md and M1-RESULTS.md, docs/STATUS.md updated.

Done when: the M1 demo works locally and on dev: a user registers, logs in and browses only their own teams, binders and folders. A request without a token gets 401 at the gateway; another team's binder gets 404. Tell me when to set ECS_DEPLOY_ENABLED to true.

Start with the plan and wait for my approval. Work on branch m1. Finish with the YES/NO check from AGENTS.md and a pull request.
```

**Review checklist:**
- Refresh token in an HttpOnly, Secure, SameSite=Strict cookie for `/api/auth`, and every browser API call goes through CloudFront `/api/*` (D-G5); access token in sessionStorage; 15-minute access token, 12-hour sign-in.
- Same 401 message for a wrong password and a paused sign-in.
- Membership checked inside each platform query, 404 (never 403) for anything outside your teams.
- Client secrets stored as SHA-256 hashes; passwords as bcrypt cost 12.
- After it reports: register two users in different teams on dev and check each sees only their own tree.

---

## Session 3: M2, Upload and distribute (Steps 2.1 to 2.6)

```text
Implement M2: Upload and distribute, Steps 2.1 to 2.6 in docs/design/05-technical-design.md. Follow AGENTS.md. Read docs/STATUS.md and docs/PLAN.md first.

Inputs: the technical design (DocBeam DB design, DocBeam API contracts, Steps 2.1 to 2.6, Concurrency, Failure modes, Security and access), ADR-002, ADR-003, ADR-004, ADR-005, ADR-008, ADR-011, ADR-014 and ADR-016, the Document Distribution flow, the upload, mapping, review and send screens in docs/design/ui/Main.dc.html.

Outputs:
- Upload routes (single-part POST policy and multipart start, re-sign, complete), file rows, GET /files?ids=.
- Upload Events Lambda as a container image with ClamAV (sizes, timeout, queue visibility and concurrency as Step 2.1 says), the clean tag, the conditional update, the file.refused event; the daily image rebuild wired to it.
- POST /jobs with every check, the single transaction, the Job Queue message after commit.
- Job Queue, Task Queue and their DLQs in Terraform with the exact limits; Fan-out, Delivery (claim, checksum, service token, permanent and temporary errors, retry gaps, job row lock, pushes), DLQ Consumer and Sweeper (every minute plus the daily cleanup) Lambdas; Delivery capped at 50 and Upload Events at 10 by trigger maximum concurrency.
- Web app part 2: file picker with the allow-list, SHA-256 in a Web Worker, parallel uploads with resume, Checking / Verified / Refused states, mapping as in the mockup (D-G15) with the live task count, the Review section with Preview and remove, Send.
- Platform draining for streamed ingest: the platform target group's deregistration delay and the platform container's `stopTimeout` set to 120 seconds in dev and prod (a module variable, default 30 for the other services), so a 100-second ingest stream survives a deploy.
- The four alarms and their SNS topic sending to `ALARM_EMAIL` (D-G12).
- Lambda deploy jobs that skip, with a notice, when dev does not exist or the function already runs that code, like the ECS deploys (D-M1-14, D-M1-15).
- In the plan, propose whether to keep `image_tag` required and pass a placeholder only in the CI plan, so a later `terraform apply` never registers task definitions with the image `bootstrap` (D-M1-14).
- Unit and integration tests the testing strategy lists for these parts, including the EICAR file refused by the real ClamAV scanner, the same task message twice, a temporary error putting a task back to pending, two last tasks finishing together, and the sweeper re-sending a job. docs/testing/M2-TESTING.md and M2-RESULTS.md, docs/STATUS.md updated.

Done when: the M2 demo works locally and on dev: pick files, upload, map, submit, and see the documents in the platform, including stopping the platform mid-run and watching the backlog drain when it returns. Tell me when to set LAMBDA_DEPLOY_ENABLED to true, and remind me to merge while dev is still up so the deploy jobs run once against it.

Start with the plan and wait for my approval. Work on branch m2. Finish with the YES/NO check from AGENTS.md and a pull request.
```

**Review checklist:**
- Files are uploaded and scanned before submit; submit refuses a file that is not verified (422 FILE_NOT_READY).
- The Job Queue message is sent after the commit, and the Sweeper re-sends a lost one.
- Message bodies hold IDs only, never tokens.
- Delivery classifies errors exactly as Step 2.4 lists.
- The platform drains for 120 seconds on a deploy, in dev too.
- You confirmed the SNS subscription email for `ALARM_EMAIL`.
- After it reports: send a small real batch on dev, open the EICAR test file and check it is refused, then tear dev down.

---

## Session 4: M3, Track a job (Steps 3.1 to 3.4)

```text
Implement M3: Track a job, Steps 3.1 to 3.4 in docs/design/05-technical-design.md. Follow AGENTS.md. Read docs/STATUS.md, docs/PLAN.md and docs/DECISIONS.md first.

Inputs: the technical design (DocBeam API and WebSocket API contracts, the DocBeam DB tables for audit events and WebSocket connections, Steps 3.1 to 3.4, Concurrency, Security and access), ADR-007, the Track a Job flow, the job list, job detail, audit tab and audit trail screens in docs/design/ui/Main.dc.html.

Outputs:
- GET /jobs, GET /jobs/:jobId, GET /jobs/:jobId/tasks with paging and counts; team visibility with the 60-second team cache; POST /jobs/:jobId/retry and POST /jobs/:jobId/cancel with their pushes.
- WebSocket API in Terraform and the WS Handlers for $connect, subscribe and $disconnect, connecting directly in dev (no RDS Proxy on the Free plan) inside the 79-connection budget in `packages/shared/src/db.test.ts` (D-M0-6, D-M2-9).
- Catch-up: connect, subscribe, then fetch; reconnect after every token refresh; refetch once on every reconnect.
- Web app part 3: job list with Mine / My teams and 30-second count refresh, job detail with the virtualized task table, filters, inline failure reasons, Retry and Cancel for the sender, the Audit tab and the Audit trail page.
- Unit and integration tests the testing strategy lists for these parts, including cancel while deliveries run and team-scoped visibility. docs/testing/M3-TESTING.md and M3-RESULTS.md, docs/STATUS.md updated.
- Teardown script (D-M2-23, option 1): `scripts/empty-dev-buckets.sh`, run before every dev destroy. It refuses `prod` and any bucket not named `docbeam-dev-…-<account id>`, never touches the `…-tfstate-…` bucket, reads the bucket names from the Terraform outputs, deletes all versions and delete markers in batches of 1,000 with the AWS CLI, and has a test in `tests/scripts` with a fake `aws`. Update the README and the Tear down section of every testing document.
- M2 leftover (accepted NO N7): `/favicon.ico` answers 403. Serve the SVG for it (in the web behaviour's CloudFront Function or with a real .ico in `web/public`), and say which in DECISIONS.md.

Done when: the M3 demo works locally and on dev: submit a job, watch counts and rows change live, see failure reasons inline, refresh mid-run without losing anything.

Start with the plan and wait for my approval. Work on branch m3. Finish with the YES/NO check from AGENTS.md and a pull request.
```

**Review checklist:**
- Pushes happen only after the commit; a 410 deletes the connection row.
- A viewer who is not the sender sees only their teams' deliveries and gets 404 for a job with none.
- Cancel: running deliveries finish, waiting ones show CANCELLED, Retry on a cancelled job is refused.
- After it reports: open one job in two browsers (sender and a team member) on dev and watch both update.
- `scripts/empty-dev-buckets.sh prod` and a bucket name outside the pattern both stop with an error; the teardown at the end of M3 uses the script and `terraform destroy` finishes in one run.

---

## Session 5: M4, Download a file (Step 4.1)

```text
Implement M4: Download a file, Step 4.1 in docs/design/05-technical-design.md. Follow AGENTS.md. Read docs/STATUS.md and docs/PLAN.md first.

Inputs: the technical design (POST /files/:fileId/downloads contract, Step 4.1, Retention, Security and access), ADR-002 and ADR-004, the Retrieve a File flow, the preview and download screens in docs/design/ui/Main.dc.html.

Outputs:
- POST /files/:fileId/downloads with mode download or preview: the sender and team checks, 410 FILE_EXPIRED after 33 days, a 2-minute GET link with the right content disposition, 404 for anyone not allowed.
- Web app: Preview in an in-page viewer (PDF, PNG and JPG directly; DOCX and XLSX as a read-only page in the browser) and Download under the original file name, on each delivered file.
- Tests for allowed, not allowed, missing and expired. docs/testing/M4-TESTING.md and M4-RESULTS.md, docs/STATUS.md updated.

Done when: the M4 demo works locally and on dev: Preview shows the file in the page and Download saves it; anyone who is not the sender and not in a team the file was delivered to gets 404.

Start with the plan and wait for my approval. Work on branch m4. Finish with the YES/NO check from AGENTS.md and a pull request.
```

**Review checklist:**
- No link is created when the answer is 404 or 410.
- Links last 2 minutes and cover one object only.
- After it reports: try a download as an outsider on dev and confirm 404.

---

## Session 6: M5, Hardening and end-to-end checks

```text
Run M5: Hardening and end-to-end checks in docs/design/05-technical-design.md against deployed dev. Follow AGENTS.md. Read docs/STATUS.md and docs/PLAN.md first.

Inputs: the M5 checklist in the technical design, the success metrics in docs/design/02-blueprint.md, the Testing strategy and Failure modes sections, all earlier docs/testing files.

Outputs:
- scripts/m5-submit-load.sh and any other scripts the checks need, so every check can be re-run.
- Each M5 check run on dev, with its result and evidence (CloudWatch numbers measured server-side, test output, screenshots described in words). Fixes for anything that fails, then the check run again.
- docs/testing/M5-TESTING.md and M5-RESULTS.md, including the manual checks I must do in the browser (slow-connection upload, multipart resume, WebSocket reconnect) as step-by-step instructions.
- docs/RUNBOOK-first-bring-up.md: the first bring-up of a new environment (Launch plan, Rollout; D-M1-13), proved by bringing dev up from nothing with it. It is written for dev and prod alike, but prod is not deployed in this project.
- Database TLS that checks the certificate chain: the services load the RDS certificate authority bundle (Launch plan, Build decisions; D-M1-10).
- The showcase: the root README.md rewritten for someone seeing the project for the first time (the problem, the architecture diagram, key decisions with links to the ADRs and DECISIONS.md, how to run it locally, the test and M5 numbers, a placeholder for the demo video link), and docs/DEMO-SCRIPT.md: a 3 to 5 minute screen-recording script on dev (upload, the EICAR file refused, a 2,000-delivery send, live tracking, stopping the platform and the backlog draining, download), with the commands to bring dev up for it and tear it down after.
- A check that the repository is safe to make public: gitleaks over the whole git history, no .env or keys ever committed, no real email addresses outside the seed's example.com users.
- docs/STATUS.md updated with a release summary: what passed, any limits found, and what deploying prod would need (Paid plan, RDS Proxy, the runbook).

This project is shown on dev only and stays on the Free plan, so M5 runs on dev without RDS Proxy (enable_rds_proxy = false) and prod is never deployed. Record this first as D-M5-1 in docs/DECISIONS.md (it changes D-M0-6, which planned M5 with the proxy). The failover drill switches dev to Multi-AZ for the drill only; if the Free plan blocks that, stop and ask me.

Done when: every item on the M5 checklist is YES with evidence. Do not deploy to prod.

Start with the plan (the order of checks, what each costs in time and AWS credits, which ones change AWS resources) and wait for my approval. Work on branch m5. Finish with the YES/NO check from AGENTS.md and a pull request.
```

**Review checklist:**
- The 2,000-task submit is measured server-side (API Gateway or CloudWatch), not from your laptop.
- The database failover and platform outage drills were actually run, not described.
- You ran the manual checks yourself.
- The README and demo script read well to someone who has never seen the project.
- gitleaks over the whole history is clean before the repository is made public.
- Then: record the demo video on dev, add its link to the README, tear dev down.

---

## If a session goes wrong

When a session gets long or confused, start a new conversation with:

```text
Continue milestone M{n} for DocBeam. Follow AGENTS.md. Read docs/STATUS.md, docs/PLAN.md, docs/testing/M{n}-TESTING.md and the git log of branch m{n}. Tell me what is done, what is left and what is failing, as a list, then wait for my go-ahead before changing anything.
```

Ask the agent to update `docs/STATUS.md` before you end any session that stops mid-milestone.
