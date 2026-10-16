# M2 testing: Upload and distribute

Demo: pick files, upload them, map them to folders, send, and see the documents land in the platform, including stopping the platform mid-run and watching the backlog drain.

Every check is a command or a click with the expected result. Account `346208529537`, region `ap-southeast-2` (Sydney). Ask before every command that changes AWS. Push to the browser (live counts) is **not** part of M2: the WebSocket API is built in M3 (Step 3.2), so on AWS the Delivery Lambda has no push endpoint yet.

## 1. Local

### 1.1 Start the stack

| # | Command | Expect |
|---|---|---|
| 1 | `scripts/local-env.sh` | `.env is ready` (it keeps values that already exist) |
| 2 | `docker compose up -d --build --wait` | auth, platform, docbeam-api, postgres, localstack, clamav, workers and ws-local are `healthy` |
| 3 | `docker compose run --rm seed` | Two `seed applied` lines. A repeat shows every `…Changed` count at `0` |

### 1.2 Run the tests

| # | Command | Expect |
|---|---|---|
| 1 | `npm run lint` | No output after `eslint .` |
| 2 | `npm run typecheck` | No errors |
| 3 | `npm test` | 51 files, 327 tests pass |
| 4 | `npm run build` | `✓ built`. The web build lists separate files `hash.worker-*.js`, `docx-preview-*.js` and `exceljs.min-*.js`: they load only when used |
| 5 | `npm run test:integration` | 15 files, 126 tests pass (the stack must be up and seeded) |

Tests that cover the M2 rules:

| Rule | Test |
|---|---|
| **Carried over from M0 (Step 0.1): the EICAR test file is refused as infected by the real ClamAV container through the Upload Events handler** | `tests/integration/upload-events.test.ts` "EICAR is refused as infected by the real ClamAV" (object deleted, row `infected`, one `file.refused`) |
| A repeated event changes nothing | `upload-events.test.ts` "a repeated event for a refused file…", "a clean file is tagged scan-status=clean…" |
| Size or SHA-256 differs from the row: refused, object deleted, `MISMATCH` | `upload-events.test.ts` "refuses a file whose stored size is smaller…", "refuses bytes that differ from the declared SHA-256…" |
| Upload links, multipart start, re-sign, complete | `tests/integration/uploads.test.ts` (9 tests), `services/docbeam-api/src` unit tests |
| A body larger than declared, or a part with the wrong SHA-256, is refused | `uploads.test.ts` "refuses a body that is larger than the declared size", "refuses a part whose bytes do not match…" |
| `POST /jobs`: every error creates nothing, repeated key, parallel same key, 100 x 20 | `tests/integration/jobs.test.ts` (13 tests) |
| 503 PLATFORM_UNAVAILABLE, then the same key works (D-M2-4) | `jobs.test.ts` "answers 503 PLATFORM_UNAVAILABLE…" |
| Fan-out, and a redelivered job message | `tests/integration/fanout.test.ts` |
| Delivery: same message twice, platform down then back, last two tasks together, FILE_NOT_UPLOADED, CHECKSUM_MISMATCH, UNSUPPORTED_TYPE | `tests/integration/delivery.test.ts` (9 tests) |
| A deploy during a long upload does not cut it (D-M2-17) | `tests/integration/platform-drain.test.ts` |
| Task, Job and Upload DLQ marking; the Upload DLQ also writes `file.refused` with `SCAN_FAILED` (D-M2-19) | `tests/integration/dlq-sweeper.test.ts` |
| Sweeper re-sends a lost job message; daily cleanup with multipart abort | `dlq-sweeper.test.ts` "Sweeper" |
| The web upload queue end to end: hash, links, 101 MiB multipart, Verified, send, delivered | `tests/integration/web-upload.test.ts` |
| 100-file cap, 1 GiB, allowed types, empty file | `web/src/distribute/files.test.ts` |
| Scope, tri-state ticks, 21st destination refused, 100 x 20 = 2,000, Review cross, Send readiness | `web/src/distribute/mapping.test.ts` |
| SHA-256 and part hashes | `web/src/upload/hashing.test.ts` |
| Links in waves of 20, 4 uploads at once, 13-minute re-sign, resume, 400 and 403 refused, 2-second polling, remove aborts, sign-in dialog wait | `web/src/upload/manager.test.ts` |
| Idempotency-Key reused after 503, new after a change | `web/src/distribute/submit.test.ts` |
| Preview iframe has `sandbox=""` and no `src`; PDF and images; 50 MB cap | `web/src/components/Preview.test.tsx` |
| Leave warning while uploading; Send off until verified and mapped | `web/src/components/Distribute.test.tsx` |

