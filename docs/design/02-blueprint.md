# DocBeam blueprint

## DocBeam Blueprint (PAS-001)

Batch document distribution for clinical trial documentation

| **Field** | **Value** |
|---|---|
| **Status** | **Draft** |
| **Owner** | Anantim |
| **Updated** | 10 October 2026 |
| **Related** | DocBeam ADRs, DocBeam Technical Design |
| **Diagrams** | [Eraser workspace: architecture and four user flows](https://app.eraser.io/workspace/Wj6gXZ0DTYhnxzoPnwYY) |

> **In one sentence.** DocBeam lets a trial coordinator pick files once, send them to many team folders in one batch, and see whether every file reached every destination. (The brief calls this project DocBridge; DocBeam is its product name.)

### The problem

The client builds an electronic document management system (EDMS) for clinical trial documents. Research teams in hospitals and biotech companies keep their documents in a fixed hierarchy (Team, Binder, Folder, Document), and access is controlled by team membership.

Coordinators often need to send the same documents to many places at once. A typical case is 10 regulatory documents going to 15 team binders across 5 hospitals. Today the system only takes one file into one destination at a time.

#### How it works today

- Each file goes to each destination by hand. The example above is 150 separate uploads.
- A batch cannot be submitted or tracked as one unit; every upload stands alone.
- When something fails halfway, there is no record of which file and destination pairs succeeded.

#### Why it matters

- At the stated limit of 100 files and 20 destinations, one distribution is up to 2,000 manual uploads.
- Nobody can confirm that a regulatory document reached every required binder. In a clinical trial that is a compliance risk.
- Partial failures are found late, or not at all.

### What done looks like

Release 1 is done when a user can submit N files to M destinations and:

1. the system confirms the job in under 500 ms, without waiting for any delivery;
2. every file and destination pair is delivered in the background, independently of the others;
3. the user can watch the status of every pair until the whole job finishes;
4. no file is ever lost without a visible failure and a reason.

### Context

DocBeam is a standalone web application. There are no outside systems: we build all three parts ourselves.

| **Part** | **What it is** | **v1 scope** |
|---|---|---|
| **DocBeam** | The product: browse, upload, map, submit, track, preview, download | Full |
| **Auth Service** | Accounts, login and tokens | Basic |
| **Document Platform** | The EDMS that receives delivered files | Basic |

The hierarchy DocBeam delivers into:

```
Team
  └── Binder
        └── Folder (can be nested)
              └── Document
```

A user sees and acts only on teams they belong to, and everything inside them. v1 runs as one deployment.

#### Key terms

| **Term** | **Meaning** |
|---|---|
| **Team** | The access boundary. Which teams a user belongs to decides everything they can see. |
| **Binder** | A document collection inside a team. |
| **Folder** | An optional grouping inside a binder. Folders can be nested. |
| **Destination** | A binder or a folder that a file can be delivered to. Always belongs to a team. |
| **Job** | One batch submission: a set of files and the destinations each one goes to. |
| **Task** | One file going to one destination. 100 files and 20 destinations make up to 2,000 tasks. |
| **Task status** | `pending` (created, no worker has it yet), `in_progress` (a worker owns it), then **completed** or **failed**. |
| **Fan-out** | Turning one job into one queue message per task, so every task is processed on its own. |
| **Presigned URL** | A short-lived signed link that lets the browser upload or download one file directly from storage, without going through our servers. |
| **Object Store** | Encrypted S3 bucket that holds uploaded files until delivery. Files are kept at least 30 days after the job finishes, then deleted automatically. |
| **Platform File Store** | The Document Platform's own encrypted S3 bucket for delivered documents. No expiry, and versioned so nothing is lost by mistake. |
| **DLQ** | Dead-letter queue. Holds messages that ran out of attempts (3 for a job, 5 for a delivery or an upload event), so they can be handled instead of lost. |
| **Checksum** | A SHA-256 fingerprint of a file. The browser computes it, and it is checked again at every step until delivery. |

#### Assumptions

- The Auth Service is a basic build: register, log in, issue user, refresh and service tokens, pause sign-in after repeated wrong passwords, publish its public signing keys.
- The Document Platform is a basic build: list the teams, binders and folders a user belongs to, answer membership checks, and accept delivered files.
- Teams, binders, folders and memberships are loaded by a seed script. v1 has no screens or APIs to create or edit them.
- A file is uploaded once and delivered many times. 100 files can produce up to 2,000 deliveries.
- Team membership is the whole permission model in v1. No per-folder or per-document rules.
- Users are trusted employees, but every operation still checks who they are and what they may access.
- Encryption at rest is done by AWS KMS. We write no cryptography of our own.

#### Out of scope for v1

- Monitoring beyond default AWS metrics and logs: no custom dashboards or tracing. The brief also rules out alerting; four email alarms (one per DLQ, and the delivery error rate) are the one exception, because the promise of no silent loss depends on them. The client can drop them (open question in the Technical Design tab).
- Integration with any outside system.
- Auth features beyond the basics: password reset, email verification, MFA, roles, admin screens.
- Platform features beyond the basics: creating or editing teams, binders, folders or memberships, document versioning, viewing documents in the platform.

### Job stories

| **When I...** | **I want to...** | **So that...** |
|---|---|---|
| start a distribution session | browse only the teams, binders and folders I have access to | I cannot send files somewhere I am not allowed to |
| have a batch of documents to send | pick all the files and map each to one or more destinations in one session | I do not repeat the same upload dozens of times |
| submit a batch | get an immediate confirmation that the job was accepted | I can move on while deliveries run in the background |
| have a job running | see the live status of every file and destination pair | I know what has landed and what is still waiting |
| see a delivery fail | see which file, which destination, and why | I can fix the cause or escalate without guessing |
| need a file a colleague sent to my team | download it from their distribution | our team works from the same documents |

### High-level architecture

The full diagrams are in the [Eraser workspace](https://app.eraser.io/workspace/Wj6gXZ0DTYhnxzoPnwYY). The system has five zones; the colours below match the zones in the architecture diagram.

| **Zone** | **Component** | **What it does** |
|---|---|---|
| Client | **Web Client (React SPA)** | Browse destinations, pick, preview and map files, submit jobs, watch status, preview and download. Sends and receives file bytes directly to and from storage. |
| Edge | **CloudFront** | Serves the web app, and forwards /api/* to API Gateway, so the app and the API are one site. |
| Edge | **API Gateway (HTTP)** | The single public entry for API calls. Checks the JWT on every request except login, register, token refresh, sign-out and the public-key routes, then routes into the private network. Every route is listed; there is no catch-all. |
| Edge | **WebSocket API** | Keeps live connections open so status changes can be pushed to the browser. |
| Private network | **Internal ALB** | Routes API traffic to the right service. Not reachable from the internet. |
| Private network | **Auth Service** | Accounts, login, user, refresh and service tokens, and the pause after repeated wrong passwords. The only part that handles passwords. |
| Private network | **DocBeam API** | Upload URLs, job submission, job and task status, download URLs. Owns DocBeam DB. Never touches file bytes. |
| Private network | **Document Platform** | Browsing, membership checks and file ingest. Owns Platform DB and the Platform File Store. |
| Data | **Auth DB, DocBeam DB, Platform DB** | Three separate PostgreSQL databases on one Multi-AZ instance. Each service can open only its own. |
| Data | **RDS Proxy** | Pools database connections for the Lambda functions, so a burst of work cannot exhaust PostgreSQL's connection limit. Prod only: the AWS Free plan blocks it, so in dev each Lambda copy connects directly with one connection. |
| Data | **Object Store** | Encrypted bucket for uploaded files until delivery. Files are kept at least 30 days after the job finishes, then deleted automatically. Every upload is scanned for malware before it can be sent. |
| Data | **Platform File Store** | Encrypted, versioned bucket where delivered documents live. |
| Async | **Job Queue and Job DLQ** | One message per submitted job. |
| Async | **Fan-out Lambda** | Reads a job message and sends one message per task to the Task Queue. |
| Async | **Task Queue and Task DLQ** | One message per task. A delivery gets up to 5 attempts over about 17 minutes, then moves to the DLQ. |
| Async | **Delivery Lambda** | Delivers one task: checks the file, sends it to the platform, records the result, pushes the update. |
| Async | **DLQ Consumer** | Marks tasks from the Job and Task DLQs as failed with a reason, and files from the Upload DLQ as not checked, so nothing is lost silently. |
| Async | **Scheduler and Sweeper Lambda** | Runs on a schedule. Every minute it re-sends any job that was saved but not split into tasks after 2 minutes. Once a day it deletes uploaded files still not submitted 24 hours after upload (ADR-014). |
| Async | **WS Handlers** | Run when a browser connects, subscribes to a job, or disconnects. Keep track of who is watching which job. |
| Async | **Upload Events Queue and Upload DLQ** | One message each time a file lands in the Object Store. |
| Async | **Upload Events Lambda** | Confirms each uploaded file (size and fingerprint), scans it for malware with ClamAV and tags it clean. Deletes infected files and files that do not match. Only confirmed, clean files can be sent (ADR-016). |
| Async | **Malware scanner (ClamAV)** | Open source virus scanner packed into the Upload Events Lambda. A daily rebuild keeps its virus definitions current. |

Components and responsibilities only. Schemas, endpoints and internals are in the Technical Design tab.

### User flows

Detailed flows are here. Each flow has a matching sequence diagram in the Eraser workspace.

#### Flow 1: Browse and select destinations

1. The user logs in. The Auth Service checks the password against Auth DB and returns a 15-minute access token, plus a refresh token in a secure cookie that keeps the sign-in going for 12 hours. Five wrong passwords in a row pause sign-in for that account for 15 minutes.
2. The browser asks for the user's teams. API Gateway checks the token and passes the call to the Document Platform, which reads the user's teams from Platform DB.
3. The user expands a team, then binders and folders, one level at a time. The platform checks membership at every level and returns 404 for anything outside the user's teams.
4. The user selects up to 20 destinations.

> **Outcome.** A set of access-checked destinations, with each level loading in under 1 second.

#### Flow 2: Upload and distribute documents

1. The user picks up to 100 files and maps each to one or more destinations. The browser computes a SHA-256 fingerprint for each file.
2. The browser asks DocBeam API for upload URLs, 20 files at a time. DocBeam API records each file and signs one presigned upload per file.
3. The browser uploads each file straight to the Object Store. S3 checks the size, type and fingerprint, and rejects any file that does not match. The Upload Events Lambda then confirms each stored file and scans it for malware with ClamAV; only confirmed, clean files can be submitted.
4. The user submits the job: file IDs, fingerprints and destinations. DocBeam API checks the files belong to the user and asks the Document Platform to confirm that every destination exists and is in one of the user's teams.
5. In one database transaction DocBeam API creates the job and one pending task per file and destination pair (up to 2,000). It sends one message to the Job Queue and replies in under 500 ms.
6. The Fan-out Lambda sends one message per task to the Task Queue.
7. For each task, the Delivery Lambda marks it in progress, checks the file in the Object Store, and delivers it to the Document Platform. The platform checks the user is still a member, checks the fingerprint again, and stores the document once per task.
8. The result is recorded and pushed to the dashboard. Temporary errors are retried with growing gaps; after 5 failed attempts (about 17 minutes) the DLQ Consumer marks the task failed with a reason, and the sender can retry failed deliveries in one click.

> **Outcome.** The job is accepted at once. Every task ends **completed** or **failed** with a reason, and one failed task never holds up the others.

#### Flow 3: Track a job

1. The user opens the job list. The browser connects to the WebSocket API, and the list shows each job with its overall status, refreshed every 30 seconds.
2. The user opens a job. The browser subscribes to that job first, then fetches its tasks, so no update is missed in between. Someone other than the sender sees a job only if it has deliveries to one of their teams, and then sees only those deliveries.
3. Each status change is pushed to the browser as it happens.
4. If the connection drops, the browser reconnects, subscribes again and refetches the tasks.
5. The sender can cancel a running distribution: deliveries not yet started stop, and ones already running finish.

> **Outcome.** The user can tell at a glance whether every file reached every destination, and why any did not.

#### Flow 4: Download a file

1. The user picks a file from a job and asks to preview or download it.
2. DocBeam API checks that the user is the sender, or that the file was delivered to one of the user's teams (it asks the Document Platform for the user's teams).
3. If yes, DocBeam API signs a 2-minute download link for that one file, and the browser downloads it straight from the Object Store. A preview uses the same check and the same kind of link, shown in the page instead of saved.
4. If no, the answer is 404 and no link is ever created.

> **Outcome.** Only the sender and members of the receiving teams can get a file, and file bytes never pass through our servers.

### Decisions with architectural impact

Each decision has a full record in the DocBeam ADRs tab.

| **ADR** | **Decision** | **Status** |
|---|---|---|
| 001 | API Gateway in front of a private ALB; services are never public | **Accepted** |
| 002 | Files move by presigned URLs, never through our servers | **Accepted** |
| 003 | S3 encryption with an AWS-managed KMS key | **Accepted** |
| 004 | Upload links last 15 minutes, download links 2 minutes | **Accepted** |
| 005 | Amazon SQS with dead-letter queues | **Accepted** |
| 006 | Three services: Auth, DocBeam API, Document Platform | **Accepted** |
| 007 | Live status over the API Gateway WebSocket API | **Accepted** |
| 008 | Two queues: one message per job, then one per task | **Accepted** |
| 009 | One PostgreSQL instance with three isolated databases | **Accepted** |
| 010 | PostgreSQL for all three databases | **Accepted** |
| 011 | Lambda workers behind RDS Proxy | **Accepted** |
| 012 | Terraform for all infrastructure | **Accepted** |
| 013 | Service-to-service tokens and repeat-safe ingest | **Accepted** |
| 014 | Sweeper that re-sends job messages lost after commit | **Accepted** |
| 015 | Refresh tokens in a secure cookie, rotated on every use | **Accepted** |
| 016 | Upload events queue confirms each file; the Lambda scans it with ClamAV | **Accepted** |

### Technical design

The DocBeam Technical Design tab holds the schemas, API contracts, milestones, estimates, concurrency and failure handling, and the launch plan. Its total, 39.5 working days, is copied into Release 1 below.

### Releases

#### Release 1: Core pipeline

| **Target date** | **Status** | **Estimate** |
|---|---|---|
| TBD | **Planned** | 39.5 working days (from the TDD) |

**Scope**

- Register and log in, with a sign-in that lasts a working day (refresh tokens) and a pause after repeated wrong passwords
- Destination browsing limited to the user's teams
- Picking up to 100 files, with direct upload to storage, progress per file, and a malware scan of every file before it can be sent
- Mapping files to up to 20 destinations and submitting in one action, confirmed in under 500 ms
- Background delivery of each task on its own, with automatic retries
- Retrying failed deliveries, or cancelling a distribution, in one action
- An audit trail of who sent what, where and when, and of every delivery outcome
- A list of other people's distributions with deliveries to the user's teams
- Live status per task, down to the reason for each failure
- Team-scoped preview and download straight from storage, and a preview of each file before it is sent
- Encrypted storage, with staged files kept at least 30 days after the job finishes
- Basic Document Platform and Auth Service, with seeded teams, binders, folders and memberships

**Dependencies.** None outside the team. Auth Service and Document Platform are built in this release.

Success metrics

| **Metric** | **Target** | **How we measure it** |
|---|---|---|
| **Submission speed** | Under 500 ms at p99, whatever the batch size | Response time of the submit API |
| **No silent file loss** | 0 failures that go unnoticed | Every failed task shows on the dashboard; DLQ depth does not stay above 0 |
| **Delivery failure rate** | 0.1% or less in normal conditions | Tasks failed for a system reason (RETRIES_EXHAUSTED, FANOUT_FAILED) divided by all tasks, over 7 days. Failures caused by the user's data or access are reported separately, and cancelled deliveries are left out |
| **Destination browsing** | Under 1 s for a user in up to 50 teams | Time until the first level is usable |
| **Failure isolation** | One failed task never blocks the others | Integration test: break one delivery, check the rest complete |
| **End to end** | A full batch completes locally and in AWS | Smoke test: N files to M destinations, every task done |

**Risks**

| **Risk** | **What could happen** | **How we handle it** |
|---|---|---|
| **Fan-out spike** | One submission creates 2,000 tasks and floods processing | The queue absorbs the spike; workers scale out and pull at their own pace |
| **Duplicate delivery** | A message is delivered twice and the same file lands twice | A message can arrive twice, but each task stores at most one document: the platform keeps one document per task and returns it on a repeat |
| **File never uploaded** | A job points at a file that did not finish uploading | Submission accepts only confirmed, scanned files, and the worker checks again before delivery, failing only that file's tasks with a clear reason |
| **Lost job message** | The job is saved but its queue message is never sent | A sweeper re-sends messages for jobs that never started (ADR-014) |
| **Malicious file** | Someone uploads malware disguised as a document | The Upload Events Lambda scans every upload with ClamAV; infected files are deleted and can never be sent or downloaded (ADR-016) |

#### Release 2: Operational maturity

| **Target date** | **Status** |
|---|---|
| TBD | **Planned** |

High level only. Details come after Release 1. Candidate themes:

- Admin screens for teams, binders and memberships, including signing a user out everywhere
- Richer delivery reports, with per-destination summaries and export
- Throttling tuned per client organization
- Structured logs with correlation IDs across all services
- Role-based access per binder
