# M2 results

Evidence for `docs/testing/M2-TESTING.md`. Local part run on 2026-10-15 on the laptop (WSL2, Docker Desktop). **Nothing has been run in AWS yet** (sections 2 and 3 wait for the person's yes, D-M2-14).

## 1. Local

### 1.1 Stack

| Check | Result |
|---|---|
| `docker compose up -d --build --wait` | exit 0. auth, platform, docbeam-api, postgres, localstack, clamav, workers and ws-local `healthy` (rebuilt after the DLQ change) |
| `docker compose run --rm seed` | done earlier in the session; the integration suite passes against the seeded stack |

### 1.2 Tests

| Command | Result |
|---|---|
| `npm run lint` | clean |
| `npm run typecheck` | clean (services, workers, tests, web) |
| `npm test` | 51 test files, 327 tests passed |
| `npm run build` | all workspaces built. Web: `index-*.js` 275 kB, `hash.worker-*.js` 6.5 kB, `docx-preview-*.js` 171 kB and `exceljs.min-*.js` 929 kB as separate files loaded only when used |
| `npm run test:integration` | 15 test files, 126 tests passed |
| `terraform fmt -check -recursive infra` | exit 0 |
| `terraform -chdir=infra/envs/dev validate`, same for `prod` | `The configuration is valid.` for both |

### 1.2c Why STATUS said 129 and the run says 126 (by test names, no old code run)

Method: `git grep -n -E "^\s*(it|test)(\.each)?\(" <commit> -- tests/integration`, names sorted and diffed. A name written with `it.each` runs once per table row, so the run count is the name count plus the extra rows.

| Commit | `it(` / `it.each(` names | Extra rows from `it.each` | Tests run |
|---|---|---|---|
| `cde4987` task 6 | 104 | 14 in 5 tables, plus 3 rows in `workers.test.ts` (3 rows, 1 more name counted once: +2) | 120 (matches the STATUS row for task 6) |
| `0e13e67` task 7 | 111 | 14 | 125 |
| `b163c24` task 9 | 111 | 14 | 125 |
| `HEAD` | 112 | 14 | 126 |

The 14 extra rows are the five tables that exist at every commit: `auth.test.ts` 4 rows (+3), `localstack.test.ts` 3 (+2), `services.test.ts` 3 (+2), `uploads.test.ts` 6 (+5) and 3 (+2). 112 + 14 = 126, which equals the run.

Names removed and added:

| Step | Removed | Added |
|---|---|---|
| task 6 → task 7 (`cde4987` → `0e13e67`) | `workers.test.ts`: `it('runs the sweeper on its one-minute timer')` and `it.each` of 3 rows (4 tests) | `dlq-sweeper.test.ts`: 9 names (task DLQ, crashed worker, never flips, job DLQ pending only, job DLQ closes job, Upload DLQ, sweeper re-send, a minute-old job, daily cleanup) |
| task 7 → task 9 (`0e13e67` → `b163c24`) | none | none |
| task 9 → `HEAD` (`b163c24` → `HEAD`) | none | `web-upload.test.ts`: `it('uploads a small file and a multipart file, verifies both, and sends them as one distribution')`. `dlq-sweeper.test.ts` gained assertions in an existing test, no new name |

So the 129 in the STATUS row for task 7 was 120 (task 6) + 9 (new DLQ tests) with the 4 removed `workers.test.ts` tests not subtracted: 120 − 4 + 9 = 125. It was an arithmetic slip in STATUS, not a lost test. No integration test was removed since task 7, and the only name added since task 9 is the one above. The per-file diff is `git diff --stat b163c24 HEAD -- tests/integration`: `dlq-sweeper.test.ts` (+13 lines) and `web-upload.test.ts` (+122, new).

### 1.2a Named checks

| Requirement | Test | Result |
|---|---|---|
| **Carried over from M0 (Step 0.1): the EICAR test file is refused as infected by the real ClamAV through the Upload Events handler** | `tests/integration/upload-events.test.ts` > "upload-events: confirmation and scanning > EICAR is refused as infected by the real ClamAV" | ✓ 573 ms (object deleted, row `infected`, one `file.refused`) |
| A repeated event writes no second audit event | same file > "a repeated event for a refused file changes nothing and writes no second audit event" | ✓ |
| Platform down, then back: the task goes to pending and finishes | `delivery.test.ts` > "puts a task back to pending when the platform is down, and finishes it when it returns" | ✓ 35.9 s |
| Upload DLQ marks the file and writes `file.refused` with `SCAN_FAILED`, and not twice (D-M2-19) | `dlq-sweeper.test.ts` > "marks a file failed from the Upload DLQ, and leaves a clean one alone" (9 tests in the file) | ✓ |
| The web queue end to end in Node: 5 KB file and 101 MiB multipart file hashed, linked, uploaded in 7 parts, Verified by the real scanner, `POST /jobs` 201, both tasks `completed` | `web-upload.test.ts` > "uploads a small file and a multipart file, verifies both, and sends them as one distribution" | ✓ 16.7 s |
| A deploy during a long upload does not cut it | `platform-drain.test.ts` | ✓ |

### 1.2b Fixes made at the start of this session

| Fix | Evidence |
|---|---|
| Delivery's security group only on the Auth and platform listeners | `infra/modules/alb` takes `clients` with an optional `services` list; `terraform validate` passes in both envs. The plan against AWS is not run yet (it reads AWS); the client rules change from 12 (4 clients x 3 listeners) to 11 (Delivery on 2) |
| Upload DLQ writes `file.refused` (D-M2-19) | `dlq-sweeper.test.ts` checks one event with `reason SCAN_FAILED`, `ownerUserId`, `actor_id` NULL, none for the clean file, still one after the same message again |

### 1.3 Browser checks: waiting on the person

Steps 1 to 19 of section 1.3 in `M2-TESTING.md`. None is recorded as YES yet.

| Steps | Status |
|---|---|
| 1 to 19 | waiting on the person |

### 1.4 Command line

Covered by the integration runs above (the three commands in section 1.4 are the same tests).

## 2. Deploy to dev on AWS

Not run yet. Waiting for the person's yes to each push, apply and task run.

## 3. Verify on dev

Not run yet. The swapped-body check (3, check 2) can only be made on AWS, because LocalStack 4.14 does not enforce the checksum of a presigned POST.