### 1.3 By hand in the browser (waiting on the person)

Start the app: `npm run dev -w @docbeam/web`, open <http://localhost:5173>, sign in as `priya.shah@example.com` (password is `SEED_USER_PASSWORD` in `.env`).

Make the test files first:

```bash
mkdir -p ~/m2-files && cd ~/m2-files
printf '%%PDF-1.7\nprotocol\n%%%%EOF\n' > protocol.pdf
printf '%%PDF-1.7\nconsent\n%%%%EOF\n' > consent.pdf
printf 'X5O!P%%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*' > eicar.pdf
printf 'not allowed' > setup.exe
head -c 120M /dev/urandom > big.pdf && printf '%%PDF-1.7\n' | dd of=big.pdf conv=notrunc 2>/dev/null
```

Also copy any small `.docx`, `.xlsx` and `.png` into the folder.

| # | Do | Expect | Done |
|---|---|---|---|
| 1 | Before adding files, look at the Destinations tree | Boxes cannot be ticked. Text: `Ticking a folder sends your files there`. Documents: `No documents yet` | waiting |
| 2 | Click **Click to browse**, pick `protocol.pdf`, `consent.pdf`, `setup.exe` | Two rows. A red **Not added** box: `setup.exe: This type is not allowed…`. Dismiss it with the cross | waiting |
| 3 | Watch the status of the two PDFs | `Preparing`, `Uploading…`, `Checking for malware`, then `Verified` (a few seconds). Steps at the top: `Add files` done, `Map destinations` current | waiting |
| 4 | Drag `big.pdf` onto the drop area | `Uploading parts n/8` counts up with a bar, then `Checking for malware`, then `Verified`. While it uploads, try to reload the page | The browser asks before it lets the page go. Cancel the prompt | waiting |
| 5 | Add `eicar.pdf` | `Checking for malware`, then `Refused: malware found`. Its name is struck through, its box is locked, `Will not be sent`. The bottom bar says `1 file was refused for malware: remove to continue` and Send is off | waiting |
| 6 | Remove `eicar.pdf` with its cross | The row goes. The first check is green again | waiting |
| 7 | Tick `IRB approvals` (Cardio, open the binder first) | The banner says `Ticking a folder sends all 3 files there`. The folder shows `3 files`. Each file shows a chip `IRB approvals`. Destinations: `1 of 20 destinations`. The left card: 3 files, 1 destination, 3 deliveries | waiting |
| 8 | Click the name `protocol.pdf` (Map only this file). Tick `Protocol amendments` | Banner turns amber: `…sends the 1 selected file there`, with **Use all files**. Only `protocol.pdf` gets the second chip, so it shows `IRB approvals` and `Protocol amendments`. The tree shows `1 file` next to `Protocol amendments` and `3 files` next to `IRB approvals` | waiting |
| 9 | Click **Use all files** | Banner back to `all 3 files`. `Protocol amendments` shows a dash (mixed): only one of three files goes there | waiting |
| 10 | In **Review**, click the cross next to `protocol.pdf` under `Protocol amendments` | Toast: `protocol.pdf will not go to Protocol amendments.` The card for that folder disappears (no file left) | waiting |
| 11 | In **Review**, click **Preview** next to `consent.pdf` | A dialog with the PDF in the browser's viewer. Footer: `Shown from the copy in your browser. Nothing has been sent yet.` Press Esc: it closes. In DevTools, Network: no request was made | waiting |
| 12 | Preview the `.docx`, then the `.xlsx` and the `.png` | DOCX and XLSX show as read-only pages. In DevTools, Elements: the preview `<iframe>` has `sandbox=""` and a `srcdoc` attribute, no `src` | waiting |
| 13 | Tick 20 folders (or Load Team folders as `load.user@example.com`), then try a 21st | The 21st stays unticked. Toast: `A distribution can have at most 20 destinations.` | waiting |
| 14 | In a terminal: `docker compose stop platform`. Then click **Send** | Button shows `Sending...`, then the page says `The platform is not answering. Try again.` The files, ticks and Review stay as they were | waiting |
| 15 | `docker compose start platform`, wait for `healthy`, click **Send** again | Toast `Distribution 1a2b3c4d sent. N deliveries queued.` The page clears. (The job id is the first 8 characters; the retry used the same Idempotency-Key, so only one job exists: `docker compose exec postgres psql -U postgres -d docbeam_db -c "select count(*) from jobs"` shows one more than before) | waiting |
| 16 | Stop the platform **during** deliveries: choose 3 files x 5 folders, Send, immediately `docker compose stop platform`, wait 60 seconds, `docker compose start platform` | Deliveries are retried with growing gaps. `docker compose exec postgres psql -U postgres -d docbeam_db -c "select status, count(*) from tasks where job_id = (select id from jobs order by queued_at desc limit 1) group by 1"` ends with 15 tasks `completed`, none `failed` | waiting |
| 17 | Sign in as `priya.shah@example.com` again and open the destination tree in the platform: `docker compose exec postgres psql -U postgres -d platform_db -c "select name, binder_id from documents order by created_at desc limit 10"` | One row per delivery, named after the file | waiting |
| 18 | Click **Clear** with files on the page | Everything goes: files, ticks, Review | waiting |
| 19 | Sign out with files on the page, sign in again | The page is empty (nothing from the last user stays) | waiting |

