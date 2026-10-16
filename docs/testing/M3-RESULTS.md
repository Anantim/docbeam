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
| Popover | `web/src/components/DestinationChips.test.tsx` (9 tests): lists only the hidden folders grouped by team; closes on Esc (focus back on the button), on a click outside, when Tab leaves; opens on hover; a click keeps it open |
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

Not run. Waiting for the person's yes (`M3-TESTING.md` section 2).

## 3. Verify on dev

Not run.

## 4. Final check: YES / NO

Written after sections 2 and 3 (see `docs/STATUS.md` for where the milestone stands).
