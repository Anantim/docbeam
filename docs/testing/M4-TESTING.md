# M4 testing: Download a file

Demo: Preview shows the file in the page and Download saves it; anyone who is not the sender and not in a team the file was delivered to gets 404.

Every check is a command or a click with the expected result. Account `346208529537`, region `ap-southeast-2` (Sydney). Ask before every command that changes AWS. M4 adds one route, `POST /files/:fileId/downloads`, one gateway route and a new DocBeam API image and web build. No new infrastructure.

People: **Priya Shah** (Cardio, Oncology), **Raj Mehta** (Cardio), **Sam Ito** (Neuro), **Anantim Patil** (all three). Password for every one: `SEED_USER_PASSWORD` in `.env`.

## 1. Local

### 1.1 Start the stack

| # | Command | Expect |
|---|---|---|
| 1 | `scripts/local-env.sh` | `.env is ready` |
| 2 | `docker compose up -d --build --wait` | Every container `healthy` |
| 3 | `docker compose run --rm seed` | Two `seed applied` lines |

### 1.2 Run the tests

| # | Command | Expect |
|---|---|---|
| 1 | `npm run lint && npm run typecheck` | No errors |
| 2 | `npm test` | 74 files, 567 tests pass |
| 3 | `npm run build` | `✓ built` |
| 4 | `npm run test:integration` | 18 files, 168 tests pass. `downloads.test.ts` has 11 |
| 5 | `npm run test:e2e` | 49 tests pass in about 6 minutes. `download.spec.ts` has 4 |
| 6 | `terraform fmt -check -recursive infra`; `terraform -chdir=infra/envs/dev validate`; the same for `prod` | No output from fmt; `The configuration is valid.` |

### 1.3 The browser steps (waiting on the person; Playwright covers the same ground)

Open http://localhost:5173 (`npm run dev -w @docbeam/web`).

1. Sign in as Priya. Distribute: add a PDF, a DOCX and an XLSX (any real files) and a PNG. Tick **Cardio / CARDIO-301 Regulatory / IRB approvals** and **Oncology / ONC-118 Regulatory / Ethics committee**. Send. Wait for **Completed**. Expect: on every delivered row an eye and an arrow, both live.
2. Click the eye on the PDF. Expect: a dialog with the PDF in the viewer, `PDF` badge, the size, and the line "Opened with a 2-minute link…". Esc closes it.
3. Eye on the PNG: the image shows. Eye on the DOCX: the text shows as a read-only page. Eye on the XLSX: the cells show as a table; a sheet picker appears when there is more than one sheet.
4. Click the arrow on the PDF. Expect: the browser saves it under its own name. A blue bar reads "<name> is downloading. Its link works for this one file for another m:ss." and counts down. After 2:00 it turns red: "The link for <name> has expired… Click Download for a fresh one." Dismiss closes it.
5. Audit tab of the distribution. Expect: "Preview link issued" and "Download link issued" lines with your name.
6. Sign out. Sign in as Raj. Status → My teams → open the distribution. Expect: only Cardio rows. Preview and Download work on them.
7. Sign out. Sign in as Sam. Paste the distribution id into Open by ID. Expect: "Distribution not found".
8. Raj's Audit tab (or the Audit trail page, Downloads filter) shows his own downloads. Priya's Audit trail shows Raj's too.

### 1.4 Checks from the command line

```bash
set -a; . ./.env; set +a
npx vitest run -c vitest.integration.config.ts tests/integration/downloads.test.ts   # 11 tests
npx vitest run services/docbeam-api/src/routes/downloads.test.ts services/docbeam-api/src/s3.test.ts   # 11 + 9 tests
npx vitest run web/src/components/Preview.test.tsx web/src/components/TaskTable.test.tsx web/src/tracking/useFileLink.test.ts web/src/tracking/links.test.ts
```

Each ends with every test passed. LocalStack does not enforce link expiry, so "a link is refused after 2 minutes" is checked on dev only (section 3, check 5).

## 2. Deploy to dev on AWS (about 4 to 6 hours up, about 3 USD)

Ask before each push, apply and task run. The README "Build dev" block holds the first-time order; it is the same as M3, plus one gateway route.