Record each of these as YES in `M2-RESULTS.md` only after the person reports it.

### 1.4 Checks from the command line

```bash
set -a; . ./.env; set +a
# The EICAR file is refused by the real scanner (the same test the YES/NO check names):
npx vitest run -c vitest.integration.config.ts tests/integration/upload-events.test.ts
# Stop the platform mid-run and watch the backlog drain (the same as 1.3 step 16, without the browser):
npx vitest run -c vitest.integration.config.ts tests/integration/delivery.test.ts -t "platform is down"
# The Upload DLQ marks a file and writes the audit event:
npx vitest run -c vitest.integration.config.ts tests/integration/dlq-sweeper.test.ts -t "Upload DLQ"
```

Expect each run to end with every test passed.

## 2. Deploy to dev on AWS (about 6 to 8 hours up, about 3 to 5 USD)

The person says yes before each push, apply and task run. The README "Build dev" block holds the same commands.

| # | Command | Expect |
|---|---|---|
| 1 | `aws sts get-caller-identity --query Arn --output text` | `…:user/anantim-admin` |
| 2 | `gh variable list` | `ALARM_EMAIL` is set. `ECS_DEPLOY_ENABLED` is `true`. `LAMBDA_DEPLOY_ENABLED` is not set yet. `INFRA_APPLY_ENABLED` is `false` |
| 3 | `export IMAGE_TAG=$(git rev-parse --short=12 HEAD)` and `git status --short` | Tag printed, tree clean |
| 4 | `export TF_VAR_alarm_email=<the ALARM_EMAIL address>` | (not printed) |
| 5 | `terraform -chdir=infra/envs/dev init -reconfigure -backend-config="bucket=docbeam-tfstate-346208529537"` | `successfully initialized` |
| 6 | `terraform -chdir=infra/envs/dev apply -target=module.ecr -var image_tag=$IMAGE_TAG` | One repository per image, including `upload-events`. `Apply complete!` |
| 7 | `for s in auth platform docbeam-api; do scripts/push-image.sh dev $s docker/service.Dockerfile --build-arg SERVICE=$s; done` | Three image URIs |
| 8 | `scripts/push-image.sh dev db-bootstrap docker/db-bootstrap/Dockerfile` | One image URI |
| 9 | `scripts/push-image.sh dev upload-events workers/upload-events/Dockerfile` (**before** the full apply, about 1 GB, 5 to 10 minutes) | `…/docbeam-dev/upload-events:<sha>` |
| 10 | `terraform -chdir=infra/envs/dev plan -var image_tag=$IMAGE_TAG -var upload_events_image_tag=$IMAGE_TAG -var jwt_authorizer_enabled=false` | About 250 to add, no error |
| 11 | The same with `apply` (type `yes`) | `Apply complete!`, about 20 to 25 minutes |
| 12 | Open the email sent to the `ALARM_EMAIL` address and click **Confirm subscription** | `Subscription confirmed` page. SNS shows the subscription as `Confirmed` |
| 13 | `scripts/run-db-bootstrap.sh dev` | `exit code: 0` |
| 14 | `scripts/run-task.sh dev auth signing-key` | `signing key written`, `exit code: 0` |
| 15 | `R=346208529537.dkr.ecr.ap-southeast-2.amazonaws.com/docbeam-dev; for s in auth platform docbeam-api; do scripts/deploy-service.sh dev $s $R/$s:$IMAGE_TAG; done` | Each ends `Deployed … to docbeam-dev-<service>` |
| 16 | `scripts/check-internal.sh dev` | Three `200` lines |
| 17 | `npm run build` then `for w in fanout delivery dlq sweeper; do scripts/deploy-lambda.sh dev $w workers/$w/dist/lambda; done` | Each prints `Deployed` (code hash changed from the placeholder) |
| 18 | `scripts/deploy-lambda.sh dev upload-events $R/upload-events:$IMAGE_TAG` | Skips: it already runs this image |
| 19 | `terraform -chdir=infra/envs/dev apply -var image_tag=$IMAGE_TAG -var upload_events_image_tag=$IMAGE_TAG` (type `yes`) | The authorizer and the routes are added. `Apply complete!` |
| 20 | `scripts/deploy-web.sh dev` | `Deployed to https://<id>.cloudfront.net` |
| 21 | `terraform -chdir=infra/envs/dev plan -var image_tag=$IMAGE_TAG -var upload_events_image_tag=$IMAGE_TAG` | `No changes.` |
| 22 | After the person sees the Lambdas exist: `gh variable set LAMBDA_DEPLOY_ENABLED --body true` | The `workers` workflow now deploys on a merge |

