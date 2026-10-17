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

Browser steps (`M4-TESTING.md` 1.3): run by Playwright (local `download.spec.ts`, dev `download-dev.spec.ts`; section 3). The person was not asked to click anything this round.

## 2. Deploy to dev on AWS (2026-10-17, run by the session under the person's standing approval)

Image tag `b06c8ce84f29`. Steps in the README "Build dev" order; the SNS alarm email was **not** confirmed this round (the person's choice; no M4 check depends on alarms).

| Step | Result |
|---|---|
| `terraform init`, `apply -target=module.ecr` | Five repositories |
| Push five images (`auth`, `platform`, `docbeam-api`, `db-bootstrap`, `upload-events`) | `PUSHED` |
| `plan` without the authorizer | `Plan: 247 to add, 0 to change, 0 to destroy` |
| `apply` | `Apply complete! Resources: 247 added, 0 changed, 0 destroyed.` |
| `scripts/run-db-bootstrap.sh dev`; `scripts/run-task.sh dev auth signing-key` | `bootstrap finished`; `signing key written`; exit code 0 each |
| `deploy-service.sh` for auth, platform, docbeam-api; `check-internal.sh dev` | `Deployed …` each; `3001 200`, `3002 200`, `3003 200` |
| `deploy-lambda.sh` for fanout, delivery, dlq, ws, sweeper | `Deployed the new code …`; upload-events already ran the image |
| `apply` with the authorizer | `Plan: 18 to add, 0 to change, 0 to destroy`; `Apply complete! Resources: 18 added` |
| `scripts/deploy-web.sh dev` | `Deployed to https://d2ao2m550em3lv.cloudfront.net` |
| `POST /api/files/<uuid>/downloads` without a token | `401` from the gateway |

## 3. Verify on dev

Curl and AWS CLI checks (full output: `m4-evidence/curl-checks.txt`; people and files are the seed users and PDFs sent by the browser run). Browser checks were run by the session with Playwright against the dev address (`npm run test:e2e:dev`, config `playwright.dev.config.ts`), report in `m4-evidence/playwright-report/index.html`, screenshots in `m4-evidence/*.png`.

| # | Check | Result |
|---|---|---|
| 1 | Priya (sender) asks for a download link | `201`, `{url, expiresAt, fileName, contentType, sizeBytes}` with `X-Amz-Expires=120`, host `docbeam-dev-object-store-346208529537.s3.ap-southeast-2.amazonaws.com` |
| 2 | Download link | `200`, `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="both-f7abe2.pdf"; filename*=UTF-8''both-f7abe2.pdf`, 52 bytes starting `%PDF-1.7`. Preview link: `200`, `Content-Type: application/pdf`, `Content-Disposition: inline` |
| 3 | Raj (Cardio) | Cardio and Oncology file: `201`. Oncology-only file: `404 {"error":{"code":"NOT_FOUND","message":"That file is not available to you."}}` |
| 4 | Sam (neither team); a random id; no token | `404` with the same body as a random id; `401` |
| 5 | Both links used 130 s later (both worked at once) | Download link `403`, preview link `403`, each `<Code>AccessDenied</Code><Message>Request has expired</Message>` |
| 6 | The object with no signature | `403 AccessDenied` |
| 7 | `GET /audit?action=download.issued&jobId=…` | Priya: all events (own with no team; Raj's with the Cardio team). Raj: only his two, both with a team. Sam: `[]` |
| 8 | API log, last hour | 31 `POST /files/…/downloads` requests (201 and 404); `0` lines with `X-Amz-Signature`, `X-Amz-Security-Token` or a JWT; no file names |
| 9 | Bucket policy and CORS (CLI, read only) | `DenyReadUnlessScannedClean` and the other three statements present; CORS methods `POST GET DELETE PUT`, origins the dev CloudFront address and `http://localhost:5173` |
| 10 | HTTP API `docbeam-dev-api` route `POST /files/{fileId}/downloads` | Authorization `JWT`, authorizer `docbeam-jwt` |

Browser checks (8 passed, 1 skipped: the 33-day test, which ages a file in the local database):

| Check | Result and evidence |
|---|---|
| Priya previews a PDF, a DOCX and an XLSX; each renders | PDF in the viewer frame from the Object Store link; DOCX and XLSX in an empty-sandbox frame with their text: `priya-preview-pdf.png`, `priya-preview-docx.png`, `priya-preview-xlsx.png` |
| Downloading one file saves it under its original name | Browser download event: `suggestedFilename` equals the uploaded name; `priya-download-pdf-saved.png` |
| Raj previews a Cardio file | `raj-preview-cardio-file.png` |
| Raj opens an Oncology-only distribution; Raj asks for its file | "Distribution not found" (`raj-oncology-only-not-found.png`); API `404` |
| Sam opens the job | "Distribution not found" (`sam-not-found.png`); file `404` |
| Audit tab: Priya sees every link event, Raj only his own | `priya-audit-tab-all-link-events.png` (2 previews, 1 download), `raj-audit-tab-only-his-own.png` (1 preview) |
| A download bar runs past 2:00 and shows the expired text | `download-bar-counting-down.png`, `download-bar-expired.png`: "The link for … has expired and storage now refuses it. Click Download for a fresh one." |

**Finding fixed during the round.** The first dev browser run failed on the Audit tab: it was read when the distribution opened, so Priya's own new Preview and Download events did not appear until a reload (the API already returned them). Fix: the tab reads again when a link is issued (`useFileLink` counts links; `JobDetailView` adds the count to the audit reload key). Rechecked: the run above is after the fix. The same run showed a local-only URL pattern in `download.spec.ts`; it now accepts any host.

## 4. YES/NO check

Every requirement of the milestone prompt and Step 4.1 (see `docs/PLAN.md` M4 and the TDD):

| # | Requirement | | Evidence |
|---|---|---|
| 1 | `POST /files/:fileId/downloads` with mode download or preview | YES | `services/docbeam-api/src/routes/downloads.ts`; `downloads.test.ts` "gives a preview link…"; dev checks 1, 2 |
| 2 | Sender check | YES | integration "gives the sender a link that saves the exact bytes…"; dev check 1 |
| 3 | Team check: delivered (completed) to one of the caller's teams | YES | integration "lets a member of a team…", "…not completed yet"; dev check 3 |
| 4 | 410 FILE_EXPIRED after 33 days, only for allowed callers | YES (tests only) | unit `decideDownload` "gives 410…"; integration "answers 410 FILE_EXPIRED…". Not run on dev: no file is 33 days old (same as M3 check 21) |
| 5 | 2-minute GET link with the right content disposition | YES | `s3.test.ts` (120 s, attachment and inline); dev checks 1, 2, 5 |
| 6 | 404 for anyone not allowed, same body as a missing file, no link and no audit row | YES | integration "gives 404 to someone in neither team…"; dev checks 3, 4; browser Raj and Sam |
| 7 | Preview in an in-page viewer: PDF, PNG, JPG directly | YES (PDF on dev; images by test) | `Preview.test.tsx` "opens a PDF and an image straight from the link"; dev browser PDF. PNG/JPG not opened in the dev browser |
| 8 | DOCX and XLSX as a read-only page in the browser | YES | `Preview.test.tsx`; local and dev `download.spec.ts` (sandbox `""`, text visible) |
| 9 | Download saves under the original file name | YES | `download.spec.ts` (`suggestedFilename`); dev check 2 |
| 10 | A preview is recorded in the audit trail like a download | YES | integration (Raj's preview row with team); dev check 7; browser Audit tab |
| 11 | Tests for allowed, not allowed, missing and expired | YES | `downloads.test.ts` (11 unit), `tests/integration/downloads.test.ts` (11) |
| 12 | `M4-TESTING.md`, `M4-RESULTS.md`, `STATUS.md` | YES | this file, `M4-TESTING.md`, `STATUS.md` |
| 13 | Demo works locally | YES | section 1: 567 + 168 + 49 tests |
| 14 | Demo works on dev: Preview shows the file, Download saves it, outsiders get 404 | YES | section 3 |
| 15 | Prod never planned, applied or deployed | YES | no `-chdir=infra/envs/prod` command other than `validate` |
| 16 | Dev torn down | see STATUS | recorded after the teardown |

Accepted NOs: none. Notes: the SNS alarm email was not confirmed on this bring-up (the person's choice). A link's expiry cannot be proved on LocalStack (check 5 on dev proves it).
