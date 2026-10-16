# M3 testing: Track a job

Demo: submit a job, watch counts and rows change live, see failure reasons inline, refresh mid-run without losing anything.

Every check is a command or a click with the expected result. Account `346208529537`, region `ap-southeast-2` (Sydney). Ask before every command that changes AWS. M3 adds the WebSocket API, so on dev Delivery and the DLQ Consumer now push (M2 had no push endpoint).

People in the seed: **Priya Shah** (Cardio, Oncology), **Raj Mehta** (Cardio), **Sam Ito** (Neuro), **Anantim Patil** (all three). Password for every one: `SEED_USER_PASSWORD` in `.env` locally.

## 1. Local

### 1.1 Start the stack

| # | Command | Expect |
|---|---|---|
| 1 | `scripts/local-env.sh` | `.env is ready` |
| 2 | `docker compose up -d --build --wait` | auth, platform, docbeam-api, postgres, localstack, clamav, workers and ws-local are `healthy` |
| 3 | `docker compose run --rm seed` | Two `seed applied` lines. A repeat shows every `…Changed` count at `0` |

### 1.2 Run the tests

| # | Command | Expect |
|---|---|---|
| 1 | `npm run lint` | No output after `eslint .` |
| 2 | `npm run typecheck` | No errors |
| 3 | `npm test` | 68 files, 498 tests pass. (`web/src/upload/hashing.test.ts` has a 5-second limit and can time out when the CPU is busy; it passes on its own and on a second run) |
| 4 | `npm run build` | `✓ built` |
| 5 | `npm run test:integration` | 17 files, 157 tests pass (the stack must be up and seeded) |
| 7 | `npm run test:e2e` (the stack up and seeded; Playwright starts the Vite server itself; needs `npx playwright install chromium` once, and `sudo env "PATH=$PATH" npx playwright install-deps chromium` once on WSL) | 10 tests pass in about 2 minutes. Local only, not in CI (D-M3-11). The tests stop and start the `workers` container and `ws-local`, and always start them again |
| 6 | `terraform fmt -check -recursive infra` and `terraform -chdir=infra/envs/dev validate` and the same for `prod` | No output from fmt; `The configuration is valid.` |

Tests that cover the M3 rules:

| Rule | Test |
|---|---|
| Job status from counts (all pending, started, all completed, with errors, cancelled wins) | `services/docbeam-api/src/tracking.test.ts` "statusOf", `web/src/tracking/apply.test.ts` "statusFromCounts" |
| Retry window: open while running, 24 hours after the first finish, files under 2 days, cancelled never | `tracking.test.ts` "retryState" |
| The user's teams are cached for 60 seconds, per user; a failure is not cached | `services/docbeam-api/src/platform.test.ts` "user teams" |
| Team viewer sees only their team's deliveries, counts, tasks and audit events; an outsider gets 404 | `tests/integration/tracking.test.ts` "GET /jobs, /jobs/:id…", "GET /audit is scoped…" |
| Paging, status filter, `fileExpired` | `tracking.test.ts` (integration) "returns tasks with reasons, filters by status and pages", "marks a delivery whose staged file is past 33 days" |
| **Cancel while deliveries run**: waiting ones CANCELLED, running one finishes, queued messages stop at the claim, the job closes and reads cancelled, audit events | `tracking.test.ts` (integration) "POST /jobs/:id/cancel while deliveries run" |
| Cancel/retry only for the sender (403 NOT_SENDER, 404 for outsiders); NOTHING_TO_CANCEL, JOB_CANCELLED | same file, "answers 409 NOTHING_TO_CANCEL…", "POST /jobs/:id/retry" |
| Retry: only RETRIES_EXHAUSTED and FANOUT_FAILED reset; window closed; nothing to retry; the tasks run again | same file, "POST /jobs/:id/retry" (4 tests) |
| Cancel writes one `task.failed` per task and one `job.cancelled`; nothing is written when none is waiting | `packages/shared/src/task-outcome.test.ts` "as a cancel" |
| `$connect` checks the token (none, bad, service token: 401); the row keeps the token's expiry; `$disconnect` deletes it | `workers/ws/src/handler.test.ts`, `tests/integration/ws.test.ts` "$connect and $disconnect" |
| `subscribe`: sender, team member, outsider refused with the same answer as a missing job; moves from one job to another | `handler.test.ts`, `ws.test.ts` "subscribe" |
| Pushes: a task update reaches the sender and the delivery's team only, with counts each may see; one `job_update` after a cancel; a 410 row is deleted; an expired row gets nothing | `ws.test.ts` "pushes", `packages/shared/src/push.test.ts` |
| Connect, subscribe, wait for the answer, then fetch; reconnect with a back-off; resubscribe and refetch **once**; a new token reconnects | `web/src/live/socket.test.ts`, `web/src/components/StatusPage.test.tsx` "opening a distribution…" |
| A push older than the row or the counts is ignored | `web/src/tracking/apply.test.ts`, `TaskTable.test.tsx` "ignores a push that is older than the row", `StatusPage.test.tsx` "ignores a push older than what is shown" |
| Virtualized table: 2,000 rows, only the window drawn, pages loaded on scroll, push patches in place, reload keeps rows | `web/src/tracking/virtual.test.ts`, `web/src/components/TaskTable.test.tsx` |
| List refreshes every 30 seconds and waits while the tab is hidden | `web/src/tracking/usePolledJobs.test.ts` |
| Retry/Cancel buttons by role and state; confirmation before Cancel; retry banner; team viewer text; cancelled note; not-found card | `StatusPage.test.tsx` "Cancel and Retry" |
| Open by ID takes a full id or a link, not the short id; Mine / My teams | `StatusPage.test.tsx` "the list and Open by ID", `web/src/tracking/route.test.ts` |
| Audit trail filters (Deliveries is two actions), distribution filter, load more | `web/src/components/AuditTrailPage.test.tsx`, `format.test.ts` |
| "+N" popover lists only the hidden folders, closes on Esc, outside click, Tab away | `web/src/components/DestinationChips.test.tsx` |
| Teardown script refuses prod and any bucket not `docbeam-dev-…-<account id>`, never the state bucket, deletes in batches of 1,000 | `tests/scripts/empty-dev-buckets.test.ts` |
| The dev connection budget stays at 79 | `packages/shared/src/db.test.ts` |