Notes from the first run (see M2-RESULTS section 2):
- From an agent session `terraform apply` cannot ask for `yes` (no stdin). Add `-auto-approve` after the person has approved the command.
- `push-image.sh` builds with `--provenance=false --sbom=false`. Without that BuildKit pushes an OCI index and Lambda refuses the Upload Events image (`The image manifest, config or layer media type … is not supported`). ECR tags are immutable, so a rejected image needs a new tag: the Upload Events tag can differ from the service tag (`-var upload_events_image_tag=<tag>`).
- The platform task is 1 vCPU and 2 GB with a limit of 6 ingests at once (D-M2-22). After a platform code change push a new image tag, `apply`, then `scripts/deploy-service.sh dev platform $R/platform:<new tag>`; the service picks up the latest task definition.

## 3. Verify on dev

`APP=$(terraform -chdir=infra/envs/dev output -raw app_url)`. Read the seed password into a variable from Secrets Manager (`docbeam-dev/seed/user-password`); never paste it into a file or the chat.

| # | Check | Expect |
|---|---|---|
| 0 | **First, after the first upload on dev: the checksum comes back from real S3.** The Object Store policy lets only the four service roles read objects (D-M2-18), so the admin user gets `403` on `head-object`. Use Delivery, which makes the same `HeadObject` with `ChecksumMode ENABLED`: upload one small PDF and the 120 MB file through the dev API (one to a folder each), send them, then read the log: `aws logs tail /aws/lambda/docbeam-dev-delivery --since 10m` | `task delivered` for both. The Delivery Lambda has no `S3_CHECKSUM_OPTIONAL` on AWS, so it fails a task whose staged object has no matching SHA-256 (`CHECKSUM_MISMATCH`, D-M2-15). `task delivered` therefore proves S3 returned the SHA-256 for the POST object and the composite value for the 8-part one. **If a task fails with `CHECKSUM_MISMATCH`, stop and report**: the design would have to change |
| 1 | Browser at `$APP`: repeat section 1.3 steps 1 to 13 | Same results. The 120 MB file uploads in 8 parts |
| 2 | **A swapped upload body is refused** (LocalStack does not enforce this): run the commands below | The wrong bytes give `400` (BadDigest), the right bytes give `204`. This is the check the local suite cannot make |
| 3 | EICAR through the page (step 5 of 1.3) | `Refused: malware found`. CloudWatch Logs `/aws/lambda/docbeam-dev-upload-events`: `file refused` with `reason MALWARE` |
| 4 | The 120 MB file | `Checking for malware` can take a minute. Log of the Upload Events Lambda shows the scan time. No timeout |
| 5 | Send 3 files x 3 folders | Toast with the job id. In CloudWatch Logs `/aws/lambda/docbeam-dev-delivery`: nine `task delivered` lines |
| 6 | Documents in the platform (there is no database shell on AWS, so read the log): `aws logs tail /docbeam/docbeam-dev/platform --since 10m` | Nine request lines for `/documents` with status 201 |
| 7 | SQS (Console, read only), queues `docbeam-dev-job`, `-task`, `-upload-events` and their `-dlq` queues | Main queues at 0 messages. Every DLQ at 0 |
| 8 | CloudWatch, Alarms | Four alarms, state `OK`: `docbeam-dev-job-dlq-not-empty`, `…-task-dlq-not-empty`, `…-upload-events-dlq-not-empty`, `docbeam-dev-delivery-error-rate` |
| 9 | EventBridge, Scheduler, schedules `docbeam-dev-sweeper-*` | Two schedules: every minute, and daily |
| 10 | S3, `docbeam-dev-object-store-<account id>`, Properties, Event notifications | One for `staging/` to the upload-events queue. Objects under `staging/` carry the tag `scan-status=clean` after a scan |
| 11 | **Stop the platform mid-run.** A 3 x 5 distribution (15 tasks) is delivered in a few seconds, before the stop takes effect, and so is 30 x 5. Use **100 small files to all 14 destinations (1,400 tasks)**: send, then at once `aws ecs update-service --cluster docbeam-dev-cluster --service docbeam-dev-platform --desired-count 0 --query 'service.desiredCount'`, wait 5 minutes, then `--desired-count 1` (ask first: this changes AWS). Count with `aws logs tail /aws/lambda/docbeam-dev-delivery --since 30m \| grep -c "task delivered"` | Some tasks are delivered before the stop; the rest go back to the queue (`temporary delivery error`) and are retried. After the platform is `1/1`, every task is delivered exactly once (1,400 distinct task ids). DLQs stay at 0 because the retries span about 17 minutes |
| 11b | **Stress: 50 large deliveries at once** (the Delivery cap, D-M2-22): upload 5 files of 120 MB, send them to 10 destinations. Then `aws cloudwatch get-metric-statistics --namespace AWS/ECS --metric-name MemoryUtilization --dimensions Name=ClusterName,Value=docbeam-dev-cluster Name=ServiceName,Value=docbeam-dev-platform --start-time <start> --end-time <end> --period 60 --statistics Maximum` (same for `CPUUtilization`) | All 50 tasks `task delivered`, none `retries exhausted`, no platform task stopped with exit 137, peak `MemoryUtilization` under 80%. Some `The platform answered 503 PLATFORM_BUSY` retries are normal (the platform takes 6 ingests at once and turns a request away after 30 s of waiting) |
| 12 | A rolling deploy during an ingest: upload one 120 MB file, start `scripts/deploy-service.sh dev platform $R/platform:$PLATFORM_TAG --force`, and send the file to 14 destinations about 30 seconds after `Updating` is printed | The deploy ends `Deployed …`. All 14 tasks are delivered and the Task DLQ stays at 0. The old task drains for up to 120 seconds |
| 13 | Security group of the Delivery Lambda, outbound and the ALB group inbound | The ALB group allows the Delivery group only on ports 3001 and 3002 |
| 14 | `scripts/deploy-lambda.sh dev fanout workers/fanout/dist/lambda` (second run) | Skips: the package hash is unchanged |
| 15 | Send a distribution with the page's Network tab open | `POST /api/jobs` answers `201` in well under a second. (The 500 ms p99 is measured in M5, check 5.1) |
| 16 | **CORS preflight on the dev bucket** (the browser makes this call before every upload; run the commands below) | For each of `POST`, `PUT`, `GET` and `DELETE`: `HTTP/2 200` and `access-control-allow-origin: https://<id>.cloudfront.net` (the exact origin sent). The `DELETE` preflight is the multipart abort link, which the page calls when a file is removed mid-upload. A call with `Origin: https://evil.example` has no `access-control-allow-origin` header |