| # | Command | Expect |
|---|---|---|
| 1 | `aws sts get-caller-identity --query Arn --output text` | `…:user/anantim-admin` |
| 2 | `gh variable list` | `ALARM_EMAIL` set, `ECS_DEPLOY_ENABLED` `true`, `LAMBDA_DEPLOY_ENABLED` `true`, `INFRA_APPLY_ENABLED` `false` |
| 3 | `export IMAGE_TAG=$(git rev-parse --short=12 HEAD)`; `git status --short` | Tag printed, tree clean |
| 4 | `export TF_VAR_alarm_email=$(gh variable get ALARM_EMAIL)` | (not printed) |
| 5 | `terraform -chdir=infra/envs/dev init -reconfigure -backend-config="bucket=docbeam-tfstate-346208529537"` | `successfully initialized` |
| 6 | `terraform -chdir=infra/envs/dev apply -target=module.ecr -var image_tag=$IMAGE_TAG` | `Apply complete!` |
| 7 | `for s in auth platform docbeam-api; do scripts/push-image.sh dev $s docker/service.Dockerfile --build-arg SERVICE=$s; done`; `scripts/push-image.sh dev db-bootstrap docker/db-bootstrap/Dockerfile`; `scripts/push-image.sh dev upload-events workers/upload-events/Dockerfile` | Image URIs |
| 8 | `terraform -chdir=infra/envs/dev plan -var image_tag=$IMAGE_TAG -var upload_events_image_tag=$IMAGE_TAG -var jwt_authorizer_enabled=false` | About 275 to add. The plan lists `POST /files/{fileId}/downloads` only once the authorizer is on (check 16) |
| 9 | The same with `apply -auto-approve` | `Apply complete!`, about 25 minutes |
| 10 | Confirm the SNS email (a new topic on every bring-up) | `Subscription confirmed` |
| 11 | `scripts/run-db-bootstrap.sh dev`; `scripts/run-task.sh dev auth signing-key` | `exit code: 0` each |
| 12 | `R=346208529537.dkr.ecr.ap-southeast-2.amazonaws.com/docbeam-dev; for s in auth platform docbeam-api; do scripts/deploy-service.sh dev $s $R/$s:$IMAGE_TAG; done` | `Deployed …` each |
| 13 | `scripts/check-internal.sh dev` | Three `200` lines |
| 14 | `npm run build`; `for w in fanout delivery dlq ws sweeper; do scripts/deploy-lambda.sh dev $w workers/$w/dist/lambda; done` | Each `Deployed` |
| 15 | `scripts/deploy-lambda.sh dev upload-events $R/upload-events:$IMAGE_TAG` | Skips: it already runs this image |
| 16 | `terraform -chdir=infra/envs/dev apply -auto-approve -var image_tag=$IMAGE_TAG -var upload_events_image_tag=$IMAGE_TAG` | `Apply complete!` (the authorizer and the download route are created) |
| 17 | `scripts/deploy-web.sh dev` | `Deployed to https://<id>.cloudfront.net` |
| 18 | `terraform -chdir=infra/envs/dev plan -var image_tag=$IMAGE_TAG -var upload_events_image_tag=$IMAGE_TAG` | `No changes.` |

## 3. Verify on dev

`APP=$(terraform -chdir=infra/envs/dev output -raw app_url)`. Read the seed password from Secrets Manager (`docbeam-dev/seed/user-password`) into `SEED_PW`; never paste it into a file or the chat. First, in the browser as Priya, send a PDF to Cardio and Oncology (section 1.3 step 1) and note the distribution id as `JOB`.

```bash
login() { curl -s -X POST $APP/api/auth/login -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$SEED_PW\"}" | jq -r .accessToken; }
PRIYA=$(login priya.shah@example.com); RAJ=$(login raj.mehta@example.com); SAM=$(login sam.ito@example.com)
FILE=$(curl -s $APP/api/jobs/$JOB/tasks -H "authorization: Bearer $PRIYA" | jq -r '.tasks[0].fileId')
ask() { curl -s -w '\n%{http_code}\n' -X POST $APP/api/files/$FILE/downloads -H "authorization: Bearer $1" -H 'content-type: application/json' -d "{\"mode\":\"${2:-download}\"}"; }
```