### 1.2b Browser tests by Playwright (`tests/e2e/`, `npm run test:e2e`)

| Test | Covers steps of 1.3 |
|---|---|
| `track.spec.ts` "counts and rows change live, and a reload mid-run loses nothing" | 2, 3, 5, 6: send, Pending with 4 Waiting, **reload mid-run** (same distribution, same counts), then the workers start and the counts move to 4 Delivered **with no reload** (a marker set on the page survives) |
| "a team viewer sees only their team's rows, live; an outsider gets not found" | 15 to 19: Raj (Cardio) and Priya in two browser contexts; Raj sees 2 of 4 rows, no Oncology text anywhere, no Cancel or Retry, live updates; Sam gets `Distribution not found` (same for an id that does not exist) and does not see it in My teams; Raj's Audit trail has no Oncology |
| "Cancel: waiting deliveries stop, with a question first" | 10: Keep it going changes nothing; confirm gives 6 `CANCELLED`, chip `Cancelled`, Retry and Cancel off with reasons; starting the workers delivers nothing; the Audit tab shows the cancel |
| "a failure shows its reason in the row, with what the code means" | 7, 8: staged files deleted, `FILE_NOT_UPLOADED` in both rows with the reason (file and destination), the code's meaning as its title, the Failed / Delivered / All filters, Retry off with its reason |
| "Retry sends a failed delivery again" | 11, 12, 13: a delivery marked `RETRIES_EXHAUSTED`, Retry offered with the yellow box, click, back to Delivered with no reload, the Audit tab shows `Retry requested` |
| "the live connection drops mid-run and the page catches up without a reload" | 9: `ws-local` stopped, deliveries run while the page cannot hear them (counts still 0 delivered), `ws-local` started, the page reconnects, subscribes and fetches once and shows 2 Delivered, no reload |
| "the list shows my distributions with their counts" / "the Audit trail page filters by kind of event" | 14, 20: Mine, Open by ID (short id refused, a link opens), the Audit trail's Event filter and the link to a distribution |
| `tooltips.spec.ts` (2 tests) | 22 and the tooltip rules: Send, Clear and the folder tick say why they are off; icon buttons have matching title and aria-label (checked for every button on the page); the "+N" popover (hover, click keeps it open, Esc, click outside, Tab away) lists only the hidden folders |

### 1.3 By hand in the browser (what Playwright cannot judge)

Playwright covers most of the steps below (see 1.2b). What is left for the person is the look and feel, and the 30-second list refresh: **steps 1, 4, 21**, and a quick look at steps 2, 3, 14 and 22 for layout and colours. The rest can be skipped locally and are repeated on dev (section 3).