Commands for check 16:

```bash
ORIGIN=$(terraform -chdir=infra/envs/dev output -raw app_url)      # https://<id>.cloudfront.net
BUCKET=docbeam-dev-object-store-$(aws sts get-caller-identity --query Account --output text)
for M in POST PUT GET DELETE; do
  echo "== $M"
  curl -si -X OPTIONS "https://$BUCKET.s3.ap-southeast-2.amazonaws.com/" \
    -H "Origin: $ORIGIN" -H "Access-Control-Request-Method: $M" \
    -H 'Access-Control-Request-Headers: content-type,x-amz-checksum-sha256' | grep -i '^HTTP\|access-control'
done
curl -si -X OPTIONS "https://$BUCKET.s3.ap-southeast-2.amazonaws.com/" \
  -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: PUT' | grep -i '^HTTP\|access-control'
```

### 3.1 Browser steps on dev (for the person)

Open `$APP` (the `app_url` output, `https://<id>.cloudfront.net`) in a browser. Password: `aws secretsmanager get-secret-value --secret-id docbeam-dev/seed/user-password --query SecretString --output text` in your own terminal; do not paste it anywhere. Have these files ready: a small PDF, a small `.docx`, a PNG, a PDF of about 120 MB, and `eicar.pdf` (made as in section 1.3 step 5). Keep DevTools open on the **Console** and **Network** tabs.

