# M4 results: Download a file

Run on 2026-10-17, branch `m4`. Testing document: `M4-TESTING.md`.

## 1. Local (run by the session)

| Check | Command | Result |
|---|---|---|
| Lint, typecheck | `npm run lint && npm run typecheck` | Clean |
| Unit and web | `npm test` | 74 files, 567 tests passed |
| Build | `npm run build` | `✓ built` |
| Integration | `npm run test:integration` | 18 files, 168 tests passed, including `downloads.test.ts` (11) |
| Browser (Playwright) | `npm run test:e2e` | 49 tests: 48 passed on the full run; the one failure was `ui.spec.ts` "Preview and Download … look off", which asserted the M3 off-state. It was rewritten ("a delivered file has live Preview and Download icon buttons") and passes |
| `download.spec.ts` | 4 tests | Passed: PDF, DOCX and XLSX preview in the page (sandbox `""`); Download saves under the original name and the banner counts down; Raj previews; Sam gets "Distribution not found"; a 40-day-old file shows the expired note and no buttons; 4 `download.issued` rows for Priya's 3 previews and 1 download |
| Terraform | `terraform fmt -check -recursive infra`; `validate` dev and prod | Clean |

Integration tests (`tests/integration/downloads.test.ts`): sender gets the exact bytes with `attachment` and the encoded original name; preview is `inline` with the stored type; Raj (Cardio, delivered) gets 201 and his audit row carries the Cardio team and no task id; Raj for an Oncology-only file 404 with no audit row; pending and failed deliveries 404; Sam 404 with the same body as an unknown id; non-UUID 404; no token 401; infected file 404 even to the sender; 410 `FILE_EXPIRED` after 33 days for the sender and Raj, 404 for Sam; bad `mode` 400; audit visibility (Raj's download seen by Raj and Priya, Priya's own only by Priya, Sam sees none).

Not testable locally: a link refused after 2 minutes. LocalStack does not enforce expiry (a test that tried it got 200 after the expiry, so it was removed). The unit test pins `X-Amz-Expires=120`; dev check 5 proves the refusal.

Browser steps (`M4-TESTING.md` 1.3): **waiting on the person**. Playwright covers the same ground.

## 2. Deploy to dev on AWS

Not run yet. Waiting for the person's yes.

## 3. Verify on dev

Not run yet.

## 4. YES/NO check

Written at close.