Start the app: `npm run dev -w @docbeam/web`, open <http://localhost:5173>. Use a normal window for Priya and a private window for Raj. Test files as in `M2-TESTING.md` 1.3 (small PDFs).

| # | Do | Expect | Done |
|---|---|---|---|
| 1 | Sign in as `priya.shah@example.com`. Look at the tabs | **Distribute**, **Status**, **Audit trail** are all enabled | waiting |
| 2 | Distribute: add 3 PDFs, tick two Cardio folders and one Oncology folder, **Send** | Toast `Distribution <8 characters> sent`. The page opens **Status** on the new distribution (address ends `#/status/<id>`) | waiting |
| 3 | Watch the counts and the table | Counts (Delivered, Failed, In progress, Waiting) move without a refresh. Rows go `Waiting` → `Delivered`. The chip goes `Pending`/`In progress` → `Completed`. The Status tab shows a number badge while the job runs | waiting |
| 4 | Click **Copy link**, then Distribute, then Status again | The distribution you sent is in **Mine**. Distribute still holds whatever you had added there (it is hidden, not closed) | waiting |
| 5 | In a terminal: `docker compose stop workers`. Send another distribution (3 files, 2 folders) | The job opens with all 6 `Waiting` | waiting |
| 6 | **Refresh the browser** (F5) | You land on the same distribution with the same counts and rows. Nothing is lost | waiting |
| 7 | Find a staged object and delete it (this will fail one delivery): `aws --endpoint-url http://localhost:4566 s3 ls s3://docbeam-local-object-store/staging/ --recursive` then `aws --endpoint-url http://localhost:4566 s3 rm s3://docbeam-local-object-store/staging/<one of those keys>`. Then `docker compose start workers` | Rows change live. One row shows `Failed`, the code `FILE_NOT_UPLOADED` and the reason in the row (file, destination, detail). The other five are `Delivered`. The chip becomes `Completed with errors` | waiting |
| 8 | Filter by **Failed** (then **All**) | Only the failed row shows, and the counts on the chips match | waiting |
| 9 | **Drop the live connection mid-run.** `docker compose stop workers`, send a third distribution, open it, then `docker compose restart ws-local`, then `docker compose start workers` | The page reconnects by itself and ends with every row `Delivered`. (The page fetches once after the reconnect) | waiting |
| 10 | **Cancel.** `docker compose stop workers`, send a distribution (5 files, 2 folders), open it, click **Cancel distribution** | A question: `The 10 deliveries still waiting will stop…`. Choose **Keep it going**: nothing changes. Click again and confirm: toast `…10 deliveries cancelled.`, rows show `Failed` with `CANCELLED`, the chip reads `Cancelled`. `docker compose start workers`: nothing is delivered. **Retry** is not offered; the note says the distribution was cancelled | waiting |
| 11 | **Retry.** On a finished distribution mark one task retryable: `docker compose exec postgres psql -U postgres -d docbeam_db -c "update tasks set status='failed', failure_code='RETRIES_EXHAUSTED', failure_reason='x.pdf to Cardio: the platform did not answer', attempt_count=5 where id=(select id from tasks where status='completed' and job_id='<the full job id>' limit 1)"` (the full id is in the address bar). Reload the page | **Retry failed deliveries** is offered, with the yellow box (`1 delivery failed for a reason a retry can fix…`) | waiting |
| 12 | Click **Retry failed deliveries** | Toast `…1 delivery queued again.` The row goes `Waiting`, then `Delivered`. The chip is `Completed` | waiting |
| 13 | Open the **Audit** tab of that distribution | Events: sent, each delivery, the cancel/retry, with who and when | waiting |
| 14 | Open **Audit trail** | Events grouped by day (`TODAY`), with filters **Event** (All, Sent, Deliveries, Retries, Cancels, Downloads, Uploads) and **Distribution**. Pick Deliveries: only delivery events. Click a short id: that distribution opens | waiting |
| 15 | **Team viewer.** In a private window sign in as `raj.mehta@example.com`. Status → **My teams** | Priya's distributions with deliveries to Cardio are listed, with the count `… deliveries to your teams` (Cardio only) | waiting |
| 16 | Raj opens one that also went to Oncology | He sees only the Cardio rows. The text: `Sent by Priya Shah … You see N deliveries, the ones to Cardio.` No Cancel, no Retry; the note says only Priya can retry. The header lists only Cardio folders | waiting |
| 17 | While Raj has that open, Priya sends a new file to Cardio. Raj watches | Raj's counts and rows change live too | waiting |
| 18 | Raj's **Audit trail** | Priya's `Distribution sent` shows only who and when. Deliveries show for Cardio only. No Oncology delivery, no `File refused` of Priya's | waiting |
| 19 | Private window as `sam.ito@example.com`. Paste a Priya distribution link into **Open by ID** | `Distribution not found` (the same card as for an id that does not exist). His **My teams** list does not show it | waiting |
| 20 | Type the short id (8 characters) into **Open by ID** | A message asks for the full id or a link | waiting |
| 21 | Wait 30 seconds on **Mine** while a distribution runs | The list's counts and bars update by themselves | waiting |
| 22 | Distribute: add files, tick 5 or more folders for one file | Chips `A`, `B` and a button `+3`. Hover it: a small panel lists **only** the hidden folders, grouped by team with the team colour. Move away: it closes. Click it: it stays; press **Esc**, click outside, or Tab away: it closes. Hovering a visible chip shows only its own full path. No other tooltip repeats the list | waiting |