| # | Do this | Expect | Result |
|---|---|---|---|
| 1 | Sign in as `anantim.patil@example.com` | Header `Anantim Patil`, and `Cardio, Oncology, Neuro`. The tree shows all three teams | waiting |
| 2 | Open **Distribute**. Add the small PDF, the `.docx`, the PNG and the 120 MB PDF | Each shows `Checking`, `Uploading` (the 120 MB one counts parts up to 8 of 8), `Checking for malware`, then `Ready`. No red line in the Console, and no CORS error | waiting |
| 3 | Add `eicar.pdf` | `Refused: malware found`; Send stays off until you remove it. Remove it | waiting |
| 4 | Tick **Cardio / IRB approvals**, **Oncology / Ethics committee** and **Neuro / Site approvals** for all ready files | Review lists each file with its three folders; the `This distribution` card counts files, destinations and deliveries | waiting |
| 5 | Preview the `.docx` and the PDF | A dialog shows each; for the DOCX the `<iframe>` has `sandbox=""` | waiting |
| 6 | Click **Send** | A toast `Distribution <8 characters> sent. N deliveries queued.`; the page clears. In the Network tab `POST /api/jobs` is `201` | waiting |
| 7 | **Remove a big file mid-upload.** Add the 120 MB PDF again; when it says `Uploading` and some parts are done, click **Remove** (the cross) on it | The row goes. In the Network tab a `DELETE` to `…s3.ap-southeast-2.amazonaws.com/…?uploadId=…` answers `204`, and the preflight before it is `200`. **No CORS error in the Console** | waiting |
| 8 | Add the 120 MB file again, and while it uploads reload the page | The browser asks before leaving (`Leave site?`). Cancel and let it finish | waiting |
| 9 | Sign out and in again | The page is empty | waiting |

