# M3 results

Evidence for `docs/testing/M3-TESTING.md`. Local part run on 2026-10-16 on the laptop (WSL2, Docker Desktop). **Nothing has been run in AWS yet** (sections 2 and 3 wait for the person's yes, D-M2-14). **The browser checks (1.3) are waiting on the person.**

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
| `npm test` | 65 test files, 473 tests passed. One run (with the whole Docker stack busy) timed out `web/src/upload/hashing.test.ts` at its 5-second limit; the file passes on its own (3 tests) and the full suite passed on the next run. M2 code, not changed in M3 |
| `npm run build` | all workspaces built, web `✓ built` |
| `npm run test:integration` | 17 test files, 156 tests passed (run at the end, on the rebuilt stack) |
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

### 1.3 Browser checks: waiting on the person

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