Record each as YES in `M3-RESULTS.md` only after the person reports it.

### 1.4 Checks from the command line

```bash
set -a; . ./.env; set +a
npx vitest run -c vitest.integration.config.ts tests/integration/tracking.test.ts   # 17 tests
npx vitest run -c vitest.integration.config.ts tests/integration/ws.test.ts         # 10 tests
npx vitest run tests/scripts/empty-dev-buckets.test.ts                              # 7 tests
```

Each ends with every test passed.

## 2. Deploy to dev on AWS (about 6 to 8 hours up, about 3 to 5 USD)

The person says yes before each push, apply and task run. M3 changes: the WebSocket API and its Lambda are new, Delivery, DLQ Consumer and the DocBeam API get the push address, the gateway gets six routes, the web build gets `VITE_WS_URL`. The README "Build dev" block holds the first-time order.

| # | Command | Expect |
|---|---|---|
| 1 | `aws sts get-caller-identity --query Arn --output text` | `…:user/anantim-admin` |
| 2 | `gh variable list` | `ALARM_EMAIL` set, `ECS_DEPLOY_ENABLED` `true`, `LAMBDA_DEPLOY_ENABLED` `true`, `INFRA_APPLY_ENABLED` `false` |
| 3 | `export IMAGE_TAG=$(git rev-parse --short=12 HEAD)`; `git status --short` | Tag printed, tree clean |
| 4 | `export TF_VAR_alarm_email=<the ALARM_EMAIL address>` | (not printed) |
| 5 | `terraform -chdir=infra/envs/dev init -reconfigure -backend-config="bucket=docbeam-tfstate-346208529537"` | `successfully initialized` |
| 6 | `terraform -chdir=infra/envs/dev apply -target=module.ecr -var image_tag=$IMAGE_TAG` | Repositories. `Apply complete!` |
| 7 | Push the images: `for s in auth platform docbeam-api; do scripts/push-image.sh dev $s docker/service.Dockerfile --build-arg SERVICE=$s; done`, `scripts/push-image.sh dev db-bootstrap docker/db-bootstrap/Dockerfile`, `scripts/push-image.sh dev upload-events workers/upload-events/Dockerfile` | Image URIs |
| 8 | `terraform -chdir=infra/envs/dev plan -var image_tag=$IMAGE_TAG -var upload_events_image_tag=$IMAGE_TAG -var jwt_authorizer_enabled=false` | About 275 to add, no error |
| 9 | The same with `apply -auto-approve` (after the yes) | `Apply complete!`, about 25 minutes |
| 10 | Confirm the SNS email again (a new topic on every bring-up) | `Subscription confirmed` |
| 11 | `scripts/run-db-bootstrap.sh dev`; `scripts/run-task.sh dev auth signing-key` | `exit code: 0` each |
| 12 | `R=346208529537.dkr.ecr.ap-southeast-2.amazonaws.com/docbeam-dev; for s in auth platform docbeam-api; do scripts/deploy-service.sh dev $s $R/$s:$IMAGE_TAG; done` | `Deployed …` each |
| 13 | `scripts/check-internal.sh dev` | Three `200` lines |
| 14 | `npm run build`; `for w in fanout delivery dlq ws sweeper; do scripts/deploy-lambda.sh dev $w workers/$w/dist/lambda; done` | Each `Deployed` |
| 15 | `scripts/deploy-lambda.sh dev upload-events $R/upload-events:$IMAGE_TAG` | Skips: it already runs this image |
| 16 | `terraform -chdir=infra/envs/dev apply -auto-approve -var image_tag=$IMAGE_TAG -var upload_events_image_tag=$IMAGE_TAG` (with the authorizer) | `Apply complete!` |
| 17 | `scripts/deploy-web.sh dev` | `Deployed to https://<id>.cloudfront.net`. The build used `VITE_WS_URL` from `terraform output -raw ws_url` |
| 18 | `terraform -chdir=infra/envs/dev plan …` | `No changes.` |