Afterwards, in your terminal: `aws logs tail /aws/lambda/docbeam-dev-delivery --since 15m` shows 12 `task delivered` lines for step 6 (4 files x 3 folders).

Commands for check 2:

```bash
TOKEN=$(curl -s -X POST $APP/api/auth/login -H 'content-type: application/json' \
  -d "{\"email\":\"priya.shah@example.com\",\"password\":\"$SEED_PW\"}" | jq -r .accessToken)
D=$(mktemp -d)
printf '%%PDF-1.7\nfile A\n' > $D/a.pdf; printf '%%PDF-1.7\nfile B\n' > $D/b.pdf     # same length, different bytes
SHA=$(sha256sum $D/a.pdf | cut -d' ' -f1); SIZE=$(stat -c%s $D/a.pdf)
curl -s $APP/api/uploads -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"files\":[{\"name\":\"a.pdf\",\"sizeBytes\":$SIZE,\"contentType\":\"application/pdf\",\"sha256\":\"$SHA\"}]}" > $D/up.json
URL=$(jq -r '.uploads[0].post.url' $D/up.json)
ARGS=(); while IFS= read -r kv; do ARGS+=(--form-string "$kv"); done \
  < <(jq -r '.uploads[0].post.fields | to_entries[] | "\(.key)=\(.value)"' $D/up.json)
curl -s -o /dev/null -w 'wrong bytes: %{http_code}\n' "${ARGS[@]}" -F "file=@$D/b.pdf" "$URL"   # expect 400
curl -s -o /dev/null -w 'right bytes: %{http_code}\n' "${ARGS[@]}" -F "file=@$D/a.pdf" "$URL"   # expect 204
rm -r "$D"
```

## 4. Prod (to run later)

Never from a session (D-G3). After M5 and the move to the Paid plan, from `main` in GitHub Actions with the typed input `deploy-prod`.

| # | Check | Expect |
|---|---|---|
| 1 | Workflows `workers`, `upload-events-image`, `docbeam-api`, `platform`, `infra` | Green. The Lambda deploy jobs run only after `LAMBDA_DEPLOY_ENABLED` is `true` |
| 2 | Lambda, `docbeam-prod-delivery` | Connects through RDS Proxy (host name contains `proxy`) |
| 3 | SNS | The alarm subscription is `Confirmed` |
| 4 | Send a small test distribution to a test team | Delivered. DLQs at 0 |
| 5 | ECS, `docbeam-prod-platform` | Stop timeout 120 s; target group deregistration delay 120 s |

## 5. Tear down

```bash
export TF_VAR_alarm_email=$(gh variable get ALARM_EMAIL)
terraform -chdir=infra/envs/dev destroy -var image_tag=$IMAGE_TAG -var upload_events_image_tag=$IMAGE_TAG
```

Expect `Destroy complete!`. Then `terraform -chdir=infra/envs/dev state list` prints nothing, and the repositories, the cluster, the queues and the RDS instance are gone in the console. Dev costs about 4.5 USD a day while it is up.
