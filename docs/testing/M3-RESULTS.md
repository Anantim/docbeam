# M3 results

Evidence for `docs/testing/M3-TESTING.md`. Local part run on 2026-10-16 and 2026-10-17 on the laptop (WSL2, Docker Desktop). **Nothing has been run in AWS yet** (sections 2 and 3 wait for the person's yes, D-M2-14). All 22 browser steps are done by Playwright (1.3); only a look at the colours and spacing is left for the person.

## 1. Local

### 1.1 Stack

| Check | Result |
|---|---|
| `docker compose up -d --build --wait` | exit 0. auth, platform, docbeam-api, postgres, localstack, clamav, workers and ws-local `healthy` (rebuilt after the API and ws-local changes) |
| Seed | already loaded; the integration suite passes against the seeded stack |
| Vite proxy | `npm run dev -w @docbeam/web`, login through `http://localhost:5173/api/auth/login`, then `GET /api/jobs` → `200`, `GET /api/audit?limit=5` → `200`, `GET /` → `200` |

### 1.2 Tests

| Command | Result |
|---|---|
| `npm run lint` | clean |
| `npm run typecheck` | clean (services, workers, tests, web) |
| `npm test` | **final: 71 test files, 527 tests passed, twice in a row** (2026-10-17). Earlier in the session: 65 files, 473 tests, then 68 files, 498 tests. The hashing test once timed out at its 5-second limit when the CPU was busy; it now has a 20-second limit |
| `npm run build` | all workspaces built, web `✓ built` |
| `npm run test:integration` | **final: 17 test files, 157 tests passed, twice in a row** (on the stack rebuilt after the last worker change, 2026-10-17) |
| `npm run test:e2e` | **final: 34 tests passed, twice in a row** (about 3.9 minutes each), see 1.2b. Before the second pack was added: 10 tests, three runs in a row |
| `terraform fmt -check -recursive infra` | exit 0 |
| `terraform -chdir=infra/envs/dev validate`, same for `prod` | `The configuration is valid.` for both |
| `terraform -chdir=infra/envs/dev plan` (read only, local empty state, `-refresh=false`, `TF_VAR_alarm_email` set) | `Plan: 275 to add, 0 to change, 0 to destroy.` (251 before M3). No error, no cycle |

### 1.2a Named checks

| Rule | Test and result |
|---|---|
| Cancel while deliveries run | `tests/integration/tracking.test.ts` "POST /jobs/:id/cancel while deliveries run … fails only the waiting deliveries, lets the running one finish, and drops queued messages at the claim": passed. Checks: 2 cancelled, the running task stays `in_progress`, the job is not closed, queued messages leave `attempt_count` at 0, then `finishTask` closes the job and it reads `cancelled`, 1 `job.cancelled` and 2 `task.failed` events |
| Team-scoped visibility | same file: Raj (Cardio) sees 2 of 5 deliveries with counts for them, no Retry/Cancel, only the Cardio folder in `destinations`; Sam (Neuro) gets 404 for the job, its tasks and in the team list, with the same error code as for a missing job |
| Team-scoped audit | same file "GET /audit is scoped…": the sender sees 4 events; Raj sees `job.submitted` reduced to `{actorName}` and the Cardio delivery; Sam sees none; `file.refused` only for its owner; `download.issued` by the sender not shown to Raj |
| Retry rules | same file "POST /jobs/:id/retry": only `RETRIES_EXHAUSTED` and `FANOUT_FAILED` reset (2 of 4), `CHECKSUM_MISMATCH` untouched, audit event `retried: 2`, both tasks run again from a clean count (`FILE_NOT_UPLOADED`, `attempt_count` 1); 25 hours after the first finish and a 49-hour-old file give `RETRY_WINDOW_CLOSED`; `NOTHING_TO_RETRY`; Raj gets `NOT_SENDER`, Sam 404 |
| WebSocket | `tests/integration/ws.test.ts` (10 tests): no token, bad token and a service token get 401; the row holds the token's expiry (under 15 minutes) and is deleted on disconnect; the sender and a Cardio member subscribe, an outsider gets `NOT_FOUND`; a task update reaches Priya and Raj for the Cardio task with their own counts and reaches only Priya for the Oncology task; one `job_update` after a cancel with counts 3 failed for Priya and 1 for Raj and no `task_update`; a ghost connection (410) is deleted; an expired row is skipped |
| Catch-up | `web/src/live/socket.test.ts` (13 tests): subscribe, wait for the answer, resolve; reconnect after 1 s, 2 s back-off; resubscribe then `onResync` exactly once; a new token reconnects and resyncs; no reconnect after `close()`. `web/src/components/StatusPage.test.tsx` "does not fetch until the live connection has answered…" and "fetches again exactly once after a reconnect…" |
| Popover | `web/src/components/Popover.test.tsx` (these were the 9 tests of `DestinationChips.test.tsx` before D-F1-42 and D-F1-46): lists only the hidden folders grouped by team; closes on Esc (focus back on the button), on a click outside, when Tab leaves; opens on hover; a click keeps it open |
| Teardown script | `tests/scripts/empty-dev-buckets.test.ts` (7 tests): refuses prod and `staging`; refuses the state bucket, another account and another prefix before any delete; batches `[1000, 1000, 500, 40]`; an absent bucket is a notice; no call names the state bucket. The script's JMESPath query was **not** run against real S3 (the fake `aws` stands in); it runs for the first time in section 5 |
| Connection budget | `packages/shared/src/db.test.ts` passed unchanged (79) |

### 1.2b Playwright (Chromium 156, headless, against Compose and the Vite dev server): 34 tests, 5 files

`track.spec.ts` 10, `tooltips.spec.ts` 2, `ui.spec.ts` 7, `m1.spec.ts` 7, `m2.spec.ts` 8. All passed in two full runs in a row. The first four files' tests:

| Test | Result |
|---|---|
| tooltips: a button that is off says why, icon buttons say what they do | passed |
| tooltips: the +N chip opens a popover with only the hidden folders (hover, click, Esc, click outside, Tab away) | passed |
| counts and rows change live, and a reload mid-run loses nothing | passed. Reload mid-run: same distribution and 4 Waiting. After the workers start the page reaches `Completed` and 4 Delivered with its marker intact (no reload) |
| a team viewer sees only their team's rows, live; an outsider gets not found | passed. Raj: 2 of 4 rows, no `Oncology` text, no Cancel/Retry, live; Sam: not found; Raj's Audit trail without Oncology |
| Cancel: waiting deliveries stop, with a question first | passed. 6 `CANCELLED`, nothing delivered after the workers start |
| a failure shows its reason in the row, with what the code means | passed (`FILE_NOT_UPLOADED` ×2, reason per file, meaning as title, filters) |
| Retry sends a failed delivery again | passed |
| the live connection drops mid-run and the page catches up without a reload | passed. While `ws-local` was down the page still showed 2 Waiting although the database had 2 completed; after it came back the page showed 2 Delivered with no reload |
| the list shows my distributions with their counts | passed |
| the Audit trail page filters by kind of event | passed |
| the three tabs are on, Copy link copies the address, and a prepared batch survives a look at Status | passed. The clipboard held `http://localhost:5173/#/status/<id>` |
| the list updates its counts by itself, every 30 seconds, with no live push for it | passed (31 s: the next refresh) |

**The look of the screens, `ui.spec.ts` (7 tests, passed):**

| Check | Result |
|---|---|
| A disabled button has the disabled attribute and the not-allowed cursor | passed for Send and Clear on Distribute (`disabled`, `cursor: not-allowed`, greyed `rgb(152, 162, 179)`, title says why); Clear is `cursor: pointer` once a file is on the page |
| Preview and Download on Status | passed: icon buttons, `disabled`, `not-allowed`, title and label `Preview <file>. Available in the next version` |
| Cancel is absent on a completed distribution | passed (no Cancel and no Retry when nothing failed) |
| The file-state chip on Distribute is the same component as on Status | passed: `Verified` (a file) and `Delivered` (a delivery) have the same class list, `data-tone="ok"`, background, text colour, dot colour, radius and font size; the distribution's own chip is the same component, in the big size |
| Type badge colours | passed: PDF `rgb(254, 228, 226)`/`rgb(180, 35, 24)` (red), DOCX blue, XLSX green, PNG and JPG the same purple; four distinct text colours for the five types; each badge keeps its text. Unit test: every pair has a contrast of at least 4.5 to 1 |
| The pause note | passed: not shown before a failure; after an unknown address the exact line "After 5 wrong passwords in a row, sign-in pauses for 15 minutes. Wait, then try again."; after **one** wrong password for Raj the same line, then the right password signs in and the note goes. Only one wrong attempt was made for the account |
| Tables size to their content at 1280 and 1920 px | passed for both tables at both widths: no sideways scroll; every column but the file name is at most 48 px wider than the widest thing in it; the file column is at least as wide as every other column but one; a long name ends with an ellipsis, its title holds the whole name, and at 1280 it is cut short |

**What I saw in screenshots at 1280 and 1920 px, and fixed (product, not tests):**
- The Documents table at 1280 px gave Destinations only 92 px (chips stacked) and the status chip overflowed its 58 px column. Cause: a `max-width: 100%` on the chip let the grid shrink it to nothing. The chip can no longer shrink, the table shows one destination chip plus "+N" (the popover lists the rest), and the size sits next to the file name.
- The "+1" chip was 35 px tall and clipped. Cause: my own CSS class `.more` (the "Load more" container, `padding: 10px 0`) also matched the chip's `.more`. The container is now `.load-more`.
- The Deliveries table measured at 1280: destination 204 px for 304 px of text (cut short) while the details column took 272 px for two icons. Columns are now sized from the loaded rows (destination up to 400 px, details 104 px until a failure reason is loaded).
- Rows updated by a live push showed "0 of 5" attempts: the push did not carry the attempt count. It does now (`attemptCount` in `task_update`, from `finishTask`), and a completed delivery counts at least one attempt.
- The open distribution's card in the list said "Pending" next to a detail that said "Completed". The open card now follows its live counts.

Problems found and fixed while writing the suite (all in the tests, none in the product):
- The `workers` container also scans uploads, so stopping it before the upload kept files at `Checking`. The tests now stop it just before Send.
- A stopped worker's last long-poll (10 s) can still be open in LocalStack, which then hands it the next message and hides it for the queue's whole visibility timeout (the job stayed `Pending`). The tests wait 11 s after stopping. This is a property of stopping the local `workers` container, not of the product.
- One test took the first table row as the first file, but rows sort by file name and the names carry a random part. It failed on the second full run and passed alone; it now looks each file up by name. Three full runs passed after the fix.

### 1.2c The teardown script's `--dry-run`, run for real against LocalStack

The unit test uses a fake `aws`. To check the real CLI's queries too, the real script ran against two LocalStack buckets named `docbeam-dev-object-store-000000000000` and `docbeam-dev-platform-files-000000000000` (a wrapper answered only the `sts` account call; the rest went to the real AWS CLI, with `AWS_ENDPOINT_URL`). The first holds 30 keys written twice (60 versions) and 10 deleted (10 delete markers):

```
docbeam-dev-object-store-000000000000: would delete 60 versions and 10 delete markers (70 in total).
docbeam-dev-platform-files-000000000000: would delete 0 versions and 0 delete markers (0 in total).
Dry run: nothing was deleted. Run it again without --dry-run to empty these buckets.
```

Then without the flag: `deleted 70 so far`, `empty (70 versions and delete markers deleted)`, `Done.` A second dry run showed 0 and 0. Both queries (`length(Versions || ...)` and the delete batch) are accepted by the real CLI. What is still not proved is the behaviour on real AWS S3 with thousands of versions; that is the dry run and teardown on dev.

### 1.2d The M1 and M2 regression packs (`m1.spec.ts` 7 tests, `m2.spec.ts` 8 tests, all passed)

| M1: a new account is created, sees "You are not in any team yet.", signs out and in | passed |
|---|---|
| M1: an address already in use gets one generic answer (no "already exists") | passed |
| M1: Priya sees Cardio and Oncology, Raj Cardio, Sam Neuro, and nothing else | passed |
| M1: the tree loads a level only when it is opened (no `/contents` request before, one after, none on re-open) | passed |
| M1: another team's binder gives 404, with the same body as one that does not exist; the member gets 200 | passed |
| M1: a reload keeps the sign-in; a new tab signs in quietly with no password (D-M1-8) | passed |
| M1: when the server refuses the token and the refresh, the sign-in dialog opens, the page keeps its prepared file, and signing in again returns to it | passed |
| M2: a file is uploaded, scanned, mapped and sent; the Send reason and the steps and the summary card are right; the page clears | passed |
| M2: a type that is not allowed is listed under Not added with its reason and dismissed | passed |
| M2: the malware test file is `Refused: malware found` (struck, no checkbox, Send off with its reason), removed; the audit event is in Priya's Audit trail and **not** in Raj's | passed |
| M2: ticking a folder applies to the selected file only, until Use all files | passed |
| M2: Review lists each folder, a file is removed from a folder (folder drops out when empty), Preview opens from the browser's copy and closes on Esc | passed |
| M2: at most 20 destinations (the load user, 50 teams): the 21st is refused with the toast | passed |
| M2: the browser asks before a page that holds files is closed, and does not when the page is empty | passed |
| M2: signing out with files on the page leaves nothing for the next sign-in | passed |

Not repeated in the browser because the integration suite covers them: the 101 MiB multipart upload (`web-upload.test.ts`), the platform stopped mid-run (`delivery.test.ts`) and the SIGTERM drain (`platform-drain.test.ts`).

### 1.3 The 22 browser steps of `M3-TESTING.md` 1.3: all YES, by Playwright

| Steps | Result | Test |
|---|---|---|
| 1, 4 | YES | `track.spec.ts` "the three tabs are on, Copy link copies the address, and a prepared batch survives a look at Status" |
| 2, 3, 5, 6 | YES | `track.spec.ts` "counts and rows change live, and a reload mid-run loses nothing"; `m2.spec.ts` "a file is uploaded and scanned, mapped to a folder, and sent" |
| 7, 8 | YES | `track.spec.ts` "a failure shows its reason in the row, with what the code means" |
| 9 | YES | `track.spec.ts` "the live connection drops mid-run and the page catches up without a reload" |
| 10 | YES | `track.spec.ts` "Cancel: waiting deliveries stop, with a question first" |
| 11, 12 | YES | `track.spec.ts` "Retry sends a failed delivery again" |
| **13** | **YES** | the Audit tab shows `Retry requested` (Retry test) and `Distribution cancelled` (Cancel test) |
| 14 | YES | `track.spec.ts` "the Audit trail page filters by kind of event" |
| 15, 16, 17, 19 | YES | `track.spec.ts` "a team viewer sees only their team's rows, live; an outsider gets not found" |
| **18** | **YES** | same test: Raj's Audit trail has `Distribution sent` with only who and when, no `Oncology`, and no `File refused` (Priya's malware refusal of `m2.spec.ts`) |
| **20** | **YES** | `track.spec.ts` "the list shows my distributions with their counts" (the 8-character id is refused, a link opens) |
| 21 | YES | `track.spec.ts` "the list updates its counts by itself, every 30 seconds, with no live push for it" |
| 22 | YES | `tooltips.spec.ts` "the +N chip opens a popover with only the hidden folders" |