| # | Check | Expect |
|---|---|---|
| 1 | `ask $PRIYA` | `201` and `{url, expiresAt, fileName, contentType, sizeBytes}`. The URL is on `docbeam-dev-object-store-…s3.ap-southeast-2.amazonaws.com` with `X-Amz-Expires=120` |
| 2 | `URL=$(ask $PRIYA \| head -1 \| jq -r .url); curl -s -D - -o /tmp/dl.bin "$URL" \| head -12` | `200`, `content-disposition: attachment; filename="…"`, the SHA-256 of `/tmp/dl.bin` equals the one you uploaded. With `ask $PRIYA preview`: `content-disposition: inline` and `content-type: application/pdf` |
| 3 | `ask $RAJ` (the file went to Cardio and Oncology) | `201`. For a file sent only to Oncology (send one more): `404` and `{"error":{"code":"NOT_FOUND",…}}` |
| 4 | `ask $SAM`; and a random UUID as `FILE` | `404` both, the same body. `curl -s -o /dev/null -w '%{http_code}\n' -X POST $APP/api/files/$FILE/downloads` (no token) → `401` from the gateway |
| 5 | Take a link, wait 130 seconds, `curl -s -w '%{http_code}\n' "$URL"` | `403` with `Request has expired` |
| 6 | The bucket itself, no link: `curl -s -o /dev/null -w '%{http_code}\n' "https://docbeam-dev-object-store-346208529537.s3.ap-southeast-2.amazonaws.com/<the s3 key>"` | `403` |
| 7 | `curl -s "$APP/api/audit?action=download.issued" -H "authorization: Bearer $PRIYA" \| jq '.events[] \| {action, actorId, teamId, mode: .detail.mode}'` | Priya's own events have `teamId` null; Raj's have the Cardio team. Raj's own `/audit` shows his, not Priya's. Sam's shows none |
| 8 | `aws logs tail /aws/ecs/docbeam-dev-docbeam-api --since 15m` (use the log group name that `aws logs describe-log-groups --log-group-name-prefix /aws/ecs/docbeam-dev` shows) | `POST /files/…/downloads` lines with 201 and 404. No file contents, no signed URL in the log |
| 9 | Console (Sydney, read only): S3 → the object store → Permissions → Bucket policy | Statement `DenyReadUnlessScannedClean` is there; CORS lists `GET` |
| 10 | Console: API Gateway → `docbeam-dev` HTTP API → Routes | `POST /files/{fileId}/downloads`, authorizer attached |
| 11 | **Browser at `$APP`**, section 1.3 steps 1 to 8 as Priya, Raj and Sam | Same results as locally. Step 4: the saved file opens and matches |
| 12 | A distribution with files older than 33 days | Not testable in one session; covered by `downloads.test.ts` "answers 410 FILE_EXPIRED…" and `download.spec.ts` "a file older than 33 days…" |

## 4. Prod (not deployed in this project)

Never from a session (D-G3). If prod is ever deployed, from `main` with `deploy-prod`:

| # | Check | Expect |
|---|---|---|
| 1 | Workflows `docbeam-api`, `web`, `infra` | Green |
| 2 | API Gateway `docbeam-prod` routes | `POST /files/{fileId}/downloads` present |
| 3 | The curl checks 1, 3, 4 and 5 against the prod address | 201, 404, 401, 403 |

## 5. Tear down

```bash
scripts/empty-dev-buckets.sh dev --dry-run   # first: names and counts; nothing is deleted
scripts/empty-dev-buckets.sh dev
export TF_VAR_alarm_email=$(gh variable get ALARM_EMAIL)
terraform -chdir=infra/envs/dev destroy -var image_tag=$IMAGE_TAG -var upload_events_image_tag=$IMAGE_TAG
```

Expect the dry run to name exactly `docbeam-dev-object-store-<account id>` and `docbeam-dev-platform-files-<account id>`, then `Done.`, then `Destroy complete!`. After that `terraform -chdir=infra/envs/dev state list` prints nothing and `aws s3 ls` shows only `docbeam-tfstate-346208529537`. Dev costs about 4.5 USD a day while it is up.