## 3. Verify on dev

`APP=$(terraform -chdir=infra/envs/dev output -raw app_url)`; `WS=$(terraform -chdir=infra/envs/dev output -raw ws_url)`. Read the seed password from Secrets Manager (`docbeam-dev/seed/user-password`) into a shell variable; never paste it into a file or the chat.

| # | Check | Expect |
|---|---|---|
| 1 | `curl -sI $APP/favicon.ico` | `HTTP/2 200` and `content-type: image/svg+xml` (it was 403 in M2; D-M3-1) |
| 2 | Token as in M2 check 2, then `curl -s $APP/api/jobs -H "authorization: Bearer $TOKEN"` | `200` and a JSON list (empty or with jobs). Without the header: `401` from the gateway |
| 3 | `npx wscat -c "$WS"` (no token) | Refused: `Unexpected server response: 401` |
| 4 | `npx wscat -c "$WS?token=bad"` | The same `401` |
| 5 | `npx wscat -c "$WS?token=$TOKEN"` and type `{"action":"subscribe","jobId":"<an id of a job you sent>"}` | The answer `{"type":"subscribed","jobId":"…"}`. With a random UUID: `{"type":"subscribe_error","jobId":"…","code":"NOT_FOUND"}` |
| 6 | With check 5 open, send a distribution from the page | `task_update` messages arrive in `wscat` with `counts` |
| 7 | `aws logs tail /aws/lambda/docbeam-dev-ws --since 15m` | `websocket event` lines for `$connect`, `subscribe`, `$disconnect`. No error |
| 8 | Console (Sydney, read only): API Gateway → APIs → `docbeam-dev-ws` | Type WebSocket, routes `$connect`, `subscribe`, `$disconnect`, stage `v1` |
| 9 | Lambda → `docbeam-dev-ws` → Configuration | Reserved concurrency 3, in the VPC, env has `DB_HOST`, `JWKS_URL`, no secret values |
| 10 | Lambda → `docbeam-dev-delivery` → Configuration → Environment, and its role | `WS_MANAGEMENT_ENDPOINT` set; the role allows `execute-api:ManageConnections` on that API only |
| 11 | CloudWatch → RDS `DatabaseConnections` for the instance during a 50-delivery run | Peak at or under 80 (the budget is 79) |
| 12 | Browser at `$APP` as `anantim.patil@example.com`: repeat section 1.3 steps 1 to 4 and 6 to 14 | Same results (use a real Cancel on a large distribution: 100 small files to 14 folders) |
| 13 | **Two browsers.** Normal window: `priya.shah@example.com` sends a distribution to Cardio and Oncology. Private window: `raj.mehta@example.com`, Status → My teams → open it | Raj sees only Cardio rows, with live updates. Sam sees `Distribution not found`. Section 1.3 steps 15 to 20 |
| 14 | **Refresh mid-run on dev.** Send 100 small files to 14 folders (1,400 tasks). While it runs, press F5 twice | The same distribution opens, the table scrolls through 1,400 rows (about 100 loaded at a time), counts keep moving |
| 15 | **Live connection drop.** During a run, DevTools → Network → Offline for 15 seconds, then Online | The page reconnects; counts and rows are right after one reload of the deliveries |
| 16 | After 15 minutes on the page | A new connection is made after the token refresh (Network tab → WS: a new `?token=` request). The page keeps updating |
| 17 | **Cancel during a run** (100 files × 14 folders): click Cancel at about 30% | Waiting deliveries show `CANCELLED`; running ones finish; the chip reads `Cancelled`; nothing is delivered afterwards (Delivery logs show no new `task delivered` for it) |
| 18 | SQS Console (read only) | Task queue drains to 0. DLQs at 0 |
| 19 | **A real push, seen in the browser.** Chrome DevTools → Network → filter `WS`, then open the `…execute-api…/v1?token=…` request → Messages. Send a distribution (100 small files to 14 folders) and open it | `subscribe` goes out and `{"type":"subscribed",…}` comes back **before** the first `GET /api/jobs/<id>/tasks`. Then `task_update` frames arrive, each with `status`, `updatedAt` and `counts`, and the counts on the page change with no reload and no new `GET …/tasks`. Save a screenshot of the frames |
| 20 | **One log line of a 410 cleanup.** Make a connection row whose socket does not exist, then trigger a push to it (commands below) | `aws logs filter-log-events --log-group-name /aws/lambda/docbeam-dev-delivery --filter-pattern '"connection gone"' --start-time <ms>` shows `connection gone (410); row deleted` with `connectionId` `ghost-…`. Paste the line into `M3-RESULTS.md` |
| 21 | A distribution with deliveries more than 33 days old | Not testable in one session; covered by `tracking.test.ts` "marks a delivery whose staged file is past 33 days" and the row message in the table |

