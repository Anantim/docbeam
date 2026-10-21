# DocBeam technical design

## Technical Design for PAS-001: DocBeam

| **Field** | **Value** |
|---|---|
| **Status** | **Draft** |
| **Owner** | Anantim |
| **Blueprint** | [DocBeam Blueprint](02-blueprint.md) |
| **ADRs** | [DocBeam ADRs](04-adrs.md) (ADR-001 to ADR-016) |
| **Diagrams** | [Eraser workspace: architecture and four sequence diagrams](https://app.eraser.io/workspace/Wj6gXZ0DTYhnxzoPnwYY) |

This document turns the Blueprint and the ADRs into a build plan: schemas, API contracts, milestones with estimates, and how the system behaves under concurrency and failure. Every flow below matches its sequence diagram in Eraser step for step.

### Overview

#### Rules for implementation

- **Infrastructure as code.** Every AWS resource is created by Terraform (ADR-012). The console is for reading, never writing.
- **CI/CD.** Each service and worker gets a GitHub Actions workflow on the day it is created.
- **Local first.** The whole system runs locally with Docker Compose, with LocalStack for S3 and SQS.
- **Secrets.** Nothing sensitive in code. Secrets Manager at runtime, environment variables locally.
- **Decisions.** A choice with real competing options gets an ADR before it is built. A choice with one obvious answer gets a one-line note here.

#### Build philosophy

Milestones follow the Blueprint's four user flows, and M1 to M4 each end with something a person can test in the browser. When a flow touches a service, that service is built to its full v1 scope in that milestone, because reopening a service later for one endpoint costs more. For the Auth Service and Document Platform, full v1 scope means the basic scope below.

#### Supporting services scope

| **Service** | **In v1** | **Not in v1** |
|---|---|---|
| **Auth Service** | Register, log in, user and refresh tokens, sign-out, a pause after repeated wrong passwords, service tokens, public signing keys (JWKS and OpenID configuration), internal user lookup for the seed script | Password reset, email verification, MFA, roles, admin screens |
| **Document Platform** | Browse teams, binders and folders (paged), search folders by name; destination check and team list routes; file ingest into the Platform File Store | Creating or editing teams, binders, folders or memberships; versioning; viewing documents |

> **Where the hierarchy comes from.** Nothing in v1 can create teams, binders, folders or memberships, so a seed script loads them in every environment (Step 1.2). Adding someone to a team means editing the seed file and re-running the script.

#### How estimates are sized

Estimates assume AI-assisted implementation, with the lead engineer reviewing every change. The time saved depends on the kind of work:

| **Work type** | **Examples** | **Time saved** |
|---|---|---|
| **Boilerplate** | CRUD endpoints, Terraform modules, Compose files, CI YAML, UI scaffolding | **50 to 60%** |
| **Concurrency-sensitive logic** | Submission transaction, task claim and retry, repeat-safe ingest | **30 to 40%** |
| **Infra wiring and first cloud debugging** | VPC Link, IAM policies, ALB health checks, API Gateway | **Minimal** |

The last two stay slow because the hard part is reasoning about interleavings and waiting on AWS, not typing.

### Milestones

Release 1 is 39.5 working days across six milestones. Fill in the Actual column as each milestone closes.

| **Milestone** | **Flow** | **Estimate** | **Actual** | **Demo at the end** |
|---|---|---|---|---|
| **M0** | Foundations | 4.5 d |  | Infra live in dev, pipelines green, local stack runs |
| **M1** | Flow 1: Browse destinations | 11 d |  | Register, log in, browse the team, binder and folder tree |
| **M2** | Flow 2: Upload and distribute | 13 d |  | Pick files, upload, map, submit, see documents land in the platform |
| **M3** | Flow 3: Track a job | 7 d |  | Watch a job's tasks change live on the dashboard |
| **M4** | Flow 4: Download a file | 2 d |  | Preview and download work; outsiders get 404 |
| **M5** | Hardening and end-to-end checks | 2 d |  | Blueprint success metrics proven on the deployed system |
| **Total** |  | **39.5 d** |  |  |

Within each milestone, deploy order follows ADR-001: services and the internal ALB are checked from inside the network before API Gateway sends traffic to them.

### Pipeline at a glance

Submission does the same small amount of work whatever the batch size. Everything after it runs in the background, one task at a time.

1. The browser computes a SHA-256 for each file and asks DocBeam API for upload links, 20 files at a time. DocBeam API records each file in DocBeam DB.
2. The browser uploads each file straight to the Object Store. S3 checks size, type and SHA-256 on write (for a large file, the SHA-256 of each part). Each stored file is then confirmed by the Upload Events Lambda and scanned for malware with ClamAV; only confirmed, clean files can be submitted.
3. The browser submits the job: file IDs, fingerprints and destinations.
4. DocBeam API checks the files and the batch limits, checks every destination with the Document Platform in one call, then writes the job and every task row in one transaction. All tasks show as pending.
5. DocBeam API sends one message to the Job Queue and replies in under 500 ms (under 1 s at peak delivery load).
6. The Fan-out Lambda reads the job's pending task IDs and sends one message per task to the Task Queue.
7. Each task message triggers the Delivery Lambda, which claims the task and checks the file in the Object Store.
8. Delivery sends the file to the Document Platform with a service token. The platform checks membership, the destination, the file type and the fingerprint again, stores the file in the Platform File Store and records it once per task.
9. Delivery records the result in DocBeam DB and pushes it through the WebSocket API to the sender and to viewers in that delivery's team. When a delivery starts a second try or a later one, it also pushes that (status in progress, the attempt count), so the page can show "Retrying" (D-F1-65).
10. A job message that fails 3 times, or a delivery message that fails 5 times, moves to its DLQ, and the DLQ Consumer marks the affected tasks failed with a reason. The sender can then retry the failed deliveries.

### Repository layout

One monorepo holds the three services, the Lambda workers, the web app and all Terraform.

```
docbeam/
  services/
    auth/            # ECS service, owns Auth DB, own migrations/
    platform/        # ECS service, owns Platform DB, own migrations/ and seed/
    docbeam-api/   # ECS service, owns DocBeam DB, own migrations/
  workers/
    fanout/          # Lambda, Job Queue consumer
    delivery/        # Lambda, Task Queue consumer
    upload-events/   # Lambda, Upload Events Queue consumer (ADR-016)
    dlq/             # DLQ Consumer Lambda, reads all three DLQs
    ws/              # WS Handler Lambdas, $connect / subscribe / $disconnect
    sweeper/         # Lambda, scheduled (ADR-014)
  web/               # React + Vite app, served by S3 + CloudFront
  packages/shared/   # JWT validation middleware, error shapes, shared types
  packages/worker-runtime/  # runs the Lambda handlers against LocalStack queues locally
  infra/
    modules/         # network, rds, ecr, ecs-cluster, secrets, ecs-service, alb, sqs, s3, cloudfront, api-gateway, websocket-api, lambda, scheduler, alarms
    envs/dev/        # calls modules with dev variables
    envs/prod/       # calls modules with prod variables
  bootstrap/         # one-time Terraform state store (ADR-012)
  docker-compose.yml
  docker/            # local Postgres and LocalStack init scripts, service Dockerfile
  scripts/           # deploy and run-task scripts, bucket emptying, local env, M5 checks (m5-*), demo recorder, public-readiness check
  README.md          # start here: what it is, run it locally, deploy, folder map
  .github/workflows/
```

Two rules:

1. `infra/envs/*` never holds resource blocks of its own. It only calls `infra/modules/*` with different variables.
2. Each service keeps its migrations in its own folder, because each service owns its database (ADR-009). There is no shared migrations folder.

### Database design

One PostgreSQL instance holds three databases: Auth DB, DocBeam DB and Platform DB (`auth_db`, `docbeam_db`, `platform_db`). Each is reachable only with its owning service's credentials (ADR-009, ADR-010). Each database has two roles: a NOLOGIN owner role that owns the tables and runs migrations, and a login app role used at runtime; the DocBeam app role has only INSERT and SELECT on audit_events, so the audit trail stays append-only. There are no foreign keys across databases; a reference to another service's data is a plain UUID, checked through that service's API.

#### Auth DB

```
users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext UNIQUE NOT NULL,
  password_hash text NOT NULL,
  failed_logins int NOT NULL DEFAULT 0,  -- wrong passwords in a row
  locked_until  timestamptz,            -- sign-in paused until then
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

service_clients (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          text UNIQUE NOT NULL,  -- delivery-worker, docbeam-api, ...
  client_secret_hash text NOT NULL,
  scopes             text[] NOT NULL,       -- see the scopes table below
  created_at         timestamptz NOT NULL DEFAULT now()
);

refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  family_id   uuid NOT NULL,          -- one per sign-in; every token of it shares this
  token_hash  text UNIQUE NOT NULL,   -- SHA-256 of the token; the token itself is never stored
  expires_at  timestamptz NOT NULL,   -- 12 hours after sign-in
  used_at     timestamptz,            -- set when swapped for a new one
  revoked_at  timestamptz,            -- set at sign-out, or when a used token comes back
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_family ON refresh_tokens(family_id);
```

users proves who someone is and nothing more. What they may do comes from team membership in Platform DB. failed_logins and locked_until pause sign-in for 15 minutes after 5 wrong passwords in a row. refresh_tokens backs the 12-hour sign-in (ADR-015). service_clients lets internal callers get service tokens (ADR-013):

| **`Client`** | **`Scopes`** | **Used for** |
|---|---|---|
| `delivery-worker` | `documents:ingest` | Delivering files to the platform |
| `docbeam-api` | `memberships:read` | Destination checks at submission; the caller's teams for viewing jobs, the team job list and downloads |
| `ws-handlers` | `memberships:read` | The caller's teams when a browser subscribes to a job |
| `seed-script` | `users:read` | Turning seed-file emails into user IDs |

#### Platform DB

```
teams (
  id         uuid PRIMARY KEY,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

team_members (
  team_id  uuid REFERENCES teams(id),
  user_id  uuid NOT NULL,         -- Auth DB user id, no cross-db FK
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX idx_team_members_user ON team_members(user_id);

binders (
  id         uuid PRIMARY KEY,
  team_id    uuid NOT NULL REFERENCES teams(id),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_binders_team ON binders(team_id);

folders (
  id               uuid PRIMARY KEY,
  binder_id        uuid NOT NULL REFERENCES binders(id),
  parent_folder_id uuid REFERENCES folders(id),  -- NULL = top level of the binder
  name             text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_folders_parent ON folders(binder_id, parent_folder_id);

documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  binder_id           uuid NOT NULL REFERENCES binders(id),
  folder_id           uuid REFERENCES folders(id),
  name                text NOT NULL,
  size_bytes          bigint NOT NULL,
  content_type        text NOT NULL,
  checksum_sha256     text NOT NULL,
  storage_key         text NOT NULL,   -- documents/{id} in the Platform File Store
  source_task_id      uuid UNIQUE,     -- makes ingest safe to repeat
  uploaded_by_user_id uuid NOT NULL,   -- the onBehalfOf user
  created_at          timestamptz NOT NULL DEFAULT now()
);
```

- **Folder tree.** A parent-ID list read one level at a time through indexed lookups (ADR-010). No recursive query on the browse path.
- **Repeat-safe ingest.** `source_task_id UNIQUE` means the same task delivered twice stores one document; the second call gets the existing one back.
- **Platform File Store.** `storage_key` points into the platform's own bucket. The platform keeps its own copy because the Object Store deletes staged files 33 days after upload (see Retention).

#### DocBeam DB

```
files (
  id                  uuid PRIMARY KEY,
  owner_user_id       uuid NOT NULL,
  job_id              uuid REFERENCES jobs(id),  -- NULL until a job claims the file
  original_name       text NOT NULL,
  size_bytes          bigint NOT NULL,
  content_type        text NOT NULL,             -- declared: what the browser worked out from the file name
  detected_type       text,                      -- what the file's own bytes show (PDF, DOCX, XLSX, PNG or JPEG); set by the Upload Events Lambda with uploaded_at; the tag, the preview and the download use it (D-F1-44)
  checksum_sha256     text NOT NULL,             -- declared when the upload link is requested
  s3_key              text NOT NULL,             -- staging/{owner_user_id}/{file_id}
  multipart_upload_id text,                      -- files over 100 MB only
  s3_checksum         text,                      -- what S3 confirmed: the SHA-256, or for a multipart file the checksum of its part checksums
  uploaded_at         timestamptz,               -- set by the Upload Events Lambda (ADR-016)
  scan_status         text NOT NULL DEFAULT 'pending'
                      CHECK (scan_status IN ('pending','clean','infected','failed')),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_files_owner ON files(owner_user_id, created_at);
CREATE INDEX idx_files_unsubmitted ON files(created_at) WHERE job_id IS NULL;  -- daily cleanup

jobs (
  id                   uuid PRIMARY KEY,
  submitted_by_user_id uuid NOT NULL,
  task_count           int NOT NULL,
  idempotency_key      text NOT NULL,  -- required header on POST /jobs
  queued_at            timestamptz NOT NULL DEFAULT now(),  -- set at submit and at each retry
  fanned_out_at        timestamptz,  -- set by fan-out; the sweeper watches it (ADR-014)
  completed_at         timestamptz,  -- set when the last task resolves
  first_completed_at   timestamptz,  -- set the first time the job finishes, never cleared
  cancelled_at         timestamptz,  -- set when the sender cancels
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_jobs_user ON jobs(submitted_by_user_id, created_at DESC);
CREATE UNIQUE INDEX uq_jobs_idem ON jobs(submitted_by_user_id, idempotency_key);
CREATE INDEX idx_jobs_unstarted ON jobs(queued_at) WHERE fanned_out_at IS NULL AND completed_at IS NULL;

tasks (
  id                   uuid PRIMARY KEY,
  job_id               uuid NOT NULL REFERENCES jobs(id),
  file_id              uuid NOT NULL REFERENCES files(id),
  team_id              uuid NOT NULL,
  binder_id            uuid NOT NULL,
  folder_id            uuid,         -- NULL = top level of the binder
  status               text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','in_progress','completed','failed')),
  attempt_count        int NOT NULL DEFAULT 0,
  failure_code         text,         -- one of the failure codes below
  failure_reason       text,         -- file name, destination and detail, shown on the dashboard
  last_error           text,         -- the latest temporary error
  platform_document_id uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_tasks_dest ON tasks(file_id, binder_id, folder_id)
  WHERE folder_id IS NOT NULL;
CREATE UNIQUE INDEX uq_tasks_dest_root ON tasks(file_id, binder_id)
  WHERE folder_id IS NULL;
CREATE INDEX idx_tasks_job_status ON tasks(job_id, status);
CREATE INDEX idx_tasks_team ON tasks(team_id, job_id);  -- jobs with deliveries to a team

ws_connections (
  connection_id text PRIMARY KEY,  -- API Gateway connection id
  user_id       uuid NOT NULL,
  job_id        uuid,              -- job currently subscribed to
  team_ids      uuid[] NOT NULL DEFAULT '{}',  -- the viewer's teams, read at subscribe
  expires_at    timestamptz NOT NULL,  -- token expiry; nothing is pushed after it
  connected_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ws_job ON ws_connections(job_id);

audit_events (
  id          bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id    uuid,              -- the user; NULL for system events
  action      text NOT NULL,     -- job.submitted, task.completed, task.failed, job.retried, job.cancelled, download.issued, file.refused
  job_id      uuid REFERENCES jobs(id),
  task_id     uuid,
  team_id     uuid,              -- the delivery's team; NULL for job-wide events
  detail      jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_audit_job ON audit_events(job_id, occurred_at DESC);
CREATE INDEX idx_audit_time ON audit_events(occurred_at DESC);
-- The app role gets INSERT and SELECT only: no UPDATE or DELETE.
```

- **Files exist before jobs.** The browser uploads before it submits, so asking for upload links creates the `files` row with `job_id` NULL. Submission sets `job_id` in the same transaction that creates the job and its tasks. A file belongs to at most one job. The migration creates the tables first and adds the foreign keys afterwards, so `files.job_id` can point at `jobs`.
- **Upload checks.** A file can join a job only when `uploaded_at` is set and `scan_status` is clean. The Upload Events Lambda sets both (ADR-016). An infected file is deleted and marked infected, and one whose events end in the Upload DLQ is marked failed; either way the page shows the reason and the user removes the file.
- **Partial unique indexes.** They stop the same file being mapped twice to the same destination, without a fake "binder root" UUID. On PostgreSQL 15 or later, one `UNIQUE NULLS NOT DISTINCT` constraint does the same.
- **ws_connections.** The WebSocket API only holds raw connections and has no idea who watches which job. The WS Handlers keep this table accurate, and Delivery and the DLQ Consumer read it to find subscribers (ADR-007). Each row also keeps the viewer's teams, read when they subscribe, so an update about a delivery goes only to the sender and to viewers in that delivery's team.
- **audit_events.** An append-only record for compliance: each distribution sent, each delivery's final outcome, each retry, each cancel, each refused file and each download link issued, with who and when. Every event is written in the same transaction as the change it records, and DocBeam's database role may only INSERT and SELECT on this table, so no code path can edit or delete history. Nothing is ever deleted: the trail covers the whole history, kept as long as the job records (no expiry in v1), and the Audit page reads it page by page, not just the current session. Delivery events, and downloads by anyone other than the sender, record their team (for a download, the lowest-id team of theirs the file was delivered to, with every matching team in the event's detail), so other viewers see only the events for their own teams. Job-wide events (job.submitted, job.retried, job.cancelled) have no team and show other viewers only who and when. A file.refused event has no job and is shown only to the file's owner. A download by the sender has no team and is shown only to the sender. Sign-ins are logged by the Auth Service.

Task status. Set by the claim step and the worker outcomes:

| **From** | **To** | **When** |
|---|---|---|
| `pending` | `in_progress` | The Delivery Lambda claims the task |
| `in_progress` | **completed** | The platform returns 201 or 200; `platform_document_id` is set |
| `in_progress` | **failed** | A permanent error, or the DLQ Consumer if the last attempt never finished (the worker crashed) |
| `in_progress` | `pending` | A temporary error (platform 5xx or busy, timeout, network). The task waits for the next attempt |
| `pending` | **failed** | The DLQ Consumer: after 5 failed attempts (RETRIES_EXHAUSTED), or when fan-out failed (FANOUT_FAILED), or the DocBeam API when the sender cancels (CANCELLED) |
| `failed` | `pending` | The sender presses Retry failed deliveries: RETRIES_EXHAUSTED or FANOUT_FAILED only, while the job runs or within 24 hours of its first finish, and while its files are less than 2 days old |

A repeat delivery of the same message runs the claim again; the task stays in progress and `attempt_count` goes up. After a temporary error the task goes back to pending, so in progress always means a worker holds it right now. Completed is always final. Failed is final for the workers; only the sender's Retry can set it back to pending. Every worker write that sets a final status ends in `WHERE status IN ('pending','in_progress')`, so a late worker or the DLQ Consumer can never flip one into the other.

Failure reasons. `failure_code` holds one of these codes, and `failure_reason` adds the file name, the destination and any detail. Each code is also the label shown on the dashboard.

| **Code** | **Cause** | **Set by** |
|---|---|---|
| **FILE_NOT_UPLOADED** | The file is not in the Object Store | Delivery Lambda |
| **CHECKSUM_MISMATCH** | The stored file or the bytes received by the platform do not match the declared SHA-256 | Delivery Lambda |
| **UNSUPPORTED_TYPE** | The platform read the file's first bytes and they do not match its declared type (for example a renamed program) | Delivery Lambda |
| **NOT_AUTHORIZED_AT_DELIVERY** | The platform returned 403 NOT_A_MEMBER: the user left the team after submitting | Delivery Lambda |
| **DESTINATION_NOT_FOUND** | The platform returned 404 DESTINATION_NOT_FOUND: the binder or folder was deleted after submitting | Delivery Lambda |
| **RETRIES_EXHAUSTED** | 5 attempts failed with temporary errors (about 17 minutes; about 1 hour only if the worker crashed every time). The sender can retry | DLQ Consumer |
| **FANOUT_FAILED** | Fan-out failed 3 times, so every task still pending in the job was marked failed. The sender can retry | DLQ Consumer |
| **CANCELLED** | The sender cancelled the distribution while this delivery was waiting, either not yet started or waiting for its next attempt. Not retryable | DocBeam API |

Job status is worked out when read, never stored:

| **Task counts** | **Job status** |
|---|---|
| All pending | `pending` |
| Any pending or in progress, not all pending | `in_progress` |
| All completed | **completed** |
| None open, at least one failed | **completed_with_errors** |
| Cancelled by the sender and none open (this wins over completed_with_errors) | `cancelled` |

The job list counts tasks for a whole page in one query, never one query per job. For anyone other than the sender it counts only the deliveries to their teams:

```
SELECT j.id, j.created_at, count(*) AS task_count,  -- only the tasks the caller may see
       count(*) FILTER (WHERE t.status = 'pending')     AS pending,
       count(*) FILTER (WHERE t.status = 'in_progress') AS in_progress,
       count(*) FILTER (WHERE t.status = 'completed')   AS completed,
       count(*) FILTER (WHERE t.status = 'failed')      AS failed
FROM jobs j JOIN tasks t ON t.job_id = j.id
WHERE j.id = ANY($pageOfJobIds)
  AND (j.submitted_by_user_id = $caller OR t.team_id = ANY($callerTeamIds))
GROUP BY j.id;
```

### API contracts

All bodies are JSON unless noted. A POST that needs no body (cancel, retry, a download link) also accepts an empty one (D-M5-5). A service token without the scope a route needs gets 403 FORBIDDEN. Every route needs a JWT except register, login, refresh, logout and the two public-key routes (ADR-001). Errors always use one shape: `{ "error": { "code": "...", "message": "..." } }`.

#### Auth Service

| **`Method and path`** | **Request** | **Response** |
|---|---|---|
| `POST /auth/register` | `{email, password, name}` | 201 `{id, email, name}`. Switched off at API Gateway by default (`public_registration_enabled`): accounts are set up by the study administrator and the web app has no sign-up page (D-F1-17). Reachable inside the network and on the local stack, where the tests use it |
| `POST /auth/login` | `{email, password}` | 200 `{accessToken, expiresIn: 900}`, a 15-minute user JWT, and a refresh token in a `Secure`, `HttpOnly`, `SameSite=Strict` cookie limited to `/api/auth`, the path the browser uses through CloudFront (12 hours). 401 with the same message for any failure, including a paused account; 5 wrong passwords in a row pause sign-in for 15 minutes |
| `POST /auth/refresh` | `none (refresh cookie)` | 200 `{accessToken, expiresIn: 900}` and a new refresh cookie; the old token stops working. A token used again more than 30 seconds after its swap cancels the whole sign-in; within 30 seconds it is a lost answer and gets a new pair in the same sign-in (ADR-015, D-F1-19). 401 when expired or cancelled. Public |
| `POST /auth/logout` | `none (refresh cookie)` | 204. Cancels this sign-in. Public |
| `POST /auth/token` | `{clientId, clientSecret, scope}` | 200 `{accessToken, expiresIn: 900}`, a service JWT. Internal only |
| `GET /.well-known/jwks.json` | none | 200 with the public signing keys |
| `GET /.well-known/openid-configuration` | none | 200 `{issuer, jwks_uri}`. The gateway's JWT authorizer reads it to find the keys. Public |
| `GET /internal/users?email=` | none | 200 `{id}` or 404. Scope users:read. Internal only, for the seed script |

Every token carries `iss` (the CloudFront address followed by `/api`), `aud` ("docbeam"), `iat`, `exp` and `token_use`. User tokens add `sub` (user ID), `email`, `name` and `token_use: "user"`; service tokens add `sub` (client ID), `scope` and `token_use: "service"`. The gateway checks `iss` and `aud`, and each service also checks `token_use`, so a service token can never call a user route and a user token can never call an internal one. Tokens are RS256-signed with a `kid`, so keys can rotate. The access token lasts 15 minutes; a refresh token keeps the sign-in going for 12 hours (ADR-015). The app swaps it a minute before the access token expires, and asks for the password in a small dialog only when a refresh is refused (the 12 hours are up, or the sign-in was cancelled), keeping everything on the page: requests made meanwhile wait and are sent again after sign-in. An unreachable refresh is a retryable error, not the end of the sign-in. Services keep the signing keys for 10 minutes and keep the old keys if a fetch fails, answering 503 only when they have none, so a slow key fetch never turns a good token into a 401 (D-F1-14).

#### Document Platform

User-token routes, reached by the browser through API Gateway:

| **`Method and path`** | **Response** |
|---|---|
| `GET /teams` | Teams the caller belongs to: `{items: [{id, name}], nextCursor}` (paged: `limit`, default 50, and `cursor`; D-F1-6, D-F1-16) |
| `GET /teams/members` | The people who share a team with the caller, once each, by name: `{items: [{userId, name}]}`, at most 200. The choices of the Sender filter on Status. The names come from the seed file (`team_members.user_name`), so Auth is not asked (D-F1-21) |
| `GET /teams/:teamId/binders` | `{items: [{id, name}], nextCursor}`, or 404 if the caller is not a member |
| `GET /binders/:binderId/contents` | One level: `{folders: [...], documents: [...], nextCursor}`, or 404 |
| `GET /folders/:folderId/contents` | One level inside a folder, same shape, or 404 |

The four browse routes are paged (D-F1-6): `limit` (default 20, 1 to 100; teams default 50) and an opaque `cursor`, the position of the last row (base64url of rank, name and id), so rows added or removed while paging never repeat or skip. Order is name, then id; contents list folders before documents. `nextCursor` is null on the last page. The access check runs on every page; a bad `limit` or `cursor` is 400 VALIDATION_ERROR.
| `GET /folders/search?q=&limit=&cursor=` | The folder search of the Destinations tree (D-F1-67): folders whose name contains `q` (case-insensitive, 2 to 100 characters, else 400), in the caller's teams only (membership is in the query, so another team's folder is never a row). `{items: [{id, name, path, names, teamId, binderId, folderIds}], nextCursor}`: `path` is "Team / Binder / folders above / the folder", and `names` is the same as an array (the page never splits `path`, since a name may hold " / "); `folderIds` runs from the top of the binder down to the folder (the match last), so the page can open the tree to it. Ordered by name then id, paged like the other lists (default 20, at most 100). A trigram index (`idx_folders_name_trgm`, `pg_trgm`) serves the contains-match. |

Service-token routes, internal only:

| **`Method and path`** | **Request** | **Response** |
|---|---|---|
| `POST /destinations/check` | {userId, destinations: [{binderId, folderId}]} | 200 {destinations: [{binderId, folderId, teamId, teamName, path}]} when every binder exists, every folder is inside its binder and the user is in each binder's team. Otherwise 422 {notFound: [...]}, the same for a missing binder, one in another team and a destination with no folder (files go only to folders, D-F1-3). Scope memberships:read |
| `GET /users/:userId/teams` | none | 200 {teamIds: [...]}: the teams the user belongs to. Used for every visibility check and the team job list. Scope memberships:read |
| `POST /documents` | Multipart: `{taskId, binderId, folderId?, name, contentType, checksumSha256, onBehalfOf}` plus the file | 201 `{documentId}` new; 200 already stored for this task; 403 NOT_A_MEMBER, the user is no longer in the binder's team; 404 DESTINATION_NOT_FOUND, the binder or folder no longer exists, or no folder was given (D-F1-3); 422 CHECKSUM_MISMATCH or UNSUPPORTED_TYPE. The team always comes from the binder, never from the caller. Scope documents:ingest |

> **Integrity chain.** The browser declares the SHA-256. S3 checks it on upload (for a large file, each part's SHA-256, then the combined checksum when the upload is completed). The Delivery Lambda compares the stored checksum before sending, and the platform recomputes the full SHA-256 while it streams the file in.

#### DocBeam API

| **`Method and path`** | **Request** | **Response** |
|---|---|---|
| `POST /uploads` | `{files: [{name, sizeBytes, contentType, sha256}]}`, at most 20. The browser has already read each file's first bytes (and a ZIP's file list) and sends only a file whose contents are the type its name says (D-F1-44) | 201 `{uploads: [{fileId, post: {url, fields}}]}`, or `{fileId, multipart: true, partSize, partCount}` for files over 100 MB. Same order as the request |
| `POST /files/:fileId/multipart-uploads` | `{parts: [{partNumber, sha256}]}` | 201 `{uploadId, parts: [{partNumber, url}], abortUrl}`. Starts the upload. Each part link is signed with that part's SHA-256, so S3 refuses a damaged part. Owner only |
| `POST /files/:fileId/multipart-uploads/:uploadId/parts` | `{parts: [{partNumber, sha256}]}` | 201 `{parts: [{partNumber, url}]}`. Re-signs the listed parts that have not started, for an upload that outlasts 15 minutes. Owner only |
| `POST /files/:fileId/multipart-uploads/:uploadId/complete` | `{parts: [{partNumber, etag}]}` | 200 `{fileId}`. The API checks that every part is there and the total size matches the declared size, completes the upload in S3 and stores the combined checksum S3 returns in `s3_checksum`. 422 MULTIPART_INCOMPLETE if a part is missing or the size differs. Owner only |
| `GET /files?ids=` | `none` | `[{fileId, uploaded, scanStatus}]` for up to 100 of the caller's files. The browser asks every 2 seconds while any file is being checked. Owner only |
| `POST /jobs` | `{files: [{fileId, sha256}], mappings: [{fileId, destinations: [{binderId, folderId}]}]}`. Idempotency-Key header required (400 IDEMPOTENCY_KEY_REQUIRED without it) | 201 `{jobId, taskCount}` in under 500 ms at p99 in normal operation and under 1 s at p99 under peak delivery load (D-M5-17). A repeated key returns 200 with the existing job, even while the first request is still running. 422 INVALID_BATCH if the batch breaks a limit, is empty, or names a destination with no folder (D-F1-3, D-F1-62); 422 FILE_TOO_OLD for a file uploaded more than 24 hours ago; 422 FILE_NOT_READY for a file not yet confirmed and scanned clean; 409 FILE_ALREADY_SUBMITTED for a file already in a job; 422 DESTINATION_NOT_FOUND lists any binder or folder that does not exist or is outside the caller's teams. Nothing is created on any error |
| `GET /jobs?scope=&status=&sender=&sentSince=&team=&limit=&cursor=` | none | `{items: [{jobId, submittedBy, createdAt, taskCount, fileCount, destinationCount, fileNames, destinations, counts, status}], nextCursor}`, ordered by `created_at` descending, then `id` descending (D-F1-40); `fileNames` are the file names the caller may see in the order they were added and `destinations` the folders as full paths, for the list's "first file +N" and "first two folders +N" (a distribution has at most 100 files and 20 folders). scope=mine (default), team or all (mine plus team; the web app always asks for all). team lists distributions by others that have at least one delivery to one of the caller's teams, with taskCount, counts and status for those deliveries only. Filters only narrow what the scope allows and combine with each other and the cursor: `status` is one of pending, in_progress, completed, completed_with_errors, cancelled (worked out from the deliveries the caller may see); `sender` is `me` or a user id; `sentSince` is an ISO date, or a date-time with a zone (`Z` or an offset), created at or after; `team` is a team id, and the caller must belong to it. `limit` is 20 by default, at most 100. `nextCursor` is an opaque position carrying both `created_at` (to the microsecond, exactly `YYYY-MM-DDTHH:MM:SS.ffffffZ`) and `id`, and is null on the last page; the next page starts after it, as `created_at < c OR (created_at = c AND id < i)`, so a distribution that arrives meanwhile cannot shift or repeat a row, and distributions sent at the same instant keep one fixed order and are neither repeated nor skipped. The index is `idx_jobs_created` on `(created_at DESC, id DESC)`. `idPrefix` is the first 8 characters of an id (hex): the answer holds at most 5 distributions, newest first, found by a range on the primary key (`id` from `prefix-0000-0000-0000-000000000000` to `prefix-ffff-ffff-ffff-ffffffffffff`) among those the scope allows, so one the caller cannot see is simply not there (D-F1-32). A bad `status`, `sender`, `sentSince`, `cursor`, `idPrefix`, or a `team` that is not the caller's is 400 VALIDATION_ERROR (D-F1-21). There is no `page`, no offset and no total |
| `GET /jobs/running` | none | 200 `{running}`: how many distributions the caller can see have a pending or in-progress delivery the caller can see, ignoring every filter. Feeds the number on the Status tab, so it equals the rows under the Pending and In progress filters together (D-F1-34) |
| `GET /jobs/:jobId` | none | Job with counts. 404 unless the caller is the sender or the job has a delivery to one of the caller's teams. For anyone but the sender, counts and status cover only those deliveries |
| `GET /jobs/:jobId/tasks?status=&page=&limit=100` | none | Paged tasks with the file name, the folder path, `fileType` (the detected type, else the declared one, D-F1-44), `attemptCount`, `failureCode` and `failureReason`. The page never shows a code or the platform's text: it maps each code to a plain sentence (D-F1-60). The sender gets every task; anyone else only the tasks for their teams. Same 404 rule |
| `GET /audit?jobId=&action=&page=` | none | Kept and tested, but not called by the web app, which shows job history only (D-F1-13). Audit events, newest first, across every distribution the caller can see. The sender sees every event of their own distributions. Anyone else sees the job-wide events (sent, retried, cancelled) with only who and when, and the events for deliveries and downloads in their own teams. Filter by jobId or action. The whole history, never trimmed |
| `POST /jobs/:jobId/retry` | none | 202 {retried: n}. 404 if the caller cannot see the job; 403 NOT_SENDER if they can see it but did not send it. In one transaction that first locks the job row: sets RETRIES_EXHAUSTED and FANOUT_FAILED tasks back to pending, clears their failure fields and attempt count, clears completed_at and fanned_out_at, sets queued_at and writes an audit event; then sends one job message. After the commit it pushes one job_update to the job's open dashboards, as a cancel does. Allowed while the job runs or within 24 hours of first_completed_at, and while all its files are less than 2 days old; otherwise 409 RETRY_WINDOW_CLOSED. 409 NOTHING_TO_RETRY if no task qualifies; 409 JOB_CANCELLED if the sender cancelled the job |
| `POST /jobs/:jobId/cancel` | none | 202 {cancelled: n}. 404 if the caller cannot see the job; 403 NOT_SENDER if they did not send it. In one transaction that first locks the job row: sets cancelled_at, marks every pending task failed with CANCELLED, sets completed_at (and first_completed_at if empty) if no task is still running, and writes an audit event. Deliveries already running finish. After the commit it pushes one job_update to the job's open dashboards, with counts for what each viewer can see, which reload the tasks. 409 NOTHING_TO_CANCEL if no task is pending |
| `POST /files/:fileId/downloads` | none | 201 `{url, expiresAt, fileName, contentType, sizeBytes}`, a new short-lived credential on every call. The name, type and size come from the file's record, never from the request, so the page can pick a viewer and show the size; the type is the one found in the file's contents (`detected_type`, else the declared one), D-F1-44. Body `{mode}`: download (default) or preview. A download link saves the file under its original name; a preview link opens inline with the stored content type. Both get the same checks, and a preview is recorded in the audit record like a download. 404 if missing or not allowed, the same answer for a bad id, a file in no job, a file not scanned clean and a caller who may not see it; 410 FILE_EXPIRED, checked only after access passes, once the staged file is past its 33-day storage period, instead of a link that would fail; 400 VALIDATION_ERROR for any mode other than download or preview. A refusal creates no link and no audit event |

- **Upload links** (ADR-002, ADR-004). Presigned POST, 15 minutes, one object each. The policy enforces size up to the declared value (hard limit 1 GB), an exact content type from the allow-list (pdf, docx, xlsx, png, jpg) and `x-amz-checksum-sha256`. Signed locally, with no call to AWS.
- **Multipart.** Starting a multipart upload is a call to S3, so the browser calls `POST /files/:fileId/multipart-uploads` only when it begins that file. Parts are 16 MiB. It works out each part's SHA-256 in the same pass as the whole file's. A 1 GB upload can outlast 15 minutes, so the browser re-signs parts it has not started yet with `POST /files/:fileId/multipart-uploads/:uploadId/parts`. When every part is in, the browser calls `POST /files/:fileId/multipart-uploads/:uploadId/complete` with the part ETags (the Object Store's CORS rule exposes the ETag header), and the API completes the upload itself. S3 only reports a combined checksum for a multipart file, so that is what is stored in `s3_checksum` and checked before delivery; the platform still recomputes the full SHA-256.
- **Submission checks.** First the batch itself: at most 100 files, 20 destinations and 2,000 deliveries, every file mapped to at least one destination, the same file IDs in files and mappings, and no destination listed twice for a file. Otherwise 422 INVALID_BATCH. Every `fileId` must belong to the caller, be uploaded less than 24 hours ago (otherwise 422 FILE_TOO_OLD), be confirmed and scanned clean (otherwise 422 FILE_NOT_READY), and not be in another job (otherwise 409 FILE_ALREADY_SUBMITTED), and its `sha256` must match the one declared earlier (otherwise 422 CHECKSUM_MISMATCH). All destinations go to the platform in one POST /destinations/check: each binder must exist, each folder must be inside its binder, and the caller must be in the binder's team. The team never comes from the browser; the platform returns it and it is stored on the task. Any failure returns 422 DESTINATION_NOT_FOUND naming the bad destinations, with the same message whether a binder is missing or belongs to another team, and nothing is created.
- **Read routes.** Counts are `{pending, in_progress, completed, failed, cancelled}` in every list, detail and push. A cancelled delivery is stored as failed with CANCELLED but counted under `cancelled`, so `failed` holds real failures only; `taskCount` is the sum of all five, and the job status still counts cancelled with failed. Job detail also returns `asOf` (the server's clock when the counts were read, so the page can ignore older pushes), `destinations` (the folders the caller may see), `isSender`, and for the sender only `fileCount`, `retry {open, retryable, reason}` and `cancel {open, waiting}`, so the Retry and Cancel rules live on the server. Tasks come as `{page, limit, total, tasks}`, 100 per page, sorted by file name, destination and id; each task adds `fileName`, `fileType` (the stored `detected_type`, else the declared `content_type`; the page's type tag), `destinationPath`, `attemptCount` and `fileExpired`, and `status` takes pending, in_progress, completed, failed or cancelled. `GET /jobs` pages 20 by default, at most 100. `GET /audit` pages 50 by default, at most 200, returns `{page, limit, hasMore, events}`, and `action` takes several actions separated by commas.

#### WebSocket API

| **`Route`** | **What the WS Handler does** |
|---|---|
| `$connect` | Reads the JWT from the query string (browsers cannot set headers on the handshake), checks it against JWKS and inserts a `ws_connections` row with the token's expiry. Bad token or a service token: 401 and no connection. `$connect` has no gateway authorizer; the handler checks the token itself |
| `subscribe` | `{action: "subscribe", jobId}`. Looks up the sender. If the caller is someone else, gets their teams from the platform and allows the subscription only if the job has a delivery to one of them. Allowed: sets `job_id` and `team_ids` on the row and answers `{type: "subscribed", jobId}` on the same connection. Not allowed: answers `{type: "subscribe_error", jobId, code}` with NOT_FOUND (a missing job and a hidden one get the same answer), VALIDATION_ERROR or UNAVAILABLE (the platform could not be asked), and clears any earlier job on the connection |
| `$disconnect` | Deletes the connection row |

Push message: `{type: "task_update", jobId, taskId, status, failureCode?, failureReason?, attemptCount?, updatedAt, counts}`. `status` is `completed` or `failed` for a final result, and `in_progress` with `attemptCount` (2 or more) when a delivery starts a retry: one small push per attempt, never for the first try (D-F1-65). The sender's connections get counts for the whole job; a team viewer's get counts for their teams' deliveries only, worked out from one count per team and status. Pushes can arrive out of order, so the browser ignores one older than what it already shows (by `updatedAt`). After a cancel or a retry, the DocBeam API sends one job_update message to each open dashboard instead, with counts for what that viewer can see, and the page reloads the tasks. The job list does not use pushes: it refreshes its counts every 30 seconds.

The handler finds its management address in the event (`https://<domain>/<stage>`), so the WS Lambda needs no API address in its own configuration (that would be a Terraform cycle). For the same reason its permission to post covers the WebSocket APIs of the account in the region; Delivery, the DLQ Consumer and the DocBeam API get the exact API.

### Milestone steps

Each step names what gets built, the ADRs it follows, and its estimate.

#### M0: Foundations (4.5 d)

**Step 0.1: Monorepo, local stack, shared package (1 d)**

- Repo layout as above, a root README (what it is, how to run it locally, how to deploy, where things live), shared TypeScript config and ESLint.
- `packages/shared`: one JWT validation middleware for every service, plus the common error shape.
- `docker-compose.yml`: the three services, PostgreSQL with an init script that creates three databases and six roles (an owner and an app role each), LocalStack 4.14 for S3 and SQS (the last version that needs no account token), a `clamav` container (the official ClamAV image), a `workers` container that polls the LocalStack queues and runs the Lambda handlers (Fan-out, Delivery, DLQ Consumer, Upload Events, and the Sweeper on a timer), and a `ws-local` container that stands in for the WebSocket API. There is no API Gateway locally, so each service checks the JWT itself, as it already does in AWS. The Upload Events handler scans through the `clamav` container, so the EICAR test file is refused locally too.

**Step 0.2: Terraform foundation (2.5 d)**

- `bootstrap/` script creates the state store: one versioned, encrypted S3 bucket. Terraform locks the state with a lock file in that bucket (`use_lockfile = true` in each backend), so there is no DynamoDB table. The only manual step (ADR-012).
- Modules: network (VPC across 2 availability zones, private subnets, NAT gateways (one per zone in prod, one shared in dev), and an S3 gateway endpoint so file traffic skips the NAT), rds (one PostgreSQL instance, Multi-AZ in prod and single-AZ in dev, with KMS-encrypted storage, RDS Proxy in prod only (the Free plan blocks it), one Secrets Manager secret per login role), ecr, s3, ecs-cluster (the cluster and the database bootstrap task) and secrets (service client secrets, and the signing-key secret, created empty so Terraform never holds the key).
- Region: Asia Pacific (Sydney), `ap-southeast-2`, for dev and prod. The AWS account uses the project-based sign-up, where each project gets one home region from the contact address (Sydney for India). On the Free plan only that region, `us-east-1` and `us-west-2` are allowed, so Mumbai is not available. Every service DocBeam uses is offered in Sydney, including RDS Proxy for PostgreSQL, EventBridge Scheduler, API Gateway HTTP and WebSocket APIs and Lambda container images. Moving to Mumbai later needs the Paid plan with advanced features turned on (which cannot be undone) and a fresh deployment, since data does not move between regions. CloudFront is global; if a custom domain is added later, its certificate must be created in `us-east-1`, as CloudFront requires.
- **AWS account plan.** Dev runs on the AWS Free plan (credits, at most 6 months). Everything DocBeam uses is allowed there except GuardDuty (which needs advanced features even on the Paid plan), IAM identity providers and RDS Proxy, so malware scanning uses ClamAV (ADR-016), GitHub Actions signs in with a deploy user's access keys instead of OIDC (Step 0.3), and dev Lambdas connect to the database directly (ADR-011). Dev is sized to save credits: one NAT gateway, a single-AZ `db.t4g.micro` instance, one task per ECS service, and it is taken down when not in use. Its settings (secrets deleted at once, buckets and image repositories emptied on destroy, no final database snapshot) let it be re-created the next day without name clashes. The account already allows 400 Lambda runs at once in Sydney, so dev uses the same trigger caps as prod (Task Queue 50, Upload Events 10). This build is a portfolio project: it is shown on dev only and prod is never deployed, so the account stays on the Free plan. Prod exists as Terraform (infra/envs/prod), checked by terraform plan. Deploying prod would need the Paid plan first (unused credits carry over). The Free plan ends after 6 months or when the credits run out, and AWS then suspends the account unless it is upgraded.
- Object Store: SSE-KMS with the AWS-managed key and S3 Bucket Keys (ADR-003), Block Public Access, TLS-only policy, a bucket policy that lets only the DocBeam API, Delivery, Sweeper and Upload Events roles in, 33-day expiry counted from upload (see Retention), 7-day cleanup of abandoned multipart uploads, a CORS rule for the web app that allows uploads and preview reads (GET) and exposes the ETag header, and event notifications for new objects to the Upload Events Queue. The bucket policy refuses to hand out any object not tagged `scan-status=clean` to every role except the Upload Events role, which must read a file before it is tagged.
- Platform File Store: same encryption and access settings, no expiry, and versioning on, so an overwrite or delete keeps the earlier version for 90 days and can be undone. Only the Document Platform's task role can use it, and the bucket policy denies s3:DeleteObjectVersion to every role, so no bug or bad retry can remove a stored version directly.
- Web app bucket plus CloudFront.
- Databases and roles are created by a migration bootstrap task, never by hand (ADR-009). Secrets are generated, never typed in: RDS manages the master password, Terraform's random_password makes the database role passwords and service client secrets, and a one-time bootstrap task creates the RS256 signing key in Secrets Manager. Terraform state holds the generated values, so the state bucket is encrypted and only the deploy user (Step 0.3) and the admin user can read it.

**Step 0.3: CI/CD skeleton (1 d)**

- One workflow per service, filtered by path: lint, test, Docker build, push to ECR tagged with the git SHA, then `scripts/deploy-service.sh`: migrate, seed (platform), register a task definition with the new image and update the service. Deploy jobs run only while the repository variable `ECS_DEPLOY_ENABLED` is `true` (`LAMBDA_DEPLOY_ENABLED` for the workers). A deploy is skipped when the environment does not exist (dev torn down), or when the service already runs that image from a revision the script registered (a repeated event or a double merge); a manual run with `force` deploys anyway. A manual run from `main` without the prod confirmation deploys dev. Terraform creates the first task definitions (`image_tag` defaults to `bootstrap`) and then leaves them to this script.
- Worker workflow: esbuild bundle, then update the Lambda code. The Upload Events Lambda is a container image with ClamAV instead; a scheduled run rebuilds it every day so its virus definitions stay current.
- AWS access: a `docbeam-github-deploy` IAM user whose access keys are stored as GitHub repository secrets (set up by hand once, like the state bucket), rotated every 90 days. The AWS Free plan does not allow the OIDC identity provider; after the move to the Paid plan the workflows switch to OIDC and the keys are deleted.
- Infra workflow: `terraform plan` posted on every pull request. The dev `apply` on merge runs only while the repository variable `INFRA_APPLY_ENABLED` is `true`, so a merge never rebuilds a torn-down dev by surprise. Prod plan, apply and deploys run only when started by hand from `main` with the typed confirmation `deploy-prod`; GitHub Free allows no required reviewers on a private repository.
- Rollback: point the ECS service back at the previous task definition and wait for it to settle.

#### M1: Browse destinations (11 d)

Demo: a user registers, logs in and browses the team, binder and folder tree, seeing only their own teams. Matches the Browse Destinations diagram.

**Step 1.1: Auth Service, complete and deployed (5 d)**

- Register (bcrypt cost 12 with the native `bcrypt` package, passwords of 12 to 72 bytes, 400 VALIDATION_ERROR for bad input, one generic 409 REGISTRATION_FAILED for an email already in use), login (constant-time compare, done before the short transaction that updates the wrong-password count, so a slow hash never holds a database connection), RS256 signing with the key from Secrets Manager, JWKS with `kid` (the RFC 7638 thumbprint of the public key), and the OpenID configuration route the gateway reads. A one-off task writes the signing key to its secret once and never replaces a key already there.
- Refresh tokens (ADR-015): `POST /auth/refresh` and `POST /auth/logout`, the `refresh_tokens` table, a new token on every use, and cancelling the whole sign-in when a used token comes back. Pause: 5 wrong passwords in a row stop sign-in for 15 minutes with the same 401 message, and API Gateway throttles `/auth/login` and `/auth/refresh` tightly. The fifth wrong password sets `locked_until` inside a transaction that locks the user row, so parallel guesses cannot get past it. An unknown email is compared against a dummy hash, so timing does not show whether an account exists. Ending a pause early is a support script in v1.
- Service token endpoint and internal user lookup, built now although first used later. The migrate task runs the migrations, then upserts the four service clients with secrets injected from Secrets Manager (a migration file is in git and cannot hold them). Client secrets are long random values, so they are stored as SHA-256 hashes (bcrypt is for passwords and would add about 100 ms to every token call); the secrets themselves stay in Secrets Manager.
- ECS Fargate, 2 tasks across availability zones (1 in dev), 0.5 vCPU and 1 GB because hashing is slow by design (the Document Platform stand-in uses 1 vCPU and 2 GB, Step 2.4; the other services use 0.25 vCPU and 0.5 GB), internal ALB target group, health check. Checked from inside the network first (ADR-001).
- Local secrets: `scripts/local-env.sh` writes the signing key, the four client secrets and the seed password into a git-ignored `.env`, under the same names the services read from Secrets Manager on AWS.

**Step 1.2: Platform hierarchy, membership routes, seed (1 d)**

- Schema, the four browse routes with membership checked inside each query, and the service-token routes (destination check, a user's teams).
- Seed script in `services/platform/seed/`, run as a deploy step in every environment and safe to re-run. JSON seed files list teams, binders, nested folders and member emails, with fixed ids so a re-run changes nothing: `demo.json` (the mockup's Cardio, Oncology and Neuro teams) and, in dev, `dev-load.json`. Prod loads none until the client's hierarchy exists. The script resolves each email through the Auth Service (in dev it first registers the seed users with one seed password), then makes Platform DB match the file: it adds what is new and removes memberships the file no longer lists. Teams, binders and folders are never deleted by the script. An email with no account in that environment is skipped with a warning in the deploy log, so one typo cannot stop a deploy; any other error stops the run, so a blip cannot remove memberships.
- Dev seed also has 50 teams with nested folders, to test the under-1-second browse target at its limit.

**Step 1.3: Platform ingest (1.5 d)**

- `POST /documents`, built now to finish the platform's scope and covered by integration tests until M2 uses it.
- The text fields must come before the file part. The platform checks `onBehalfOf` membership and the destination first, then looks up `source_task_id`: if this task already has a document, returns it (200) without reading the file. Otherwise it checks the file's first bytes against the declared type (422 UNSUPPORTED_TYPE; PDF, PNG and JPEG by their signatures, DOCX and XLSX as ZIP files, since their first bytes are the same), streams the file to the Platform File Store at `documents/{documentId}` while computing SHA-256, and deletes the object on a mismatch. The insert uses `ON CONFLICT (source_task_id) DO NOTHING`; if a parallel repeat won, it deletes its own object and returns the winner's document. Content-type allow-list.

**Step 1.4: Public edge (1.5 d)**

- API Gateway HTTP API with the built-in JWT authorizer (issuer and audience checked, keys found through the OpenID configuration), and a VPC Link to the internal ALB (ADR-001), which has one listener and target group per service on the service's own port. The gateway reads the OpenID configuration when it creates the authorizer, so a brand-new environment is applied twice: first with `jwt_authorizer_enabled = false` (the protected routes do not exist yet and answer 404, never open), then with `true` once the bootstrap tasks have run and the Auth Service answers through CloudFront.
- Every public route is listed one by one, with no catch-all, so an internal route can never be reached by mistake: register, login, refresh, logout, the two public-key routes and the platform browse routes now, the DocBeam API routes as M2 to M4 add them. `/auth/token`, `/internal/*` and the platform's service routes stay internal.
- CloudFront serves the web app and forwards `/api/*` to the HTTP API, with a CloudFront Function stripping the `/api` prefix, so the browser talks to one site and the refresh cookie (`Path=/api/auth`) can be `SameSite=Strict` without a custom domain. The `/api/*` behaviour has caching off and forwards the Authorization header, cookies and query strings. The web behaviour serves `index.html` for any path without a dot, so an API 404 is never turned into a page. No CORS origin is needed in prod; dev allows only `http://localhost:5173`, with credentials. Throttling: 50 requests a second (burst 100) by default, 5 a second (burst 10) on `/auth/login` and `/auth/refresh`.
- Check: a request without a token gets 401 at the gateway and never reaches the ALB.

**Step 1.5: DocBeam API skeleton (0.5 d)**

- Service, DocBeam DB, migrations, health check, deployed behind the ALB. Routes come in M2.

**Step 1.6: Web app part 1, login and browse (1.5 d)**

- React + Vite on S3 + CloudFront. Register and login screens. The access token is kept in sessionStorage so reloading the page keeps the session; the refresh token lives only in its cookie. A minute before the access token expires the app calls `/auth/refresh` without the user noticing; a browser lock (Web Locks API) lets only one tab refresh, and it shares the new token with the other tabs. A new tab with no token tries one quiet refresh under the same lock before it shows sign-in. After 12 hours a sign-in dialog keeps the page as it is. A 401 triggers one refresh, then the dialog.
- Lazy tree: teams, then binders, then one folder level per click, matching the platform's one-level API. Binders and folders can both be ticked; documents are not destinations. The filter searches the levels already open. With 5 teams or fewer the teams open at once.
- Select up to 20 destinations.
- *Changed in F1 (see "F1: Reviewer feedback round" below): no register screen; only folders can be ticked; the tree always starts with the teams only, pages its levels and has a server-side folder search.*

#### M2: Upload and distribute (13 d)

Demo: pick up to 100 files, upload them, map them, submit, and see the documents in the platform, including stopping the platform mid-run and watching the backlog drain when it returns. Matches the Document Distribution diagram.

**Step 2.1: Upload links, confirmation and malware scanning (4.5 d)**

- `POST /uploads`, `POST /files/:fileId/multipart-uploads` (start), `POST /files/:fileId/multipart-uploads/:uploadId/parts` (re-sign) and `POST /files/:fileId/multipart-uploads/:uploadId/complete` as in the contracts. File rows are created here; a single-part file gets `s3_checksum` set to its declared SHA-256, since the upload policy makes S3 enforce it.
- Upload confirmation and scanning (ADR-016): S3 event notifications on `staging/` go to the Upload Events Queue (maxReceiveCount 5, with the Upload DLQ). The Upload Events Lambda reads the object's size and checksum and checks them against the file row, then scans the file with ClamAV and works out its SHA-256 in the same pass, compared with the declared `checksum_sha256` (this covers a multipart file, for which S3 reports only a combined checksum). It then finds the file's real type from its bytes with two or three small range reads: the first 8 bytes tell PDF, PNG and JPEG; for a ZIP, the end-of-central-directory record and the central directory give the entry names, and `word/document.xml` means DOCX, `xl/workbook.xml` XLSX (the same code the browser runs when the file is added, `detectFileType` in `packages/shared`). If the type found is not the declared `content_type` (or none is found) the object is deleted, the file is marked failed and `file.refused` is written with reason CONTENT_TYPE. A clean file is tagged `scan-status=clean` and gets `uploaded_at`, `scan_status` and `detected_type` set in one conditional update. A size or checksum difference deletes the object, marks the file failed and writes `file.refused` with reason MISMATCH; an infected file is deleted, marked infected and gets `file.refused` with reason MALWARE and the signature name. The event has no actor and names the owner, so only the owner sees it. A repeated event changes nothing. The handler sets its own retry gap: 30 seconds while a multipart upload is not yet recorded, and 30 seconds, 1, 2 and 5 minutes after an error. `GET /files?ids=` reports the state to the browser. `checksum_sha256` is hex; `s3_checksum` is what S3 reports, base64, with `-<parts>` for a multipart file.
- Scanner: the Upload Events Lambda is a container image (Debian with Node 22, since Amazon Linux has no ClamAV package) built with ClamAV. Scan limits are 1,100 MB, a little above the 1 GiB file limit, and a file over a limit is reported as found (`--alert-exceeds-max`), so no file is skipped and called clean; a scan that cannot finish throws and the event is retried. 3,008 MB memory (the most a new account allows), 10 GB temporary storage, timeout 600 seconds, batch size 1, Upload Events Queue visibility timeout 3,600 seconds (6 times the timeout), trigger maximum concurrency 10. A scheduled GitHub Actions workflow rebuilds the image every day with fresh virus definitions and updates the Lambda; it skips while dev is down, and the image repository keeps the last 3 images. The image is pushed without a provenance attestation, which Lambda refuses.
- Lambda code: Terraform creates each zip Lambda from a small placeholder (the Upload Events Lambda from its pushed image) and ignores later code changes. `scripts/deploy-lambda.sh` deploys the real code, as `deploy-service.sh` does for ECS, and skips when the function does not exist or already runs that code. Deploy jobs run only while `LAMBDA_DEPLOY_ENABLED` is `true`. A Lambda's environment holds only secret ARNs; the code reads the secrets on a cold start and caches them.

**Step 2.2: Job submission (1.5 d)**

- `POST /jobs`: check the batch limits, file ownership, age, fingerprints and upload checks (confirmed and clean), and, at the same time, check every destination with one POST /destinations/check call (D-M5-10). The service token is fetched at startup and renewed in the background, so no request waits for the Auth Service. File age is measured from `files.created_at`, inside the claim update, the same column the daily cleanup deletes on. If the destination check fails or takes longer than 5 seconds, `POST /jobs` returns 503 PLATFORM_UNAVAILABLE and creates nothing; the web app retries with the same Idempotency-Key.
- One transaction: insert the job, set `job_id` on the files (`WHERE job_id IS NULL`, so a file already in a job gives 409), insert every task as pending in one statement, with one parameter per column array rather than one per value (D-M5-10) (`INSERT ... SELECT FROM unnest(...)`) and write the `job.submitted` audit event.
- After commit, send one message to the Job Queue and return (ADR-008). If the send fails, the API still returns 201; the sweeper re-sends it (Step 2.5, ADR-014).

**Step 2.3: Queues and Fan-out Lambda (1.5 d)**

- Terraform: Job Queue and Task Queue, each with a DLQ, maxReceiveCount 3 for the Job Queue and 5 for the Task Queue (ADR-005), 14-day message retention and SSE-SQS encryption on these four and on the Upload Events Queue and its DLQ. Fan-out Lambda timeout 60 seconds, Job Queue visibility timeout 360 seconds. Delivery Lambda 3,008 MB and timeout 120 seconds (at 1,024 MB a 1 GB file timed out on dev, because a Lambda's network speed grows with its memory; at 3,008 MB it was delivered in 37 seconds, D-M5-12); its call to the platform has its own 100-second limit, so a slow platform becomes a normal temporary error. Task Queue visibility timeout 720 seconds, 6 times the Lambda timeout as AWS advises; it only matters if a worker crashes. Batch size 1 with ReportBatchItemFailures.
- Fan-out Lambda: read `{jobId}`, set `fanned_out_at`, load the job's pending task IDs, `SendMessageBatch` in groups of 10. Message body is `{taskId}` only, never tokens.
- Concurrency of the smaller Lambdas, so the dev connection budget stays true (an SQS trigger allows no maximum below 2): Fan-out trigger maximum 2, the DLQ Consumer reserved concurrency 2 across its three triggers, the Sweeper reserved concurrency 1. Fan-out, the DLQ Consumer, the WS Handlers and the Sweeper get 512 MB; the WS Handlers time out after 15 seconds and the Sweeper after 300.

**Step 2.4: Delivery Lambda (2.5 d)**

- Claim: `UPDATE tasks SET status='in_progress', attempt_count=attempt_count+1 WHERE id=$1 AND status IN ('pending','in_progress') RETURNING *`. Already final: acknowledge and stop.
- HEAD the object with checksum mode. Missing: FILE_NOT_UPLOADED. The Delivery role has s3:ListBucket on the Object Store, so a missing object answers 404 instead of 403; without it a deleted file was retried until RETRIES_EXHAUSTED (D-M5-8). A checksum different from `files.s3_checksum`, or no checksum at all: CHECKSUM_MISMATCH. On AWS every staged object has one; only local Compose, where LocalStack stores none for a presigned POST, allows a missing one (`S3_CHECKSUM_OPTIONAL`).
- Use the cached service token (fetched on a cold start and renewed before it expires), then stream the object to `POST /documents`. A 401 means the token was rejected: get a new one and try again at once, once.
- 201 or 200: completed, with the document ID. 403 NOT_A_MEMBER: NOT_AUTHORIZED_AT_DELIVERY. 404 DESTINATION_NOT_FOUND: DESTINATION_NOT_FOUND. 422: CHECKSUM_MISMATCH or UNSUPPORTED_TYPE, as the platform says. These are permanent: the task fails and the message is acknowledged. Anything else (5xx, 429, any other 4xx, a timeout or a network error) is temporary: set the task back to pending with `last_error` (`WHERE id = $1 AND status = 'in_progress'`; if no row changes, another copy already finished it, so acknowledge and stop), call ChangeMessageVisibility with a gap chosen from the message's ApproximateReceiveCount (1: 30 seconds, 2: 2 minutes, 3: 5 minutes, 4: 10 minutes, 5: at once, so SQS moves it to the DLQ), then report it as a failed batch item. A platform blip is retried within seconds, and a task that keeps failing reaches RETRIES_EXHAUSTED after about 17 minutes, long enough to ride out a short platform outage.
- Each final status is one transaction: lock the job row (`SELECT 1 FROM jobs WHERE id = $1 FOR UPDATE`), write the task with the conditional final write, write the audit event, and if no open tasks remain set `completed_at` (and `first_completed_at` if empty). The lock means that when the last two tasks finish together, the second always sees the first and closes the job. Then (after a final status, and at the claim of a second or later attempt, never at a first claim or a return to pending; D-F1-65) find subscribers in ws_connections (skipping rows past expires_at, and team viewers whose `team_ids` do not include the task's team), call PostToConnection for each, and delete rows that return 410 Gone. Push errors are logged and never fail a delivery.
- All database access through RDS Proxy in prod; in dev (no proxy on the Free plan) each Lambda copy opens at most one connection, and the worst case stays under 80% of the instance's 100 connections (ADR-011). The Task Queue trigger has maximum concurrency 50, set in Terraform (ADR-011): SQS hands out no more than 50 messages at a time, so extra messages wait in the queue instead of being throttled and using up their attempts. Dev uses the same cap; the account allows 400 Lambda runs at once in Sydney.
- Document Platform stand-in under load: 1 vCPU and 2 GB, uploads to the Platform File Store one 5 MB part at a time, and at most 6 ingests at once. Other requests wait in the process; one that has waited 30 seconds gets 503 PLATFORM_BUSY with `Retry-After: 30` before any of its bytes are read, which Delivery treats as temporary. On SIGTERM the platform finishes the requests it started and closes idle connections; its target group drains for 120 seconds and its container stop timeout is 120 seconds, so a rolling deploy never cuts a delivery. Checked on dev with 50 large deliveries at once (5 files of 120 MB to 10 folders): peak memory under 80%, no restarts, every task completed. The real platform's ingest capacity is for the client to confirm.

**Step 2.5: DLQ Consumer and Sweeper (1 d)**

- DLQ Consumer, triggered by all three DLQs. Task DLQ: mark the task failed with RETRIES_EXHAUSTED plus its `last_error`. Job DLQ: mark the job's pending tasks failed with FANOUT_FAILED. Upload DLQ: mark the file `failed` and write `file.refused` with reason SCAN_FAILED in the same statement, so the page shows that it could not be checked.
- For the Job and Task DLQs, close the job if nothing is open and push the change to subscribers, the same way delivery does (job row lock included).
- Sweeper Lambda (ADR-014), every minute: re-send the job message for jobs with `fanned_out_at` and `completed_at` still empty 1 minute after `queued_at`. Once a day: `DELETE FROM files WHERE job_id IS NULL AND created_at < now() - interval '24 hours' RETURNING s3_key`, then delete those objects and abort any open multipart uploads. Submission refuses files older than 24 hours, so a file is either claimed by a job or deleted, never both. Both queries use the partial indexes above. The same daily run also deletes `ws_connections` rows past their expiry, left by browsers that vanished without a `$disconnect`.

**Step 2.6: Web app part 2, upload, map, submit (2 d)**

- File picker capped at 100 with the client-side allow-list. SHA-256 computed in a Web Worker so the page stays responsive.
- Upload queue with 4 to 6 parallel uploads, links requested in waves of 20, progress per file, multipart resume within the session.
- Mapping as in the mockup (pick files or Use all files, then tick folders in the destination tree) with a live task count (for example 100 files x 20 destinations = 2,000 deliveries) in the This distribution card and on the Send button; the mockup's summary line in the Send bar is left out. The app checks the same batch limits as the API. Each file shows Checking until it is confirmed and scanned, then Verified or Refused with the reason. Send is enabled once every file is verified. A full-width Review section under the file list and the destinations shows every destination with the names of its files, each with Preview and a cross that removes it from that folder; a file left with no folder drops out of the distribution. Any file can be previewed before sending from the copy in the browser, with nothing sent to a server.
- Upload details: upload and part links are renewed after 13 minutes, and an expired link gets one fresh link. A storage refusal (400, or a 403 that is not an expiry) shows Refused by storage with Retry. A broken connection or a 5xx is retried after 2, 4 and 8 seconds, then shows Upload interrupted, and Retry carries on from the parts already stored. A destination can be ticked only while the page holds a file that can be sent. While the page holds any file not yet sent, the browser asks before it is closed or reloaded. After Send the page clears and shows the job's short ID and the number of deliveries queued.
- *Changed in F1 (see below): two columns, Files and Destinations; no This distribution card, task count, Review section or "Use all files"; a tick goes to the selected files or to every file, including files added later; Send asks one question first; states Uploading, Scanning, Ready, Failed, Refused; the type comes from the contents; the batch survives a reload.*
- Preview and hashing: SHA-256 in parts with `@noble/hashes`. PDF opens in the browser's viewer and images as images; DOCX (`docx-preview`) and XLSX (`exceljs`) load only when used, are shown up to 50 MB, and render into a sandboxed iframe with no scripts, so the same viewer is safe for other people's files in M4.

#### M3: Track a job (7 d)

Demo: submit a job, watch counts and rows change live, see failure reasons inline, refresh mid-run without losing anything. Matches the Track a Job diagram.

**Step 3.1: Status endpoints and cancel (2 d)**

- `GET /jobs`, `GET /jobs/:jobId` and `GET /jobs/:jobId/tasks` with the page-level count query, paging and the fields under Read routes.
- Team visibility: if the caller is not the sender, get their teams from the platform (GET /users/:userId/teams, cached for 60 seconds). They can open the job only if it has a delivery to one of those teams, and they get only those deliveries, with counts for them. The team view of the job list finds jobs through `idx_tasks_team`, with the same cache.
- `POST /jobs/:jobId/cancel`, `POST /jobs/:jobId/retry` and `GET /audit` as in the contracts. The claim already ignores tasks that are final, so a cancelled task's queued message is acknowledged and dropped. The job shows as cancelled once nothing is open, and Retry is refused for a cancelled job. After a cancel or a retry the API pushes one job_update to the job's open dashboards, so its task role may post to WebSocket connections.

**Step 3.2: WebSocket API and WS Handlers (1.5 d)**

- Second API Gateway (WebSocket type) and the WS Handlers Lambda for `$connect`, `subscribe` and `$disconnect`, as in the contracts. Database access through RDS Proxy in prod, directly in dev (ADR-011). Reserved concurrency 3, the number the dev connection budget counts: a throttled connect or subscribe is retried by the browser with a back-off, and the page fetches without the live connection after 5 seconds. The WebSocket stage has no access log, because that needs an account-wide CloudWatch role that a dev teardown would leave behind; the `ws` Lambda already logs every connect, subscribe and disconnect.

**Step 3.3: Catch-up (1.5 d)**

- The browser connects on page load, subscribes when a job is opened, waits for the `subscribed` answer, and only then fetches its tasks (with no answer within 5 seconds it fetches anyway, and a late answer makes it fetch once more), so nothing falls between the fetch and the first push.
- After every token refresh, reconnect with the new token. On every reconnect: subscribe again, then refetch the tasks once. No replay buffer on the server.

**Step 3.4: Web app part 3, dashboard (2 d)**

- Job list with status chips and a Mine / My teams switch, refreshing its counts every 30 seconds (live pushes are for the open job only). Job detail with a virtualized table for up to 2,000 tasks, a status filter, failure reasons inline, Retry failed deliveries and Cancel distribution buttons for the sender, an Audit tab, a full-history Audit trail page with filters, and a clear message when a file has expired.
- WebSocket client with reconnect. Preview and Download icons on each delivered file, switched on in M4 (Step 4.1).
- Page position in the address (`#/status/<job id>`, `#/audit`), so a reload mid-run reopens the same distribution and Copy link can share it. Open by ID sits under the Mine / My teams switch on both tabs, takes a full id or a link, and is off while the box is empty. With nothing open the page reads "Pick a distribution, or paste an id to open one"; "Distribution not found" shows only after a real lookup fails. Signing out resets the address to Distribute, so the next person in the same tab does not land on the last distribution. Distribute stays mounted while Status or Audit shows, so a prepared batch is not lost.
- The task table draws only the rows in view (64 px rows, six more either side) and loads the 100-row page of any row that scrolls in, with no library. File is as wide as the longest name loaded (96 to 280 px) and Destination takes the rest; long text ends with an ellipsis and shows in full on hover.
- Counts and colours: one status chip everywhere (grey waiting, blue working, amber being checked, green done, red a problem). Cancelled has its own grey tile, filter chip and bar segment, shown only when something was cancelled, and red means real failures only. Cancel distribution shows only to the sender while the distribution runs (off, with the reason, when nothing is waiting). Retry shows to the sender when something really failed, off with the reason when it is not allowed. *Changed in F1 (D-F1-77): Cancel and Retry are icons by Close, and Retry shows only when a failed delivery can be retried.* On Distribute, the Documents table sizes its columns to their content (the mockup's draggable widths are dropped), and file type badges are coloured by type (PDF red, DOCX blue, XLSX green, images purple) with the label kept.
- Every icon-only button has a title and an aria-label naming what it acts on; a disabled control looks disabled and says why; cut-off text shows in full on hover; status chips and failure codes carry a one-line meaning from one map. The "+N" folder chip opens one shared popover with the hidden folders: it stays open while the pointer is over the chip or the panel, scrolls, pins on click or Enter, and closes on Esc or a click outside.
- *Changed in F1 (see below): one Status page with a list and a side panel; no Mine / My teams switch, Audit tab or Audit trail page; four filters; loading on scroll; colour for status only (file-type badges are neutral grey).*
- After signing in again from the 12-hour dialog, every part of the page reads again, so no old sign-in error stays. After any failed sign-in, the sign-in screen and the dialog show one fixed line: "After 5 wrong passwords in a row, sign-in pauses for 15 minutes. Wait, then try again." It is the same for every failure, so it reveals nothing about the account.

#### M4: Download a file (2 d)

Demo: Preview shows the file in the page and Download saves it; anyone who is not the sender and not in a team the file was delivered to gets 404. Matches the Retrieve a File diagram.

**Step 4.1: Team-scoped download and preview (2 d)**

- `POST /files/:fileId/downloads`: look up the file, its job, the sender and the file's completed deliveries in DocBeam DB. If the caller is someone else, get their teams from the platform: they may download only if the file was delivered to one of them. Only once access passes, if the file is past its 33-day storage period, answer 410 FILE_EXPIRED, so a stranger gets 404 even for an old file. A mode other than download or preview gets 400 VALIDATION_ERROR.
- Allowed: sign a 2-minute GET link locally for that one object (ADR-002, ADR-004), with `response-content-disposition` set so the file saves under its original name (attachment), or, for a preview, opens in the page (inline, with the stored content type). Preview uses the same route with mode preview and the same checks. The web app shows PDF, PNG and JPG in an in-page viewer and turns DOCX and XLSX into a read-only page in the browser, so no file is converted on a server. Not allowed or missing: 404, so the file's existence is not revealed, and no link or audit event is created. The same 404 covers a bad id, a file in no job and a file not scanned clean. Allowed: write a download.issued audit event (who, the file, the mode and every matching team), then return the link with the file's name, type and size from its record. PDF, PNG and JPG open straight from the inline link; DOCX and XLSX are fetched from it (up to 50 MB) into the sandboxed frame. Download saves through a hidden link, and a bar counts down the link's 2 minutes, then says it has expired; a 410 and a 404 each get their own line.

#### M5: Hardening and end-to-end checks (2 d)

Run against deployed dev; all must pass before the project is called done (and before any prod apply, if prod is ever deployed):

- A 100 x 20 job (2,000 tasks) is accepted in under 500 ms at p99 with deliveries paused, and in under 1 s at p99 with deliveries at full concurrency (D-M5-17).
- Removing the sender from one of the 20 destination teams after submitting, with the Task Queue trigger paused so no delivery starts first: that destination's 100 deliveries fail with NOT_AUTHORIZED_AT_DELIVERY and the other 1,900 complete.
- Stopping the platform for 5 minutes mid-run: retries drain the backlog when it returns, and the DLQ stays empty.
- Submitting a file that was never uploaded is refused with 422 FILE_NOT_READY, and a file removed after submitting fails only that file's tasks with FILE_NOT_UPLOADED.
- Browsing loads in under 1 second for a user in 50 teams.
- A 1 GB multipart upload completes, is checked by its combined checksum and is delivered with a matching SHA-256.
- A viewer in only one destination team sees only that team's deliveries and audit events, and gets 404 for a file sent only to another team.
- A database failover (reboot with failover) during a run, with dev switched to Multi-AZ for the drill (RDS Proxy stays off on the Free plan): deliveries pause, then finish; nothing is lost.
- The EICAR test file is refused as infected before submit and can never be downloaded.
- Cancelling mid-run: running deliveries finish, waiting ones show CANCELLED, and the job reads cancelled.
- A refresh token used twice cancels the sign-in, and 5 wrong passwords pause sign-in for 15 minutes.
- Security: no-token calls get 401 at the gateway, cross-team download or preview gets 404, expired links fail, gitleaks is clean. A POST with no body (cancel, retry, a download link) works through CloudFront for any API client (fixed in M5, D-M5-5; it used to get 415).
- Dropping the job message after commit: the sweeper starts fan-out within 3 minutes.
- Browser: slow-connection upload, multipart resume, WebSocket reconnect, and PNG and JPG preview, run as Playwright tests on dev.

#### F1: Reviewer feedback round (after M5)

A reviewer used the M5 build and asked for a calmer, clearer tool for a coordinator who is not technical. The round changed the screens, a few rules and some API answers; the upload and delivery pipeline is unchanged. Every change is a decision in `docs/DECISIONS.md` (D-F1-1 to D-F1-74); the contracts above already include them.

**Rules and API**

- Only folders are destinations; binders are headings (D-F1-3). `validateBatch`, `POST /jobs`, `POST /destinations/check` and `POST /documents` refuse a destination with no folder.
- No self-registration in the web app; `POST /auth/register` is switched off at the gateway (D-F1-17). A refresh token replayed within 30 seconds of its swap is a lost answer, not a theft (D-F1-19, ADR-015). Services keep stale signing keys rather than answer 401 for a good token (D-F1-14).
- The four platform browse routes are paged with a cursor; teams 50 per page (D-F1-6, D-F1-16). `GET /folders/search` finds folders by name in the caller's teams, with a trigram index (D-F1-67). `GET /teams/members` gives the Sender filter's names (D-F1-21).
- `GET /jobs` is one list of everything the caller can see, with `status`, `sender`, `sentSince`, `team` and `idPrefix` filters, `fileNames` and `destinations`, ordered by `created_at` then `id`, both descending, and a cursor carrying both (D-F1-21, D-F1-32, D-F1-40). `GET /jobs/running` counts the distributions still running (D-F1-34). A job with no deliveries reads pending, never completed (D-F1-62).
- The type of a file is read from its contents in the browser and by the Upload Events Lambda, which stores `files.detected_type` and refuses a mismatch with CONTENT_TYPE (D-F1-44). Task lists and download answers use the detected type.
- The Delivery Lambda pushes a small `task_update` when a delivery starts its second or a later try, so the page shows "Retrying" live (D-F1-65).
- The web app shows job history only; audit records are still written and `GET /audit` stays (D-F1-13).

**Web app**

- One design system in `web/src/styles.css`: neutral palette, one accent, colour for status only, five type sizes, a 4 px scale, one radius, one shadow, motion tokens with reduced-motion support, one font (IBM Plex Sans), one icon set, one Tooltip and one Popover (D-F1-5, D-F1-42, D-F1-47).
- Distribute: two columns, Files and Destinations, filling the window from 1024 px up; a click toggles a file; folders ticked with no file selected are held for every file added later; folder counts and "N folders" open one shared popover; a "Filter…" box over the files, the folders and the panel's deliveries that is always shown (off while its list is empty, no threshold) and a server folder search from 2 characters; the boxes and buttons that sit together share one height, `--control`, 36 px (D-F1-77); Send asks "Send N files to M folders?" with Cancel focused; the reason Send is off is shown beside it; file states Uploading, Scanning, Ready, Failed, Refused with reasons in tooltips; the batch is kept in sessionStorage and restored after a reload (D-F1-8, D-F1-20, D-F1-36 to D-F1-39, D-F1-41, D-F1-45, D-F1-60, D-F1-66).
- Status: one list (ID with the sender below, status, sent, the first file and the first two folders with "+N") with four filters kept in the address, loading on scroll; a row opens a side panel (first row: ID, copy link, status, then for the sender the Cancel and Retry icons, a 1 px divider and Close, with the divider hidden when neither icon shows; second row: "Sent by" and, for a team member, " · Showing only deliveries to" and the teams the distribution reaches as chips, sorted A to Z, all of them up to 3 and otherwise the first 2 and a "+N" chip with a tooltip of every team, taken from the folders the detail lists, so no API change; a progress line; status tabs in the fixed order All, Completed, Failed, In progress, Pending, Cancelled, where Completed is always shown, All is shown unless Completed is the only status with deliveries, the others are shown when above 0, and the selected tab stays at 0 until another is picked; the deliveries with reasons and attempts in tooltips) (D-F1-77); Open by ID takes the 8-character ID; after Send the new distribution opens with the filters cleared; rows are 52 px in both tables; one date format ("Today, 04:34") with the full time on hover; opening by ID or a link scrolls the list to the row (D-F1-74); tooltips explain the Status badge, the progress line, the file type tag, Clear and binder headings (D-F1-72); the Cancel and Retry icons are named by their tooltips, "Cancel distribution" and "Retry failed deliveries" (D-F1-77) (D-F1-21, D-F1-29, D-F1-31 to D-F1-33, D-F1-46, D-F1-49 to D-F1-53, D-F1-56, D-F1-57, D-F1-59, D-F1-60).
- Sign-in: the tagline and the subtitle "Clinical trial document distribution for study teams", a show-password eye, and the sign-in dialog only on a refused refresh (D-F1-14, D-F1-17, D-F1-61).

**Checked on dev (2026-10-20 and 21)**: the largest job, 2,000 deliveries, accepted at p99 175 ms in normal operation and 452 ms under peak load, and delivered in 26.2 s (first delivery 4.6 s), 0 failed; a 22-minute session with no sign-in dialog; browse for 50 teams at p99 832 ms from a laptop (49 ms at the gateway) (D-F1-55). Results: `docs/testing/F1-RESULTS.md`. A guide to every screen, call and field: `docs/USER-FLOW-AND-APIS.md` (D-F1-70).

### Concurrency

SQS delivers at least once, so every handler gives the same result if it runs twice.

| **Scenario** | **How it is handled** |
|---|---|
| The same task message arrives twice | The conditional claim lets both run, but if both reach the platform, `source_task_id` stores the document once. Exactly one outcome from at-least-once delivery |
| A slow 1 GB delivery outlasts the visibility timeout and a second worker starts | Cannot happen in normal running: the platform call gives up after 100 seconds and the Lambda after 120, long before the 720-second visibility timeout. If a worker crashes, the message returns after 720 seconds, source_task_id stores the document once and the conditional final writes keep one outcome |
| Fan-out crashes partway through a job | SQS redelivers the job message and fan-out resends every pending task. A repeat for a task that already finished stops at the claim; a repeat for an open task is stored once by source_task_id |
| Two tasks of one job finish at the same moment | Each final write first locks the job row (`SELECT ... FOR UPDATE`), then sets `completed_at` only if nothing is open. The two writers take turns, so the second always sees the first one's result and closes the job |
| The client retries POST /jobs after a timeout | The required Idempotency-Key and its unique index return the existing job. If the first request is still running, the second insert waits on the index, then reads the job the first one saved |
| Two jobs try to use the same uploaded file | `UPDATE files SET job_id = ... WHERE id = $1 AND job_id IS NULL`; the second gets 409 FILE_ALREADY_SUBMITTED |
| A job is submitted before a file finished uploading | The web app blocks it. If a client does it anyway, submission refuses it with 422 FILE_NOT_READY and nothing is created |
| A user leaves a team between browsing and delivery | The platform re-checks membership at ingest; the task fails with NOT_AUTHORIZED_AT_DELIVERY |
| A destination folder or binder is deleted after submitting | Ingest checks the destination again and returns 404. That task fails with DESTINATION_NOT_FOUND; the rest carry on |
| A late result arrives after the DLQ Consumer has failed the task | Every final write is conditional on the task still being open, so the first final status wins and never flips |
| The sweeper re-sends a job that fan-out is already handling | Fan-out is safe to repeat: a duplicate message for a finished task stops at the claim, and one for an open task is stored once by source_task_id |
| Two browser tabs for one user | Stateless API, separate file rows, one connection row per tab. Nothing shared to corrupt |
| The sender retries while other deliveries are still running | One conditional UPDATE resets only failed tasks with a retryable code; running and completed tasks are untouched, and the claim ignores anything already final |
| A user is removed from a team while watching a distribution with deliveries to that team | Each connection keeps its token expiry and expired ones get no pushes, so updates stop within 15 minutes; the reconnect is checked again |
| The sweeper deletes an old unsubmitted file while the user submits it | Submission refuses files older than 24 hours, and the sweeper deletes only files older than 24 hours with no job, each in one conditional statement. A file is claimed or deleted, never both |
| Two copies of the same delivery reach the platform at once | The insert uses ON CONFLICT on source_task_id. The loser deletes the object it stored and returns the winner's document |
| The sender cancels while deliveries are running | Cancel locks the job row and changes only pending tasks. Running deliveries finish and write their result; queued messages for cancelled tasks stop at the claim |
| A file is submitted before its scan finishes | Submission refuses it with 422 FILE_NOT_READY. The page keeps Send off until every file is ready (Scanning until then) |
| The same upload event arrives twice | The update is conditional, so the second one changes nothing |
| Two tabs try to refresh the same sign-in at once | A browser lock lets only one tab refresh, and the others reuse its new token. A token presented twice anyway cancels the sign-in, and that tab asks for the password |

### Failure modes

When one dependency goes down, work either waits in a queue or ends as a visible failed task. Nothing is dropped.

| **Dependency down** | **What happens** | **Recovery** |
|---|---|---|
| Document Platform | Deliveries retry after 30 seconds, then 2, 5 and 10 minutes, then go to the DLQ. An outage of up to about 17 minutes heals by itself; after a longer one the sender uses Retry failed deliveries. Browsing and submission checks fail (ADR-006) | The backlog drains when it returns; the DLQ Consumer marks stragglers failed, visibly |
| Auth Service | New logins and token refreshes fail. Access tokens already issued work until they expire (at most 15 minutes), and workers keep using cached service tokens | ECS replaces unhealthy tasks |
| PostgreSQL | Multi-AZ fails over to the standby in about 1 to 2 minutes (20 seconds in the M5 drill), which the delivery backoff rides out. Every service's database pool has a query timeout and TCP keep-alive, so connections left on the old primary are dropped and replaced; without them the platform answered 500 for over 10 minutes after the first drill (D-M5-13). In a longer outage, deliveries use up their attempts and wait in the Task DLQ (messages kept 14 days) until the DLQ Consumer can write again | On recovery the DLQ Consumer marks those tasks RETRIES_EXHAUSTED, visibly, and the sender retries them. Nothing is lost |
| S3 or KMS | Uploads and deliveries fail for a while | Normal retries; nothing already confirmed is lost |
| Job message not sent after commit | Job and tasks saved, fan-out not started | The sweeper re-sends the message within about 2 minutes (ADR-014) |
| Fan-out keeps failing | The job message lands in the Job DLQ | The DLQ Consumer fails the pending tasks with FANOUT_FAILED |
| User closes the tab mid-upload | No job is submitted; uploaded files are left without a job | The sweeper deletes them after 24 hours |
| WebSocket push path | The dashboard stops updating live | Not fatal: the browser refetches on reconnect, and deliveries continue |
| One availability zone | In prod every ECS service runs 2 tasks across zones, RDS is Multi-AZ and each zone has its own NAT gateway (dev uses one of each to save credits). Lambda, SQS and S3 span zones already | No extra work needed |
| The Upload Events Lambda or its scanner | New files stay Scanning and cannot be submitted; nothing unscanned can be sent | Upload events wait in the queue (14 days) and are handled on recovery; files stay Checking until then, and unsubmitted files are deleted after 24 hours. Files whose events reach the Upload DLQ show could not be checked, and the user adds them again |

### Security and access

Permissions are checked at six points, and no check relies on an earlier one.

| **Checkpoint** | **Who checks** | **Rule** |
|---|---|---|
| **Browse** | Document Platform | Every read is filtered by the caller's teams |
| **Upload** | Object Store, Upload Events Lambda (ClamAV) | Size, type and SHA-256 enforced on write; every file is confirmed and scanned; only clean files can be submitted or read |
| **Submit** | DocBeam API, asking the platform | The caller belongs to every destination team (POST /destinations/check) |
| **Ingest** | Document Platform | The user is still a member at the moment of delivery |
| **View or subscribe to a job** | DocBeam API or WS Handlers, asking the platform | The caller is the sender, or the job has a delivery to one of the caller's teams. Anyone else but the sender sees only the deliveries to their own teams |
| **Download** | DocBeam API, asking the platform | The caller is the sender, or the file was delivered to one of the caller's teams; otherwise 404 and no link |

- **Authentication.** The gateway's JWT authorizer rejects unauthenticated traffic before it enters the network, checking the issuer and audience (ADR-001). Each service checks the token again, including `token_use`, because workers reach the platform without the gateway. Service-to-service calls use scoped service tokens (ADR-013). Refresh tokens live only in a `Secure`, `HttpOnly`, `SameSite=Strict` cookie limited to `/api/auth`, are stored as hashes, work once, and a reused one cancels the whole sign-in (ADR-015). 5 wrong passwords in a row pause sign-in for 15 minutes.
- **Presigned links.** Signed only after the permission check, one object and one operation each. Uploads expire in 15 minutes, downloads in 2 (ADR-002, ADR-004).
- **Files.** SSE-KMS with S3 Bucket Keys on both buckets (ADR-003), TLS required by bucket policy, content-type allow-list and size limit enforced by S3 and again at ingest, where the file's first bytes must also match its type. RDS storage and the queues are encrypted too. Every upload is scanned with ClamAV, and the Object Store refuses to hand out anything not tagged clean (ADR-016).
- **Secrets.** Database credentials, the JWT signing key and service client secrets are generated (Step 0.2), live in Secrets Manager and are injected at runtime. Terraform refers to them by ARN in code and never contains a value. gitleaks runs in CI.
- **Sensitive data.** Password and refresh-token hashes in Auth DB, clinical documents in the two buckets. Everything else is metadata. Logs carry task IDs and error codes, never file contents.
- **Accepted risk.** A presigned link works for anyone holding it until it expires; single-object scope and short expiry keep this small.

### Testing strategy

| **Layer** | **When it runs** | **What it covers** |
|---|---|---|
| **Unit** | Every CI run | Token issuing and checking (`iss`, `aud`, `token_use`), POST policy and part signing, batch limits, refresh rotation and reuse detection, counting wrong passwords, the claim logic, job status, sorting platform answers into temporary and permanent, the deploy and run-task scripts' skip rules, the dev connection budget, the platform's ingest limit. Web (vitest with jsdom): the token and session logic, the 20-destination limit and the lazy tree |
| **Integration (Compose + LocalStack)** | Every CI run | Upload (single and multipart), submit, fan-out and deliver end to end; the same task message twice; a redelivered job message; a temporary error putting a task back to pending; two last tasks finishing together; DLQ Consumer marking tasks failed, and marking a file failed from the Upload DLQ; FILE_NOT_UPLOADED; CHECKSUM_MISMATCH; UNSUPPORTED_TYPE; a repeated upload event; a size or checksum mismatch refused and the object deleted; parallel wrong passwords that cannot get past the pause; an EICAR test file refused by the real ClamAV scanner; cancel while deliveries run; the platform finishing an upload after SIGTERM; 503 PLATFORM_BUSY after 30 seconds of waiting; team-scoped visibility of jobs, tasks, audit events and downloads; the sweeper re-sending a job |
| **Browser (Playwright, local)** | Before a milestone closes, locally; in M5 also against dev (test:e2e:dev). Not in CI | Counts changing without a reload, a reload mid-run, a second person's view, Cancel and Retry, the popover, sign-in expiry and column sizes, against Docker Compose and the Vite dev server (`npm run test:e2e`) |
| **End to end (deployed dev)** | Before the project is called done | The M5 checklist |

### Launch plan

- **Migrations.** Each service runs its own forward-only migrations as a deploy step. A change that is not backward-compatible ships in two deploys: expand, then contract. A new NOT NULL column on a table that already has rows is added in three steps (add as nullable, backfill, then set NOT NULL), or with a DEFAULT. CI runs every migration against a database that already holds seed data.
- **Seed data.** The platform seed script runs after migrations in every environment.
- **Rollout.** M0 to M5 in order, each checked on dev. This build stops there: it is a portfolio project shown on dev, with a recorded demo, and prod is never deployed. Prod stays ready as code: `infra/envs/prod`, the same modules with prod sizing, and workflows that deploy it only on a manual run from main with the typed confirmation deploy-prod. Gateway routes are added only after services pass checks from inside the network. The first bring-up of a new environment follows a set order: image repositories and images, the first apply without the JWT authorizer, the database and signing-key bootstrap tasks, the deploys, then the second apply with the authorizer (Step 1.4). That order is written as a runbook (docs/RUNBOOK-first-bring-up.md), proven in M5 by building dev from nothing (about 107 minutes).
- **Dev left up.** A scheduled workflow runs every day at 23:00 IST and fails, which sends an email, if a `docbeam-dev` ECS cluster still exists. Dev costs about 4.5 USD a day while up.
- **Feature flags.** None in v1; there are no existing users to protect. That manual run is the control point.
- **Rollback.** Previous image SHA for services and workers, previous plan for infrastructure.
- **Retention.** The requirement is to keep staged files for 30 days after the job finishes. S3 expiry rules count from upload, not from job completion, so a 30-day rule could delete a file slightly early. The rule is set to 33 days instead. A file must be submitted within 1 day of upload (older files get FILE_TOO_OLD), a job finishes within hours, and Retry is refused once any of the job's files is more than 2 days old, so every file is kept at least 30 days after the last delivery that uses it. Only a job that finishes more than 3 days after upload would get less, which would take a database outage of days; the DLQ alarms would flag it long before. Deleting exactly 30 days after completion would need a daily sweep keyed on `jobs.completed_at`; left for v2 unless compliance requires it. The Platform File Store has no expiry, and job and task records are kept with no expiry in v1. Both are open questions for the client.
- **Monitoring.** Default CloudWatch metrics and logs, as the Blueprint scopes it, plus four alarms that back the success metrics, sent by email through one SNS topic to the address in the repository variable `ALARM_EMAIL` (built in Steps 2.1, 2.3 and 2.4; the Delivery alarm fires when errors exceed 1% of runs for 15 minutes): Job DLQ depth above 0 for more than 5 minutes, Task DLQ and Upload DLQ depth above 0 for more than 5 minutes (any of them means something is failing), and the Delivery Lambda error rate. The delivery failure rate is one query on tasks: failures with a system code (RETRIES_EXHAUSTED, FANOUT_FAILED) divided by all tasks over 7 days. Failures caused by the user's data or access are counted separately, and cancelled deliveries are left out.
- **Build decisions.** Changes agreed during the build are recorded in the repository's `docs/DECISIONS.md`, which wins where it differs from this document. The main ones are folded in above. Two schema additions live only there: user tokens carry a `name` claim and `jobs.submitted_by_name` stores it (D-G6), and `tasks.destination_path` stores each destination's readable path from the platform (D-G7). Database TLS checks the certificate chain (verify-full): the RDS certificate bundle is in every image (D-M5-4; before M5, dev skipped that check, D-M1-10). Tearing dev down: `terraform destroy` cannot empty the large versioned data buckets, so they are emptied with the AWS CLI first (D-M2-23); M3 adds a script for this. M4's decisions (D-M4-1 to D-M4-5) and M5's (D-M5-0 to D-M5-18) are folded in above. Known limit after M5: at peak delivery load on the dev db.t4g.micro, submit p99 came within 8 ms of 1 s. Up to 49 deliveries queue on one job's row lock (every final delivery write locks it) while the small database runs short of memory. Planned, not done: a db.t4g.small for dev, and closing the job without the row lock (a conditional close after commit, or a counter); prod's Multi-AZ instance needs the same check. POST /jobs logs one timing line per request with each phase's milliseconds, so the cause will show if it returns (D-M5-14, D-M5-16).

### Open questions

| **Question** | **Current answer** | **Owner** |
|---|---|---|
| Must staged files be deleted exactly 30 days after completion? | Currently at least 30 days after completion (33-day rule from upload). Exact deletion needs one more daily sweep | Client |
| Do any teams need their documents kept in a specific region (data residency)? | Assumed no: v1 is one deployment, in Sydney (`ap-southeast-2`), so files and data are stored in Australia. If they must stay in India, the account needs advanced features for Mumbai, and storage and deployment change per region, not just routing | Client |
| Should delivered documents in the Platform File Store ever be deleted? | No expiry. Assumed to be kept as trial records | Client |
| How many large files can the real Document Platform take at once, and how does it answer when it is busy? | Unknown. The stand-in takes 6 at once and answers 503 PLATFORM_BUSY after 30 seconds of waiting; Delivery retries any 503 | Client |
| Move the AWS account from the Free plan to the Paid plan | Only if prod is ever deployed. This build stays on the Free plan and is shown on dev; the plan ends after 6 months or when the credits run out | Anantim |
| The brief says no alerting in v1. Keep the four email alarms? | Kept for now: the no-silent-loss promise depends on someone noticing a stuck DLQ. Removing them is one Terraform change | Client |
| Must people be able to download a distribution's files after 33 days? | No: the link answers 410 File no longer available. The delivered copy stays in the team's binder in the Document Platform | Client |
| Requirement 8 lets a user download any file in a job sent by a member of their teams. Read literally, a Cardio member could open files sent only to Oncology. Is the narrower rule right? | v1 uses the narrower rule, to match requirement 7 and the security rule: the sender sees everything; anyone else sees and downloads only what was delivered to their own teams | Client |
