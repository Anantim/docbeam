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

Note on counts: STATUS had said 129 integration tests after task 7 and task 9. Today's run is 126, and the only change to the integration files since then is the new `web-upload.test.ts` (one test; the `dlq-sweeper.test.ts` test gained assertions, not a test). So the earlier figure was 125 by the same count, and the 129 in STATUS was wrong. I could not re-run the old commit to prove it, so treat 126 as the measured number.

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
