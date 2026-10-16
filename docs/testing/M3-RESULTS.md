# M3 results

Evidence for `docs/testing/M3-TESTING.md`. Local part run on 2026-10-16 and 2026-10-17 on the laptop (WSL2, Docker Desktop). **Nothing has been run in AWS yet** (sections 2 and 3 wait for the person's yes, D-M2-14). The browser checks are done by Playwright (1.2b); the few that need a human eye (1.3: steps 1, 4, 21 and the look) are waiting on the person.

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
| `npm test` | **final: 68 test files, 498 tests passed.** (Earlier in the session: 65 files, 473 tests.) One run (with the whole Docker stack busy) timed out `web/src/upload/hashing.test.ts` at its 5-second limit; the file passes on its own (3 tests) and the full suite passed on the next run. M2 code, not changed in M3 |
| `npm run build` | all workspaces built, web `✓ built` |
| `npm run test:integration` | **final: 17 test files, 157 tests passed** (on the rebuilt stack, 2026-10-17; the extra test is the Sweeper's expired-connection delete) |
| `npm run test:e2e` | **10 tests passed, three full runs in a row** (about 2.1 minutes each), see 1.2b |
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

### 1.2b Playwright (Chromium 156, headless, against Compose and the Vite dev server)

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

### 1.3 Browser checks: left for the person (look and feel only)

Steps 1 to 22 of `M3-TESTING.md` section 1.3. None is recorded as YES yet.

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
