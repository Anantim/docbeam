# DocBeam architecture decision records (ADRs)

## DocBeam Architecture Decision Records

| **Field** | **Value** |
|---|---|
| **Status** | **Draft** |
| **Owner** | Anantim |
| **Related** | [DocBeam Blueprint](02-blueprint.md), [DocBeam Technical Design](05-technical-design.md) |

Every record follows the same order: context, options, decision, consequences. The chosen option is highlighted in green. Consequences are listed separately so the trade-offs stay visible after the decision is made. Click an ADR number in the summary to jump to its record.

### Summary

| **ADR** | **Question** | **Answer** | **Status** |
|---|---|---|---|
| [001](#adr-001-public-api-edge) | How does API traffic reach the services? | HTTP API Gateway, VPC Link, internal ALB | **Accepted** |
| [002](#adr-002-file-transfer-path) | How do file bytes move? | Presigned POST up, presigned GET down | **Accepted** |
| [003](#adr-003-encryption-at-rest) | How are stored files encrypted? | SSE-KMS with the AWS-managed key | **Accepted** |
| [004](#adr-004-presigned-link-expiry) | How long do presigned links last? | 15 minutes up, 2 minutes down | **Accepted** |
| [005](#adr-005-queue-technology) | Which queue? | SQS standard with DLQs | **Accepted** |
| [006](#adr-006-service-split) | How many services? | Three: Auth, DocBeam API, Platform | **Accepted** |
| [007](#adr-007-live-status-to-the-browser) | How does live status reach the browser? | API Gateway WebSocket API | **Accepted** |
| [008](#adr-008-where-fan-out-happens) | Where does fan-out happen? | Job queue, then task queue | **Accepted** |
| [009](#adr-009-database-layout) | How are databases laid out? | One instance, three isolated databases | **Accepted** |
| [010](#adr-010-database-engine) | Which database engine? | PostgreSQL for all three | **Accepted** |
| [011](#adr-011-where-workers-run) | Where do workers run? | Lambda (RDS Proxy in prod; direct in dev) | **Accepted** |
| [012](#adr-012-infrastructure-as-code) | How is infrastructure defined? | Terraform | **Accepted** |
| [013](#adr-013-service-to-service-calls-and-repeat-safe-ingest) | How do services call each other? | Scoped service tokens, repeat-safe ingest | **Accepted** |
| [014](#adr-014-job-message-lost-after-commit) | What if the job message is lost after commit? | A sweeper re-sends it | **Accepted** |
| [015](#adr-015-sign-in-length-and-refresh-tokens) | How does a sign-in last a working day? | Rotating refresh token in a secure cookie | **Accepted** |
| [016](#adr-016-upload-confirmation-and-malware-scanning) | How do we know an upload is real and safe? | S3 events to a queue, plus ClamAV malware scanning in the Lambda | **Accepted** |

### ADR-001: Public API edge

**Status: Accepted**

Context. The web app calls three services (Auth, DocBeam API, Document Platform) that run as ECS tasks in a private network. Every endpoint except login, register, token refresh, sign-out and the two public-key routes must reject unauthenticated calls, and more services are likely later.

| **#** | **Option** | **Trade-offs** |
|---|---|---|
| 1 | Public ALB with one target group per service | Simplest and cheapest. No token check at the edge, no managed throttling, and the services face the internet. |
| 2 | **API Gateway (HTTP API), VPC Link, internal ALB, services** (chosen) | Tokens checked at the edge, services stay private, throttling is managed. One extra hop and a VPC Link to configure. |
| 3 | API Gateway calling services directly, no ALB | One managed edge, but loses ALB target groups and health-check routing. |

> **Decision.** Option 2, using the HTTP API type rather than the REST API type: it has a built-in JWT authorizer and VPC Link, at about a third of the cost. Login, register, token refresh, sign-out and the two public-key routes (the OpenID configuration and JWKS) skip the authorizer, since they issue, end or publish tokens. Every route is listed one by one, with no catch-all. The service token endpoint is not exposed through the gateway at all.

**Consequences**

- Two routing layers to debug: the gateway and the ALB.
- Deploy order matters: services and the ALB first, checked from inside the network, then the gateway in front. The milestones follow this order.
- The JWT authorizer reads the Auth Service's OpenID configuration when it is created, so a brand-new environment is applied twice: first without the authorizer and the protected routes (they do not exist and answer 404, never open), then with them once the Auth Service answers.
- Traffic between the VPC Link, the internal ALB and the services is plain HTTP inside the private network, with one ALB listener per service. Security groups limit who can reach it. This is an accepted risk; internal TLS needs a private certificate and is left for later.

### ADR-002: File transfer path

**Status: Accepted**

Context. Users upload up to 100 files per session (2 MB on average, 1 GB at most), and people in the receiving teams download them later. The page must stay responsive during upload, file integrity must be checkable end to end, and submission must be confirmed in under 500 ms. Encryption at rest is handled by KMS (ADR-003).

| **#** | **Option** | **Trade-offs** |
|---|---|---|
| 1 | **Presigned POST for uploads, presigned GET for downloads** (chosen) | The API scales with requests, not bandwidth. The POST policy makes S3 enforce size, type and SHA-256. Parallel uploads keep the page responsive. Costs one extra call per batch of URLs, and a link works for anyone holding it until it expires. |
| 2 | Send all bytes through the API | One place to validate, but the API must scale with bandwidth, slow 1 GB uploads hold connections open, and every byte travels twice. |
| 3 | Send uploads through the API, presign downloads | Keeps every upload problem of option 2 for little gain. |

> **Decision.** Option 1 in both directions. A link is signed only after the permission check: for uploads, the caller must own the file record; for downloads, the caller must be the sender or the file must have been delivered to one of the caller's teams. Each link covers one object, with expiry set by ADR-004. The browser declares each file's SHA-256 when it asks for the upload link, so S3 can check it on write. Files over 100 MB use S3 multipart upload with one signed link per part, each signed with that part's SHA-256; the API completes the upload itself after checking the total size.

**Consequences**

- Workers must check that the file exists and its fingerprint matches before delivery. A missing or changed file fails the task with a clear reason.
- A presigned link is usable by anyone who has it until it expires. Single-object scope and short expiry keep this small.

### ADR-003: Encryption at rest

**Status: Accepted**

Context. Stored files must be encrypted by a managed KMS, and we may not write our own cryptography. Files reach S3 straight from the browser (ADR-002), so no key can live in the browser. These are clinical documents, so control over the key matters.

| **#** | **Option** | **Trade-offs** |
|---|---|---|
| 1 | SSE-S3 (S3-managed keys) | No setup and no KMS cost, but we control no key. Weakest for compliance. |
| 2 | **SSE-KMS with the AWS-managed key (aws/s3)** (chosen) | One bucket setting, key use logged in CloudTrail, meets the requirement. The key policy cannot be changed, so anyone in the account with S3 access can decrypt. |
| 3 | SSE-KMS with a customer-managed key | We own the key policy, rotation and revocation. More setup and a per-request KMS charge. |
| 4 | SSE-C (customer-provided keys) | The key would travel with every request, so presigned links would hand raw keys to the browser. Not usable. |

> **Decision.** Option 2, with S3 Bucket Keys turned on to cut KMS request costs. The same setting applies to the Object Store and the Platform File Store.

**Consequences**

- Access control lives in IAM, bucket policies and the permission check before signing a link, not in the key.
- Moving to a customer-managed key later is one bucket setting and one key resource. The Object Store re-keys itself within 33 days through its expiry rule. The Platform File Store has no expiry, so existing documents would need a one-time copy to re-key.

### ADR-004: Presigned link expiry

**Status: Accepted**

Context. A presigned link needs no further checks until it expires, so expiry is the main control on exposure. Upload links must survive a slow 1 GB transfer; download links are clicked at once. S3 checks the signature when a transfer starts, so a transfer that starts in time finishes even if the link expires midway.

| **#** | **Option** | **Trade-offs** |
|---|---|---|
| 1 | Long expiry both ways (about 12 hours) | Fewest link requests, but a leaked link is usable for hours. |
| 2 | **15 minutes for uploads, 2 minutes for downloads** (chosen) | Exposure is minutes. 15 minutes covers a 100-file batch started in waves. An interrupted session needs one fresh request. |
| 3 | Under 1 minute both ways | Least exposure, but the browser cannot start 100 uploads in time, so links are constantly re-issued. |

> **Decision.** Option 2. Both values are configuration and can change without redesign. Every link covers one object and one operation, so expiry is the second safeguard, not the only one.

**Consequences**

- The browser asks for upload links in waves of at most 20.
- For multipart uploads, links can be re-signed for parts not yet started, so a slow 1 GB upload is never stranded.
- Download links are used once in practice.

### ADR-005: Queue technology

**Status: Accepted**

Context. One submission becomes up to 2,000 independent tasks, and the system handles about 90,000 deliveries a day. Each task needs at least 3 attempts, full independence from other tasks, and no silent loss.

| **#** | **Option** | **Trade-offs** |
|---|---|---|
| 1 | **Amazon SQS standard queues with DLQs** (chosen) | Fully managed and absorbs spikes without tuning. Visibility timeout, maxReceiveCount and a DLQ give the retries and no-loss guarantee directly. Delivers at least once, so workers must ignore repeats. |
| 2 | RabbitMQ (self-run or Amazon MQ) | Richer routing, but a broker to size, patch and watch, and retries set up by hand. |
| 3 | Kafka (Amazon MSK) | Huge headroom and replay, but one slow task blocks its partition. Too heavy for 90,000 a day. |
| 4 | PostgreSQL as a queue | No new infrastructure, but delivery load lands on the main database and retries become our own code. |

> **Decision.** Option 1. SQS features map one to one onto the requirements. FIFO queues were rejected: order does not matter, and FIFO limits throughput. A delivery gets up to 5 attempts (maxReceiveCount 5), above the required 3; the job message keeps 3. The worker sets each gap itself with ChangeMessageVisibility, chosen from the message's receive count (30 seconds, then 2, 5 and 10 minutes), so a blip is retried at once and a platform outage of up to about 17 minutes heals by itself. The visibility timeout (6 times the Lambda timeout) only covers a crashed worker; five crashes in a row take about 1 hour to reach the DLQ. Every queue keeps messages for 14 days.

**Consequences**

- Workers and the platform must both handle repeat deliveries safely (ADR-013).
- A DLQ holds failed messages but tells no user. A DLQ Consumer Lambda marks those tasks failed with a reason, which is what makes failures visible on the dashboard.
- Local development uses LocalStack for SQS.

### ADR-006: Service split

**Status: Accepted**

Context. About 2,000 users and 200 at a time. Delivery workers call the platform over HTTP however the code is packaged, so at least one real service boundary exists anyway.

| **#** | **Option** | **Trade-offs** |
|---|---|---|
| 1 | One deployable with three modules | Simplest to run, but boundaries are only convention, and one bad platform deploy takes login down. |
| 2 | **Three services: Auth, DocBeam API, Document Platform** (chosen) | Each owns its data with its own credentials, deploys and fails on its own, and password handling sits in one small service. Three pipelines to run, and membership checks become network calls. |
| 3 | Two services, with auth inside DocBeam API | Keeps the platform boundary, but mixes password handling into the busiest service. |

> **Decision.** Option 2. The platform boundary is forced by the requirements, and the auth boundary costs little and keeps password handling isolated.

**Consequences**

- Permission checks are service calls, and the platform sits on the 1-second browse path.
- If the platform is down, submission checks fail. The failure modes are covered in the TDD.
- Auth Service and Document Platform are basic builds; their scope is in the TDD.
- Calls between services need their own authentication (ADR-013).

### ADR-007: Live status to the browser

**Status: Accepted**

Context. A job's tasks finish over seconds to minutes, and the dashboard must update by itself. It is the main screen of the product, so update speed is visible quality. About 200 users at a time, each usually watching one job.

| **#** | **Option** | **Trade-offs** |
|---|---|---|
| 1 | Polling every 2 to 3 seconds | Simplest, uses existing endpoints, about 70 requests a second at peak. The dashboard updates in steps, and most requests return nothing new. |
| 2 | Server-Sent Events | Fits one-way updates, but the HTTP API buffers responses and cuts connections at 30 seconds. Would need a second public entry point. |
| 3 | **API Gateway WebSocket API** (chosen) | Managed persistent connections, services stay private, real push. Needs a table of connections and handlers to maintain it. |

> **Decision.** Option 3. All three would work at this scale; real-time push and consistency with ADR-001 decide it.

**Consequences**

- A ws_connections table records which connection watches which job, because the WebSocket API has no built-in subscriptions.
- Each connection record keeps the user token's expiry and the viewer's teams. Nothing is pushed to an expired connection, and an update about a delivery goes only to the sender and to viewers in that delivery's team. Someone removed from a team therefore stops getting updates within 15 minutes, when the page must reconnect and is checked again.
- WS Handler Lambdas run on connect, subscribe and disconnect to keep that table accurate. Subscribe applies the same visibility rule as reading a job, and answers on the connection (subscribed, or not found), so the page knows when it may fetch.
- The browser subscribes before fetching a job's tasks, and refetches after every reconnect, so no update is missed.
- A second API Gateway to configure and monitor.
- The WS Handlers have reserved concurrency 3 to fit the dev connection budget. A burst beyond that is throttled, and the page retries, or fetches without the live connection.
- The WebSocket stage keeps no access log, because that needs an account-wide CloudWatch role; the handler's own logs are used instead.

### ADR-008: Where fan-out happens

**Status: Accepted**

Context. A submission creates up to 2,000 tasks and must be confirmed in under 500 ms. Inserting the rows is one fast transaction. Sending the messages is not: SQS takes at most 10 per call, so a full job is about 200 calls, which takes seconds.

| **#** | **Option** | **Trade-offs** |
|---|---|---|
| 1 | **Two queues: one message per job, then one per task** (chosen) | Submission does the same small amount of work whatever the batch size. If fan-out crashes, SQS redelivers the job message. Each queue gets settings and a DLQ sized for its own work. One more queue to run. |
| 2 | One shared queue for both message types | Same crash safety, but one set of settings for two workloads, and job messages wait behind delivery bursts. |
| 3 | No job queue: the API sends every task message itself | Simplest, but breaks the 500 ms target, and a crash halfway leaves tasks with nothing to retry them. |

> **Decision.** Option 1. Submission writes the job and all task rows in one transaction, sends one job message and returns. The Fan-out Lambda reads the job's pending task IDs and sends one message per task. Because the task rows already exist, the dashboard shows every task as pending the moment the job is accepted, and fan-out is safe to repeat.

**Consequences**

- If fan-out runs twice, a repeated message for a task that already finished stops at the delivery claim, and a repeat for an open task is stored once by source_task_id.
- A job message that fails 3 times lands in the Job DLQ; the DLQ Consumer marks that job's pending tasks failed with FANOUT_FAILED.
- Retry failed deliveries reuses this path: the API sets the chosen tasks back to pending and sends one job message, and fan-out queues them like any other pending task.
- The job message is sent after the transaction commits. If sending fails, the job could sit in pending; ADR-014 covers this.

### ADR-009: Database layout

**Status: Accepted**

Context. Three services with clear ownership: Auth (users, credentials), Platform (teams, memberships, binders, folders, documents), DocBeam (files, jobs, tasks). The goal is real service ownership. The load (2,000 users, 90,000 tasks a day) fits one small instance.

| **#** | **Option** | **Trade-offs** |
|---|---|---|
| 1 | One instance, one schema, everyone connects | Cheapest, but the first cross-service join couples the services for good. |
| 2 | **One instance, three databases with separate credentials** (chosen) | Each service can open only its own database, so cross-service joins are impossible. One instance to run. Moving a database to its own instance later is a connection-string change. |
| 3 | Three separate instances | Strongest isolation, but three of everything for a load that fits in one. |

> **Decision.** Option 2: Auth DB, DocBeam DB and Platform DB, each reachable only with its owning service's credentials.

**Consequences**

- DocBeam checks destination access by calling the platform's API with a service token (ADR-013), never by reading membership tables.
- The three databases share one instance and fail together; Multi-AZ keeps a standby in a second zone that takes over in 1 to 2 minutes. If load ever becomes a problem, one database moves to its own instance without schema changes.

### ADR-010: Database engine

**Status: Accepted**

Context. Each database could use a different engine. Auth stores a small set of users. Platform stores a nested folder tree, memberships and documents. DocBeam inserts a job and up to 2,000 tasks at once and runs dashboard queries that count tasks per job.

| **#** | **Option** | **Trade-offs** |
|---|---|---|
| 1 | **PostgreSQL for all three** (chosen) | Every workload fits. Nested folders work as a parent-ID list read one level at a time. A job and its tasks insert in one transaction. Counting is one indexed query. One engine to run. |
| 2 | DynamoDB for jobs and tasks | Near-unlimited writes, but a job with 2,000 tasks exceeds its 100-item transaction limit, so accepting a job stops being one atomic step. |
| 3 | A document database for the folder tree | Nested data feels natural, but moving folders and checking access get harder, and it adds a second engine. |

> **Decision.** Option 1. Every workload is well within what PostgreSQL handles; each alternative gives up something we need.

**Consequences**

- No file bytes in any database. Uploaded files live in the Object Store and delivered documents in the Platform File Store; PostgreSQL holds only metadata, fingerprints and storage keys.

### ADR-011: Where workers run

**Status: Accepted**

Context. Workers read SQS messages. Fan-out sends task messages; delivery fetches a file, checks it, delivers it, records the result and pushes an update. About 90,000 tasks a day in bursts of up to 2,000, files 2 MB on average and 1 GB at most.

| **#** | **Option** | **Trade-offs** |
|---|---|---|
| 1 | **Lambda triggered by SQS** (chosen) | Scales to zero between bursts and per message with no autoscaling setup; retries and DLQs are built in. A 15-minute limit per run, cold starts, and many parallel runs can exhaust database connections without RDS Proxy. |
| 2 | ECS Fargate polling SQS | No time limit and steady connection pools, but always-on cost for bursty work, and queue-based autoscaling built by hand. |
| 3 | EC2 auto-scaling group | Cheapest under constant heavy load, which this is not. Slowest to scale, and servers to patch. |

> **Decision.** Option 1. Four queue-driven functions: Fan-out (Job Queue), Delivery (Task Queue), Upload Events (Upload Events Queue) and the DLQ Consumer (all three DLQs). Plus small WS Handlers for connect, subscribe and disconnect.

**Consequences**

- Every Lambda reaches PostgreSQL through RDS Proxy in prod. The AWS Free plan blocks RDS Proxy, so in dev each Lambda copy connects to the instance directly with at most one connection; the worst case (79 of 100 connections) is checked by a unit test. This build is shown on dev only and stays on the Free plan, so M5 also runs without the proxy; prod keeps it in its Terraform. The ECS services keep direct connections with their own small pools.
- The Delivery Lambda gets 1,024 MB of memory and a 120-second timeout, and streams the file, so even a 1 GB file finishes in well under a minute. Its call to the platform has its own 100-second limit, so a slow platform is a normal temporary error with backoff.
- The Task Queue trigger caps Delivery at 50 runs at a time (maximum concurrency on the event source mapping, set in Terraform), so a burst cannot drain the proxy pool (or, in dev, the instance's connections). This is used instead of reserved concurrency, because messages throttled by reserved concurrency would use up their attempts.
- Capping the number of deliveries does not cap the platform's load. On dev, 50 deliveries of 120 MB files at once ran the 0.5 GB platform out of memory. The platform stand-in therefore takes at most 6 files at once and answers 503 PLATFORM_BUSY after 30 seconds of waiting, which Delivery retries like any temporary error. The real platform's capacity is for the client to confirm.

### ADR-012: Infrastructure as code

**Status: Accepted**

Context. Every AWS resource must be defined in code: VPC, RDS, RDS Proxy, ECS, SQS, S3, KMS, CloudFront, API Gateway, Lambda and Secrets Manager.

| **#** | **Option** | **Trade-offs** |
|---|---|---|
| 1 | **Terraform** (chosen) | The industry default. Each block maps to one real AWS resource, state is visible, and drift is detected. A second language next to TypeScript, and the state store must be created once by hand. |
| 2 | AWS CDK (TypeScript) | Same language as the app, but its constructs hide the resources they create, and deploys go through slower CloudFormation. |
| 3 | Raw CloudFormation | No extra tools, but slow feedback and painful rollbacks. |

> **Decision.** Terraform. Plan and apply make us read every change, and the one-to-one mapping keeps AWS itself visible.

**Consequences**

- One resource is created by hand: the state store (one versioned, encrypted S3 bucket; Terraform locks the state with a lock file in that bucket, so no DynamoDB table is needed), made by a script in bootstrap/ so even that step can be repeated. Setting up the GitHub deploy user, its keys and the repository variables is the other manual step, done once.

### ADR-013: Service-to-service calls and repeat-safe ingest

**Status: Accepted**

Context. The Delivery Lambda, DocBeam API, WS Handlers and the seed script call internal routes on the Document Platform and Auth Service: the membership check, file ingest and the user lookup. Queue messages carry only a task ID, and no user token. The platform must know which service is calling and on whose behalf, and ingest must be safe to repeat because SQS delivers at least once.

| **#** | **Option** | **Trade-offs** |
|---|---|---|
| 1 | Pass the user's token through the queue | User tokens expire in 15 minutes, long before a backlog drains, and tokens in queues can leak. |
| 2 | Trust the network: internal routes have no auth | Simplest, but anything inside the network could ingest anything, with no record of who called. |
| 3 | **Service tokens from the Auth Service, scoped per caller, with the user ID sent as onBehalfOf** (chosen) | Reuses the existing signing keys and checks. Each caller gets only the scopes it needs. Needs a token endpoint and one secret per caller. |
| 4 | AWS IAM request signing between services | No shared secrets, but the internal ALB cannot verify it, so each service needs custom checks. |

> **Decision.** Option 3. Clients and scopes: delivery-worker (documents:ingest), docbeam-api (memberships:read), ws-handlers (memberships:read), seed-script (users:read). Service tokens last 15 minutes. The DocBeam API gets one at startup and renews it in the background; the Lambdas get one on a cold start and renew it before it expires, so almost no request waits for one. Every token says whether it is a user or a service token (token_use), so neither can be used in place of the other. Ingest carries taskId and onBehalfOf; the platform re-checks the user's membership at that moment, and a unique source_task_id stores each task's document once and returns the existing one on a repeat.

**Consequences**

- The Auth Service is on the path only when a cached token needs refreshing, so short outages do not stop deliveries.
- Client secrets live in Secrets Manager and can be rotated without code changes.
- A user removed from a team between submission and delivery gets a 403 at ingest, and the task fails with NOT_AUTHORIZED_AT_DELIVERY.

### ADR-014: Job message lost after commit

**Status: Accepted**

Context. ADR-008 commits the job and its tasks, then sends one job message. If sending fails, or the API crashes between the two, the job exists with every task pending and nothing will start fan-out. That breaks the no-silent-loss rule. The fix must not slow down submission.

| **#** | **Option** | **Trade-offs** |
|---|---|---|
| 1 | Client retries with the same Idempotency-Key | Covers an error the API reports, but not a crash after commit or a client that gives up. |
| 2 | Transactional outbox | Guaranteed: an outbox row is written in the same transaction and relayed to SQS. Adds a table and a relay process. |
| 3 | **Sweeper: a scheduled Lambda re-sends messages for jobs that never started** (chosen) | Simple, and nothing new on the submission path. Repeated job messages are harmless because fan-out is safe to repeat. |
| 4 | Send the message before committing | Moves the problem: a message could point at a job that never saved. |

> **Decision.** Option 3, keeping the immediate send in the request. Submission and each retry set jobs.queued_at, and fan-out sets jobs.fanned_out_at when it starts. A Sweeper Lambda runs every minute and re-sends the message for any job not yet fanned out and not finished 2 minutes after it was queued. Once a day, the same Lambda deletes uploaded files still not submitted 24 hours after upload; submission refuses files that old, so a file is never deleted while a job is claiming it.

**Consequences**

- In the rare failure case, fan-out starts up to about 3 minutes late, but it always starts.
- Two new columns (jobs.queued_at and jobs.fanned_out_at), a partial index for the sweeper's query, and one scheduled Lambda, shown in the architecture diagram's Async zone.

### ADR-015: Sign-in length and refresh tokens

**Status: Accepted**

Context. A user access token lasts 15 minutes. Without a way to renew it, people would be asked for their password every 15 minutes, in the middle of choosing destinations or watching a job. Making the access token last longer is not safe: a token cannot be cancelled before it expires, so a stolen one keeps working, and signing out would only clear the browser. A working day needs one sign-in, and signing out must end the sign-in on the server.

| **#** | **Option** | **Trade-offs** |
|---|---|---|
| 1 | Ask for the password every 15 minutes | Simple and safe, but it interrupts people all day, often in the middle of a task. |
| 2 | One access token that lasts 12 hours | Nothing new to build, but a stolen token works for hours and signing out cannot cancel it. |
| 3 | **Short access token plus a refresh token in a secure cookie, replaced on every use** (chosen) | Access tokens stay at 15 minutes. Page scripts cannot read the cookie, each refresh token works once, and a reused one shows it was stolen. Adds one table and two routes. |
| 4 | Refresh token kept in localStorage | Same flow as 3, but any script that gets into the page could read the token and take over the sign-in for 12 hours. |

> **Decision.** Option 3. Login returns the 15-minute access token in the body and a refresh token in a Secure, HttpOnly, SameSite=Strict cookie that is sent only to /api/auth (through CloudFront). The refresh token is a long random value. Auth DB keeps only its SHA-256 in refresh_tokens, with a family_id for the sign-in and an expiry 12 hours after sign-in. POST /auth/refresh swaps a valid token for a new access token and a new refresh token with the same family and expiry, and marks the old one used. If a used token comes back, every token in that family is revoked, so both the thief and the real user are signed out. POST /auth/logout revokes the family. The web app refreshes a minute before the access token expires; a browser lock (Web Locks API) lets only one tab refresh, and it shares the new token with the others. After 12 hours the refresh fails and a sign-in dialog keeps the page as it is. Five wrong passwords in a row pause sign-in for that account for 15 minutes (users.failed_logins and users.locked_until), with the same 401 message, and API Gateway throttles /auth/login and /auth/refresh tightly (5 requests a second, burst 10).

**Consequences**

- People sign in once per working day, and a stolen access token works for at most 15 minutes.
- A stolen refresh token is caught the first time both copies are used, and that sign-in ends for both.
- The web app and the API must share one site so the cookie can be SameSite=Strict. CloudFront serves the web app and forwards /api/* to API Gateway, so the browser sees one site without a custom domain, and the cookie is limited to /api/auth. A custom domain can be added to CloudFront later without other changes.
- Someone guessing passwords can keep an account paused. The pause is short and ending it early is a support script in v1.
- Every failure gets the same message and takes about the same time (an unknown email is compared against a dummy hash), so the sign-in page shows neither which accounts exist nor which are paused. Hashing is slow by design, so the Auth Service gets 0.5 vCPU and compares the password before it opens its short database transaction.

### ADR-016: Upload confirmation and malware scanning

**Status: Accepted**

Context. The browser uploads straight to the Object Store with a signed form or signed parts, so the DocBeam API never sees the file. Before a file is sent, DocBeam must know it really arrived with the declared size and fingerprint, and that it carries no malware, because it will land in other teams' binders. Checking each file inside the submit request would break the 500 ms target, and trusting the browser leaves a gap.

| **#** | **Option** | **Trade-offs** |
|---|---|---|
| 1 | Trust the browser and check each file only at delivery | Nothing new to build, but a missing or infected file is found only after the job has started, once per delivery. |
| 2 | Check every file in S3 during submit | Up to 100 calls inside the request break the 500 ms target, and it still does not scan for malware. |
| 3 | **S3 upload events on a queue, handled by a Lambda that confirms each file and scans it with ClamAV** (chosen) | Each file is confirmed and scanned in the background, seconds after upload (a few minutes for a 1 GB file). Works on the AWS Free plan. We keep the virus definitions current with a daily image rebuild. Adds a queue, its DLQ and one Lambda. |
| 4 | GuardDuty Malware Protection for S3 scans each file and sends its result through EventBridge | Managed by AWS, with no definitions to keep current, but not offered on the AWS Free plan this project runs on. Can replace the scanner once the account is on the Paid plan with advanced features turned on; the queue, the database updates and the bucket policy stay the same. |

> **Decision.** Option 3. The Object Store sends an event for every new object under staging/ to the Upload Events Queue (up to 5 tries, then the Upload DLQ). The Upload Events Lambda, a container image with the ClamAV scanner, reads the stored object's size and checksum, checks them against the file row, then scans the file. If it is clean, the Lambda tags the object scan-status=clean and sets files.uploaded_at and files.scan_status (clean) in one conditional update, so a repeated event changes nothing. It also works out the file's SHA-256 while it scans and compares it with the declared one, which covers a multipart file (S3 reports only a combined checksum for one). If the size or checksum differs, it deletes the object, sets scan_status to failed and writes a file.refused audit event with reason MISMATCH. If a threat is found, it deletes the object, sets scan_status to infected and writes file.refused with reason MALWARE. The event has no actor and names the owner, so only the owner sees it. The bucket policy refuses to hand out any object not tagged scan-status=clean to every role except the Upload Events role, which must read a file before it is tagged, so no bug can send or share an unscanned file. Submit refuses a file that is not confirmed and clean with 422 FILE_NOT_READY. The browser calls GET /files?ids= every 2 seconds while any file is being checked. If a file's events end in the Upload DLQ, the DLQ Consumer marks it failed and writes file.refused with reason SCAN_FAILED. Locally, Compose runs the official ClamAV image, so the EICAR test file is refused for real. GuardDuty (option 4) was the first choice, but the AWS Free plan does not offer it.

**Consequences**

- Nothing unscanned or unconfirmed can be submitted, delivered or downloaded.
- A file takes a few seconds after upload before it can be submitted; the page shows Checking until then.
- We keep the scanner current ourselves: a scheduled workflow rebuilds the image every day with the latest virus definitions. Scanning runs well inside the Lambda free allowance at v1 volumes, and a 1 GB file stays Checking for a few minutes. The scan limits are 1,100 MB, and a file over a limit is reported as found, so nothing is skipped and called clean.
- One more queue, DLQ, Lambda and alarm, shown in the architecture diagram's Async zone.