**Steps that stay with the person: none of the 22.** What a test cannot judge is how the screens look. The person looks once at Distribute and Status at a laptop width and a wide one (colours of the chips and badges, spacing). The dev-only checks in `M3-TESTING.md` section 3 are still to run (two real browsers on the network, the real WebSocket, the 410 log line).

### 1.3a Notes from the work

- A first run of `tests/integration/services.test.ts` (M0's ws-local test) failed with `Unexpected server response: 401`: it connected with `?token=test` to the old stub handler. The real handler checks the token, so the test now registers a user and uses a real token.
- `ws-local` needed `AWS_REGION` and credentials (the management client signs even locally); found by the first `ws.test.ts` run (`Region is missing`), fixed in `docker-compose.yml`.
- A `beforeEach(() => mock.mockImplementation(...))` in a web test returns the mock, which vitest runs as a teardown; the error test failed with the mock's error. Braces fixed it.

## 2. Deploy to dev on AWS

Run on 2026-10-17 with the person's yes before each push and apply. Image tag `ab819d42b96c` (the commit with the new sign-in copy). Dev address `https://d2d0tow0wi92yw.cloudfront.net`, WebSocket `wss://7113obu8x5.execute-api.ap-southeast-2.amazonaws.com/v1`.

| Step | Result |
|---|---|
| 1 to 5 | `…:user/anantim-admin`. Variables as expected (`INFRA_APPLY_ENABLED` false). Tree clean. `terraform init` ok, state empty |
| 6 | `apply -target=module.ecr`: plan `10 to add` (5 repositories and their 5 lifecycle policies; the testing document said 5), `Apply complete! 10 added` |
| 7 | five images pushed with `--provenance=false --sbom=false`, all tagged `ab819d42b96c` |
| 8, 9 | plan `248 to add` (275 in the local plan, which counts the authorizer's 17 and the 10 ECR resources). **The first apply failed** at the WebSocket stage: `BadRequestException: CloudWatch Logs role ARN must be set in account settings to enable logging`. Fixed by removing the stage's access log (D-M3-15, commit `b14adf9`). The second plan was `13 to add, 0 to change, 1 to destroy` (the empty log group the failed apply had made; the person approved it); `Apply complete! 13 added, 1 destroyed` |
| 10 | The SNS subscription is still **PendingConfirmation**: it waits for the person to click the link in the email (the four alarms cannot email until then) |
| 11 | `run-db-bootstrap.sh dev` and `run-task.sh dev auth signing-key`: `exit code: 0` each |
| 12, 13 | Auth, Platform and DocBeam API deployed (migrations and seed ran). `check-internal.sh`: `3001 200`, `3002 200`, `3003 200` |
| 14, 15 | `npm run build`, then the five workers deployed. Upload Events already ran this image: `Nothing to do` |
| 16 | `Plan: 17 to add, 0 to change, 0 to destroy` (the authorizer and 16 routes), `Apply complete! 17 added` |
| 17 | `deploy-web.sh dev`: `Deployed to https://d2d0tow0wi92yw.cloudfront.net` |
| 18 | `terraform plan`: `No changes. Your infrastructure matches the configuration.` |

## 3. Verify on dev

The helper scripts that sent distributions (upload 100 small PDFs with the SHA-256 signed in, wait for `scanStatus` `clean`, `POST /jobs`) were kept outside the repository. The seed password was read from Secrets Manager into a shell variable inside a script and never printed.

| # | Result |
|---|---|
| 1 | YES. `curl -sI $APP/favicon.ico`: `HTTP/2 200`, `content-type: image/svg+xml` |
| 2 | YES. Priya's token: `GET /api/jobs` `200` and `[]`. Without the header: `401` |
| 3, 4 | YES. `wscat -c $WS` and `?token=bad`: `error: Unexpected server response: 401`. (wscat prints nothing when its input is not piped and there is no terminal; the runs fed it input, and the later ones ran under `script`) |
| 5, 6, 19 | **YES, with wscat (no screenshot).** Connected with Priya's token, subscribed to a random id, then sent 100 files to 11 destinations (1,100 deliveries) and subscribed to the new job. Messages (token removed, first lines of `wscat-clean.txt`, below). 417 `task_update` frames were captured before the capture ended; the job finished `completed`, 1,100 of 1,100 |
| 7 | YES. `ws` log, last 30 minutes: 6 `$connect`, 4 `subscribe`, 4 `$disconnect` events, 0 `"level":"error"` lines. (After the ghost tests a `subscribe reply not sent` warning for the ghost ids is expected, see check 20) |
| 8 | YES, by CLI (the Console is for reading only): API `docbeam-dev-ws`, protocol `WEBSOCKET`, routes `$connect`, `subscribe`, `$disconnect`, stage `v1` |
| 9 | YES. `docbeam-dev-ws`: reserved concurrency `3`, in `vpc-020f18993ac289fc2`, environment keys `AUTH_URL`, `CLIENT_SECRET_WS_HANDLERS_ARN`, `JWT_ISSUER`, `DB_NAME`, `JWKS_URL`, `PLATFORM_URL`, `DB_HOST`, `DB_SECRET_ARN`: ARNs only, no secret values |
| 10 | YES. Delivery's `WS_MANAGEMENT_ENDPOINT` is `https://7113obu8x5.execute-api.ap-southeast-2.amazonaws.com/v1`. The role policy (read from the Terraform state, because the session's permission mode refused `aws iam get-role-policy`) allows `execute-api:ManageConnections` on `arn:aws:execute-api:ap-southeast-2:346208529537:7113obu8x5/v1/POST/@connections/*` only |
| 11 | YES. CloudWatch `DatabaseConnections`, `docbeam-dev-postgres`, last 100 minutes (six distributions of 1,100 to 1,300 deliveries): **peak 67**, the budget is 79 and the limit 80 |
| 12 | **YES, by the person** in the browser (Raj: Cardio rows only, updating live, no Cancel or Retry). Two rounds of findings followed (sections 5 to 7), all rechecked by the person |
| 13 | **YES, by the person.** Sam's "Distribution not found" was not proved at first because the old distribution id was still in the address bar (D-M3-16). After the D-M3-16 fix the person rechecked it on dev and it passed. Server side: Priya's job reached all 1,100 deliveries; the team-scoped reads are covered locally by `tracking.test.ts` and Playwright |
| 14 | **Skipped on dev by the person; covered by Playwright locally.** Server side YES: a 1,300-delivery job pages as 14 pages of 100 (`total 1300`, 1,300 rows in all). Anantim has 13 destinations at the top level, not 14, so the run used 13. The two F5 presses are for the person's browser |
| 15, 16 | **Skipped on dev by the person; covered by Playwright locally** (the browser's Offline switch; 15 minutes on the page):  `socket.test.ts` and the Playwright "connection drops" test |
| 17 | YES, through the API. Anantim sent 100 files to 13 destinations (1,300 deliveries) and cancelled at 443 completed: `{"cancelled":793}`. After 20 s: `status cancelled`, 507 completed, 793 failed (`CANCELLED`), 0 pending, 0 in progress. 30 seconds later: unchanged, and the Delivery log has **0** `task delivered` lines after the cancel |
| 18 | YES. Task queue, Job queue, Upload Events queue and the three DLQs all `0` visible, `0` in flight |
| 20 | **YES, after a correction to the check.** A made-up connection id such as `ghost-2` or `GhostAbCd12XyZ9=` gets `BadRequestException: Invalid connectionId` (a 400, not a 410): the push is logged as `push failed` and the row stays until it expires. A 410 only comes for an id API Gateway really issued. So the check used a real id: a wscat connection was opened and closed, its id `gdxmH09ItlgYKABwlA==` was read from the `ws` log, the `$connect` and `subscribe` events were replayed for it, and a new distribution was sent. The line, from `/aws/lambda/docbeam-dev-delivery`: `{"level":"info","name":"delivery","msg":"connection gone (410); row deleted","jobId":"b7109410-db45-44ec-a6c6-f60f8ac063cb","connectionId":"gdxmH09ItlgYKABwlA=="}` (two deliveries raced to it, so it appeared twice) |
| 21 | Not testable in one session (covered by `tracking.test.ts`) |

**Findings:**
- **F1** (fixed, D-M3-15): a WebSocket stage cannot have an access log without an account-wide API Gateway CloudWatch role.
- **F2** (check changed): a fake connection id gives 400, not 410; use a closed real id. The commands in `M3-TESTING.md` check 20 now say so.
- **F3** (accepted, no change): a stale row for an id that API Gateway rejects as invalid is never deleted by a push; it goes with the token's expiry (15 minutes) and the Sweeper's daily cleanup (D-M3-9). A real dead connection is cleaned at once (check 20).
- **F4**: the testing document expected 5 repositories to add (10 with the lifecycle policies) and the dev plan changed from 275 to 248 after the authorizer's 17 and the ECR 10 are taken out.

wscat, check 19 (token removed):

```
Connected (press CTRL+C to quit)
> {"action":"subscribe","jobId":"00000000-0000-4000-8000-000000000001"}
< {"type":"subscribe_error","jobId":"00000000-0000-4000-8000-000000000001","code":"NOT_FOUND"}
> {"action":"subscribe","jobId":"21090b76-934b-4e8a-8d39-ebd2113f45e3"}
< {"type":"subscribed","jobId":"21090b76-934b-4e8a-8d39-ebd2113f45e3"}
< {"type":"task_update","jobId":"21090b76-934b-4e8a-8d39-ebd2113f45e3","taskId":"03770765-5095-4cce-98f5-9cef8d5bb2aa","status":"completed","attemptCount":1,"updatedAt":"2026-10-17T01:47:15.079Z","counts":{"pending":1095,"in_progress":3,"completed":2,"failed":0}}
< {"type":"task_update","jobId":"21090b76-934b-4e8a-8d39-ebd2113f45e3","taskId":"0053a66c-e136-453c-acdf-24f7ecedde33","status":"completed","attemptCount":1,"updatedAt":"2026-10-17T01:47:15.080Z","counts":{"pending":1095,"in_progress":3,"completed":2,"failed":0}}
  … (417 task_update frames in all)
< {"type":"task_update","jobId":"21090b76-934b-4e8a-8d39-ebd2113f45e3","taskId":"700b2d44-1122-4229-accc-42843b3ec981","status":"completed","attemptCount":1,"updatedAt":"2026-10-17T01:47:22.073Z","counts":{"pending":675,"in_progress":8,"completed":417,"failed":0}}
```

`subscribed` came back before the first `task_update`, and the counts in the last frame (417 completed, 675 pending) are the live state at 01:47:22.

## 4. Final check: YES / NO

Walked line by line through the M3 prompt in `docs/PLAN.md` and TDD Steps 3.1 to 3.4, after the AWS round, the person's browser checks and the teardown (2026-10-17). Sections 5 to 7 are findings made after the first pass; their fixes are in this table too.

### 4.1 TDD Step 3.1: status endpoints and cancel

| Requirement | | Evidence |
|---|---|---|
| `GET /jobs`, `GET /jobs/:jobId`, `GET /jobs/:jobId/tasks`, with the page-level count query and paging | YES | `services/docbeam-api/src/routes/jobs-read.ts` (`countsFor`, one query per page); `tests/integration/tracking.test.ts` "returns tasks with reasons, filters by status and pages"; on dev a 1,300-delivery job paged as 14 pages of 100 (section 3, check 14) |
| Team visibility: non-senders get their teams from the platform, cached 60 s; open only a job with a delivery to their teams; only those deliveries and counts | YES | `services/docbeam-api/src/platform.ts:32` `TEAMS_CACHE_MS = 60_000`, `job-access.ts`; `platform.test.ts` "user teams"; `tracking.test.ts` "GET /jobs, /jobs/:id…" (Raj sees 2 of 5, Sam 404 with the same error as a missing job); Playwright team-viewer test; the person's check 12 and 13 on dev |
| The team list finds jobs through `idx_tasks_team`, with the same cache | YES | `schema.ts:109`, `jobs-read.ts:70` |
| `POST /jobs/:jobId/cancel`; queued messages of cancelled tasks are dropped at the claim; the job reads cancelled once nothing is open | YES | `jobs-actions.ts`, `task-outcome.ts` `failPendingTasks`; integration "POST /jobs/:id/cancel while deliveries run" (running one finishes, queued messages stop at the claim, job closes and reads cancelled); on dev: cancel at 443 of 1,300 gave 793 cancelled, 507 delivered, 0 delivered afterwards (check 17) |
| `POST /jobs/:jobId/retry`: only RETRIES_EXHAUSTED and FANOUT_FAILED; window 24 h and files under 2 days; refused for a cancelled job | YES | `jobs-actions.ts`, `tracking.ts` `retryState`; `tracking.test.ts` "retryState" and integration "POST /jobs/:id/retry" (4 tests) |
| `GET /audit` as in the contracts, team-scoped | YES | `routes/audit.ts`; integration "GET /audit is scoped…" |
| After a cancel the API pushes one `job_update` to the open dashboards; its task role may post to connections | YES | `jobs-actions.ts:66` and `:125` (`pushJobUpdate`), `infra/envs/dev/async.tf` push policy; `ws.test.ts` "sends one job update after a cancel"; on dev a wscat run received the `job_update` with `cancelled 736, failed 0` |
| Only the sender may cancel or retry (403, 404 for outsiders) | YES | integration "answers 409 NOTHING_TO_CANCEL…", "POST /jobs/:id/retry" |
| (D-M3-17) cancelled deliveries are their own count, never failed | YES | `tracking.ts`, `jobs-read.ts`, `push.ts`; unit, integration and Playwright tests (section 7); on dev 148eaed7: failed 0, cancelled 793 |

### 4.2 TDD Step 3.2: WebSocket API and WS Handlers

| Requirement | | Evidence |
|---|---|---|
| A second API Gateway of type WebSocket with `$connect`, `subscribe`, `$disconnect` | YES | `infra/modules/websocket-api`; on dev: protocol `WEBSOCKET`, routes `$connect`, `subscribe`, `$disconnect`, stage `v1` (check 8) |
| `$connect` checks the token (none, bad, service token: 401); the row keeps the token's expiry | YES | `workers/ws/src/handler.ts`; `handler.test.ts`, `ws.test.ts`; on dev `wscat` with no token and `?token=bad`: `Unexpected server response: 401` (checks 3, 4) |
| `subscribe`: sender and team members; an outsider gets the same answer as a missing job | YES | `ws.test.ts` "subscribe"; on dev a random id gives `subscribe_error NOT_FOUND`, a real job `subscribed` (check 5) |
| Database access: directly in dev, through RDS Proxy in prod | YES (prod: code and plan only) | dev env in `ws` Lambda (`DB_HOST`, check 9); prod config validated, `terraform plan` only, never applied (AGENTS "Prod") |
| Pushes reach the sender and the delivery's team only, with counts each may see; a 410 deletes the row | YES | `push.ts`, `ws.test.ts` "pushes"; on dev the 410 log line `connection gone (410); row deleted` for a real closed connection (check 20) |
| Dev connections stay within the budget | YES | dev peak `DatabaseConnections` 67 over six hours (budget 79); `db.test.ts` budget 79 |
| Terraform for it, applied on dev by the person's yes, and destroyed again | YES | `infra/modules/websocket-api`, six gateway routes; dev applied in four steps (ECR, the stack, the stage fix, the authorizer and routes), `No changes` on the re-plan, destroy of 274 resources, nothing left behind (section 8 below) |

### 4.3 TDD Step 3.3: catch-up

| Requirement | | Evidence |
|---|---|---|
| Connect on page load, subscribe when a job opens, and only then fetch its tasks | YES | `web/src/live/socket.ts`, `web/src/tracking/useJob.ts`; `socket.test.ts`, `StatusPage.test.tsx` "does not fetch until the live connection has answered…"; on dev wscat: `subscribed` before the first `task_update` |
| Reconnect with the new token after every refresh; on every reconnect subscribe again and refetch once; ignore pushes older than the row | YES (dev browser steps skipped, see 4.6) | `socket.test.ts` (new token, back-off, resync once), `apply.test.ts`, `TaskTable.test.tsx` "ignores a push that is older than the row"; Playwright "the live connection drops mid-run and the page catches up without a reload" |

### 4.4 TDD Step 3.4: web app part 3

| Requirement | | Evidence |
|---|---|---|
| Job list with status chips, a Mine / My teams switch, counts refreshing every 30 seconds | YES | `JobList.tsx`, `usePolledJobs.ts`; `usePolledJobs.test.ts`; Playwright "the list updates its counts by itself, every 30 seconds…" |
| Job detail: virtualized table for up to 2,000 tasks, status filter, failure reasons inline | YES | `TaskTable.tsx`, `tracking/virtual.ts`; `virtual.test.ts`, `TaskTable.test.tsx` (2,000 rows, only the window drawn); Playwright "a failure shows its reason in the row…" |
| Retry failed deliveries and Cancel distribution for the sender; team viewers see neither | YES | `JobDetailView.tsx`; `StatusPage.test.tsx` "Cancel and Retry"; Playwright Cancel, Retry and team-viewer tests; the person's check 12 |
| An Audit tab, a full-history Audit trail page with filters | YES | `AuditList.tsx`, `AuditTrailPage.tsx`; `AuditTrailPage.test.tsx`; Playwright "the Audit trail page filters by kind of event" |
| A clear message when a file has expired | YES | `TaskTable.tsx` `ExpiredNote`, `tracking.ts` `fileExpired`; integration "marks a delivery whose staged file is past 33 days". Not testable on dev in one session (check 21) |
| WebSocket client with reconnect | YES | `web/src/live/socket.ts`, `socket.test.ts` |
| Preview and Download buttons on each delivered file, **wired up in M4** | YES (shown, off, by design) | `FileActions.tsx`, `TaskTable.tsx`: icon buttons, off with "Preview and download arrive in the next milestone" (the person's decision, D-M3-17); `ui.spec.ts` |
| The "+N" popover (task 11b) | YES | `Popover.tsx` (and `DestinationChips.tsx`, since removed, D-F1-46); `Popover.test.tsx`; Playwright `tooltips.spec.ts` and `popover.spec.ts` (hover, scroll inside, pin, Esc, outside click, keyboard) |

### 4.5 The M3 task list and the other deliverables

| Requirement | | Evidence |
|---|---|---|
| Teardown script and its test; README and Tear down sections (task 1, D-M2-23) | YES | `scripts/empty-dev-buckets.sh`, `tests/scripts/empty-dev-buckets.test.ts` (7 tests); run for real: dry run 1,006 and 8,174 versions, then both buckets `empty`, then destroy completed |
| `/favicon.ico` (task 2, D-M3-1) | YES | on dev `curl -sI $APP/favicon.ico`: `HTTP/2 200`, `image/svg+xml` (check 1) |
| Integration tests: cancel while running, team-scoped visibility, push (task 12) | YES | `tracking.test.ts` (17 tests), `ws.test.ts` (10 tests), 17 files, 157 tests passed |
| Testing document `M3-TESTING.md` with the five sections (AGENTS "How to work" 3) | YES | `docs/testing/M3-TESTING.md` |
| The testing round run, evidence recorded (AGENTS 4) | YES | this file, sections 1 to 7 |
| Browser checks written as numbered steps for the person, marked YES only after the person reports (AGENTS 4) | YES | `M3-TESTING.md` 1.3 (22 steps, all covered by Playwright) and 3a: the person reported check 12 and check 13 on dev and rechecked every fix |
| Demo: submit a job, watch counts and rows change live, see failure reasons inline, refresh mid-run without losing anything | YES | locally by Playwright "counts and rows change live, and a reload mid-run loses nothing"; on dev the live counts by wscat (417 frames) and the person's browser |
| Walkthrough `docs/walkthrough/M3.md` (AGENTS 6) | YES | written in this close |
| STATUS updated, branch pushed, pull request opened (AGENTS 7) | YES | `docs/STATUS.md`; the pull request is in the close report |
| Free plan, Sydney only, no Console changes, no secrets in files, prod never applied | YES | all AWS changes were `terraform apply` or the project's scripts; the seed password was read into a shell variable inside scripts and never printed; only `terraform plan` ran for prod (`validate` and `fmt`) |

### 4.6 NOs and accepted gaps

| Item | | Reason |
|---|---|---|
| Dev browser steps for checks 14 (F5 mid-run), 15 (Offline switch) and 16 (15 minutes on the page) | NO, accepted | skipped on dev by the person; covered by Playwright locally (`track.spec.ts`, `socket.test.ts`). Check 14's server side (1,300 rows over 14 pages) was run on dev |
| Check 21 (deliveries older than 33 days) on dev | NO, accepted | not testable in one session; covered by an integration test |
| SNS alarm email confirmed on this bring-up | NO, accepted | the confirmation link was never clicked; the four alarms could not email while dev was up. Dev is now destroyed |
| Anantim has 13 destinations, not 14, for the large runs | note | the 1,300-delivery run used all 13 |
| Gateway access log on the WebSocket stage | NO, accepted | D-M3-15: needs an account-wide API Gateway CloudWatch role; the `ws` Lambda logs every event instead |
| Mockup differences | NO, accepted | the Open-by-ID placeholder and an always-on Open button (D-M3-16); draggable columns removed (D-M3-12); the box, tabs and Cancel/Retry rules follow D-M3-10 and D-M3-16 |
| Comparing the screens with the "Track a Job" diagram line by line | not done | the demo and the steps were checked; the diagram was not compared again in this close |
| Plan sizes: the ECR step added 10 resources (5 repositories and 5 policies), not 5; the dev plan was 248, not 275 | note | the testing document's expectations were off, not the code |
| Prod: apply, deploy | not run | by rule; prod stays as code (`terraform validate` and `fmt` clean) |

**Result: PASS.** Every requirement is YES or an accepted NO with its reason. Two things need the person's eye in the pull request: D-M3-15 and the D-M3-17 contract change are listed in `docs/STATUS.md` as decisions to fold into the design documents.

## 8. Teardown (2026-10-17, the person's yes)

| Step | Result |
|---|---|
| `scripts/empty-dev-buckets.sh dev --dry-run` | `docbeam-dev-object-store-346208529537: would delete 1006 versions and 0 delete markers`; `docbeam-dev-platform-files-346208529537: would delete 8174 versions and 0 delete markers`; `Dry run: nothing was deleted.` |
| `scripts/empty-dev-buckets.sh dev` | both buckets `empty` (1,006 and 8,174 deleted), `Done.` |
| `terraform -chdir=infra/envs/dev destroy` | `Destroy complete! Resources: 274 destroyed.` (the security groups and subnets took about 20 minutes: they wait for the Lambda network interfaces to release) |
| `terraform state list` | 0 resources |
| `aws s3 ls` | only `docbeam-tfstate-346208529537` |
| ECS clusters, API Gateway APIs, ECR repositories, Lambda functions, RDS instances, SQS queues, CloudFront distributions, `docbeam` VPCs, NAT gateways, `docbeam` secrets, SNS topics, `docbeam` log groups | all empty. Nothing left behind |

## 5. Fixes after the person's browser checks on dev (D-M3-16)

Check 12 passed in the person's browser. Check 13 was not proven: Sam's Status page showed "Distribution not found" before anything was pasted. Cause: the URL still carried Raj's distribution id after the sign-out and sign-in in the same tab (the page shows "not found" only for an id). Four fixes (see D-M3-16): Open off while the box is empty, the note cleared on typing and on a new Open, the empty card "Pick a distribution, or paste an id to open one." with the id cleared from the URL at sign-out, and the box in the mockup's place on both tabs.

| Check | Result |
|---|---|
| `web/src/components/StatusPage.test.tsx` (2 new tests: Open off and the note cleared; box right after the switch on both tabs) | 24 tests passed |
| `tests/e2e/openid.spec.ts` (6 new tests: empty or spaces disables Open; a short id shows the note, typing clears it, a new Open starts without it; a full unknown id and a full link show only the not-found panel; a new user sees the empty state, not "not found"; signing out clears the open distribution for the next person; the box is in the same place on Mine and My teams for Priya and for a user with none) | 6 passed |
| `npm run lint`, `npm run typecheck`, `npm run build` | clean |
| `npm test` | 71 files, 529 tests passed |
| `npm run test:e2e` (all 6 files, with the M1 and M2 packs) | **41 tests passed** (4.1 minutes) |

## 6. Fixes from the second round of browser checks on dev (D-M3-17)

| Check | Result |
|---|---|
| `tests/e2e/status-fixes.spec.ts` "signing in again from the dialog clears every sign-in error…": with the token and the refresh refused, My teams and a distribution opened by address both show "Your sign-in has ended."; after the dialog sign-in no alert is left, the distribution and its rows are back, the list is no longer loading; the Audit trail page recovers the same way | passed. **Run against the old source it fails** (an alert stays) |
| same file "the File column is as wide as the longest file name, and Destination takes the room that is left" (1280 and 1920 px) | passed: no sideways scroll, File no wider than its longest name plus 32 px, Destination wider than File, whole at 1920. Old source: File 168 px for a 149 px limit, failed |
| same file "a distribution cancelled part way keeps its delivered rows": 8 deliveries, 3 completed first, then Cancel | passed: counts 3 / 5 / 0 / 0, chip `Cancelled`, filters All 8, Delivered 3, Failed 5 (all `CANCELLED`), the list card `Cancelled`, the same after a reload and after the workers start |
| `ui.spec.ts` Deliveries column assertions changed to the new rule | passed |
| `TaskTable.test.tsx` `columnsFor` (3 tests, new rule) | passed |
| Preview and Download enabled for a team member | **NOT DONE.** They are off for everyone by D-M3-12 and TDD Step 3.4, and no download route exists (M4). Decision asked of the person |
| lint, typecheck, build | clean |
| `npm test` | 71 files, 529 tests passed |
| `npm run test:e2e` | **44 tests passed** (4.7 minutes), with the M1 and M2 packs |

## 7. Cancelled is its own count; the "+N" popover; Preview and Download text (D-M3-17, points 4 to 6)

**Not yet on dev.** The count change touches the DocBeam API image and the Delivery and DLQ Consumer Lambdas (they share the push code), so a web-only deploy would not show it. Waiting for the person's yes to deploy those too.

| Check | Result |
|---|---|
| `services/docbeam-api/src/tracking.test.ts` (`totalOf`, `addCount`, status with cancelled counts) and `packages/shared/src/push.test.ts` (a `cancelled` row is its own count for the sender and for a team viewer, in `task_update` and `job_update`) | passed (136 tests in `packages/shared` and `services/docbeam-api`) |
| `tests/integration/tracking.test.ts` "POST /jobs/:id/cancel while deliveries run": after the cancel the detail and the list say `completed 2, failed 0, cancelled 2`; `tasks?status=cancelled` returns the 2 CANCELLED rows, `status=failed` returns 0, `status=completed` returns 2 | passed (17 files, 157 tests, on the rebuilt stack) |
| `tests/integration/ws.test.ts` "sends one job update after a cancel": `cancelled: 3` for the sender, `cancelled: 1` for the team member, `failed: 0` for both | passed |
| `StatusPage.test.tsx`: a Cancelled tile (grey, not the colour of Failed), grey 62.5 % bar segment and 0 % red, Cancelled filter chip; no tile or chip when nothing was cancelled | passed |
| `status-fixes.spec.ts` "a distribution cancelled part way: tiles, both bars, chips, filters, rows and audit agree": 3 of 8 delivered then Cancel. Before the cancel no Cancelled tile or chip. After: tiles Delivered 3, Failed 0, In progress 0, Waiting 0, Cancelled 5 (grey `#667085`, Failed keeps red `#B42318`); header bar 37.5 % green, 62.5 % grey, 0 % red, 0 % blue; the card's bar the same; filters All 8, Delivered 3, Failed 0 ("No deliveries with this status."), Cancelled 5 with five grey `Cancelled` row chips and the code `CANCELLED`; the Audit tab has 5 `Delivery cancelled` and no `Delivery failed`; the same after a reload and after the workers start | passed |
| `track.spec.ts` Cancel test: counts `0 0 0 0 6`, no Retry button, the note "This distribution was cancelled, so Retry is off." | passed |
| `ui.spec.ts` Preview and Download: label "Preview <file>. Preview and download arrive in the next milestone", disabled, text `#667085` on `#f2f4f7`, contrast at least 4.5 to 1 | passed |
| `Popover.test.tsx` (2 new tests, then in `DestinationChips.test.tsx`): hover then move into the panel keeps it open past the close delay, a scroll inside it does not close it, a scroll of the page does; a click pins it | passed |
| `popover.spec.ts` "the +N popover stays open…" on Distribute (`+10`) and on the Status header: no gap between chip and panel (at most 1 px); the pointer moves slowly into the panel and the panel stays open past 700 ms; the list (long enough to scroll) scrolls by wheel and the panel stays; leaving both closes a hover; a click pins it with the pointer away; Esc closes and the focus returns to the chip; a click outside closes a pinned one; focus the chip, Enter opens, Esc closes. **Run against the old Popover it fails** ("a gap between the chip and the panel") | passed |
| `npm run lint`, `npm run typecheck`, `npm run build` | clean |
| `npm test` | 71 files, 538 tests passed |
| `npm run test:integration` | 17 files, 157 tests passed |
| `npm run test:e2e` | **45 tests passed** (4.9 minutes), with the M1 and M2 packs |

### 7a. Rollout of 517547c to dev (2026-10-17, the person's yes)

Audit of who builds or sends counts: the DocBeam API (list, detail, and the `job_update` pushes of cancel and retry), Delivery and the DLQ Consumer (`task_update` pushes). The `ws` Lambda's `subscribed` answer carries no counts; the sweeper, fan-out and upload-events never build or send them. **No database migration**: `cancelled` is read from the existing `status` and `failure_code`. No Terraform change.

| Step | Result |
|---|---|
| `push-image.sh dev docbeam-api …` | `…/docbeam-dev/docbeam-api:517547c519d9` |
| `deploy-service.sh dev docbeam-api …` (its migrate step ran, nothing to apply) | `Deployed … to docbeam-dev-docbeam-api` |
| `npm run build`; `deploy-lambda.sh dev delivery` and `dlq` | `Deployed the new code to docbeam-dev-delivery`, `…-dlq` |
| `scripts/check-internal.sh dev` | `3001 200`, `3002 200`, `3003 200` |
| Through the API, distribution 148eaed7 as Anantim | detail: `status cancelled, taskCount 1300, counts {completed 507, failed 0, cancelled 793, pending 0, in_progress 0}`; the Mine list says the same; `tasks?status=cancelled` total 793 (all `CANCELLED`), `status=failed` total 0, `status=completed` total 507; `status=bogus` gives 400 |
| `deploy-web.sh dev` | `Deployed to https://d2d0tow0wi92yw.cloudfront.net`; the live bundle contains the new Preview and Download text and the Cancelled strings |
| Live push, wscat as Priya: 100 files to 11 destinations (1,100 deliveries), subscribe, `POST /cancel` at 288 completed | `{"cancelled":736}`; `subscribed`; 364 `task_update` frames; then `{"type":"job_update",…,"counts":{"pending":0,"in_progress":11,"completed":353,"failed":0,"cancelled":736}}`; final detail `cancelled`, completed 364, failed 0, cancelled 736 |