Commands for check 20 (a ghost connection: a database row for a socket that API Gateway does not have; the Delivery Lambda's first push to it gets 410, deletes the row and logs the line). `TOKEN` is Priya's access token as in M2 check 2; `JOB` is the full id of a distribution that is still running (send 100 files to 14 folders first):

```bash
WS=$(terraform -chdir=infra/envs/dev output -raw ws_url)            # wss://<id>.execute-api.ap-southeast-2.amazonaws.com/v1
HOST=${WS#wss://}; HOST=${HOST%%/*}
call() { aws lambda invoke --function-name docbeam-dev-ws --cli-binary-format raw-in-base64-out --payload "$1" /tmp/ws-out.json --query StatusCode --output text; cat /tmp/ws-out.json; echo; }
START=$(($(date +%s) * 1000))
call "{\"requestContext\":{\"routeKey\":\"\$connect\",\"connectionId\":\"ghost-1\",\"domainName\":\"$HOST\",\"stage\":\"v1\"},\"queryStringParameters\":{\"token\":\"$TOKEN\"}}"      # {"statusCode":200}
call "{\"requestContext\":{\"routeKey\":\"subscribe\",\"connectionId\":\"ghost-1\",\"domainName\":\"$HOST\",\"stage\":\"v1\"},\"body\":\"{\\\"action\\\":\\\"subscribe\\\",\\\"jobId\\\":\\\"$JOB\\\"}\"}"   # {"statusCode":200}
sleep 20
aws logs filter-log-events --log-group-name /aws/lambda/docbeam-dev-delivery --filter-pattern '"connection gone"' --start-time $START --query 'events[].message' --output text
```

If the distribution has already finished, no push comes: send another and repeat the `subscribe` call with its id. The log line proves the cleanup; `/aws/lambda/docbeam-dev-ws` shows the `subscribe` event for `ghost-1`.

## 4. Prod (to run later)

Never from a session (D-G3). After M5 and the move to the Paid plan, from `main` in GitHub Actions with `deploy-prod`.

| # | Check | Expect |
|---|---|---|
| 1 | Workflows `workers`, `docbeam-api`, `web`, `infra` | Green. `ws` is part of the worker matrix |
| 2 | Lambda `docbeam-prod-ws`, `docbeam-prod-delivery` | `DB_HOST` is the RDS Proxy address. Reserved concurrency for `ws` can be raised then (D-M3-8) |
| 3 | API Gateway `docbeam-prod-ws` | Stage `v1`, routes as in dev |
| 4 | Send a test distribution; open it from a second account in a destination team | Live updates reach both; the outsider gets not found |

## 5. Tear down

```bash
scripts/empty-dev-buckets.sh dev --dry-run   # first: read the two names and the counts; nothing is deleted
scripts/empty-dev-buckets.sh dev      # then: destroy cannot empty large versioned buckets (D-M2-23)
export TF_VAR_alarm_email=$(gh variable get ALARM_EMAIL)
terraform -chdir=infra/envs/dev destroy -var image_tag=$IMAGE_TAG -var upload_events_image_tag=$IMAGE_TAG
```

Expect the dry run to name exactly `docbeam-dev-object-store-<account id>` and `docbeam-dev-platform-files-<account id>` with their counts and end `Dry run: nothing was deleted.` Check the names, then run it for real. Expect the script to end `Done.` and print each bucket as `empty`, and `Destroy complete!`. Then `terraform -chdir=infra/envs/dev state list` prints nothing, `aws s3 ls` shows only `docbeam-tfstate-346208529537`, `aws ecs list-clusters` is empty, and `aws apigatewayv2 get-apis --query 'Items[].Name'` shows no `docbeam-dev-ws`. Dev costs about 4.5 USD a day while it is up.
