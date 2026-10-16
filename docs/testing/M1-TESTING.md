# M1 testing: Browse destinations

Demo: a user registers, logs in and browses only their own teams, binders and folders. A request without a token gets 401 at the gateway. Another team's binder gets 404.

Every check is a command or a click with the expected result. Account `346208529537`, region `ap-southeast-2` (Sydney). Ask before every command that changes AWS.

## 1. Local

### 1.1 Start the stack

| # | Command | Expect |
|---|---|---|
| 1 | `scripts/local-env.sh` | `.env is ready`. `.env` now holds `JWT_PRIVATE_KEY`, four `CLIENT_SECRET_*` and `SEED_USER_PASSWORD` |
| 2 | `docker compose up -d --build --wait` | auth, platform, docbeam-api, postgres, localstack, clamav, workers and ws-local are `healthy` |
| 2b | `docker compose run --rm seed` | Two `seed applied` lines (the seed has its own profile because `up --wait` treats an exited container as a failure) |
| 3 | The `seed applied` lines from step 2b | Two lines. `demo.json`: `teamsChanged 3`, `bindersChanged 5`, `foldersChanged 9`, `membersAdded 7`. `dev-load.json`: `teamsChanged 50`, `bindersChanged 100`, `foldersChanged 1500` |
| 4 | `docker compose run --rm seed` again | Both lines show every `…Changed` and `members…` count at `0` (safe to repeat) |

### 1.2 Run the tests

| # | Command | Expect |
|---|---|---|
| 1 | `npm run lint` | No output after `eslint .` |
| 2 | `npm run typecheck` | No errors |
| 3 | `npm test` | 25 files, 93 tests pass (unit tests, web tests with jsdom) |
| 4 | `npm run build` | `✓ built` for the web app |
| 5 | `docker compose run --rm seed` then `npm run test:integration` | 8 files, 75 tests pass |

Tests that cover the M1 rules:

| Rule | Test |
|---|---|
| 5 wrong passwords pause sign-in for 15 minutes, also when sent in parallel | `services/auth/src/login-attempts.test.ts`, `tests/integration/auth.test.ts` "pauses sign-in…" and "parallel wrong passwords cannot get around the pause" |
| Refresh rotates, a reused token ends the sign-in | `services/auth/src/sessions.test.ts`, `auth.test.ts` "a used token coming back…" |
| `iss`, `aud`, `token_use`, wrong key | `services/auth/src/tokens.test.ts`, `packages/shared/src/jwt.test.ts` |
| Service tokens and user lookup | `auth.test.ts` "service tokens and user lookup" |
| Only your own teams, 404 for another team's binder and folder | `tests/integration/platform.test.ts` "browse: only your own teams" |
| Destination check, 422 for missing and for another team | `platform.test.ts` "service routes" |
| Browse in under 1 s for 50 teams | `platform.test.ts` "browses a user in 50 teams…" |
| Seed is safe to re-run, prunes members, skips unknown emails | `platform.test.ts` "seed script" |
| Ingest: 201, 200, 403, 404, 422, parallel repeats | `tests/integration/ingest.test.ts` |
| DocBeam DB: audit trail append-only, migrations over data | `tests/integration/docbeam-db.test.ts` |
| Token refresh, one retry on 401, sign-in dialog state | `web/src/auth/session.test.ts` |
| 21st destination refused | `web/src/destinations/selection.test.ts` |
| Lazy tree, filter | `web/src/components/Destinations.test.tsx` |

### 1.3 By hand in the browser

Start the web app: `npm run dev -w @docbeam/web`, then open <http://localhost:5173>. The seed password is the value of `SEED_USER_PASSWORD` in `.env`.

| # | Do | Expect |
|---|---|---|
| 1 | Click **Create an account**, enter a name, a new email and a 12-character password, submit | You land on **New distribution**. Header shows your name and no teams. Tree says `You are not in any team yet.` |
| 2 | Click **Sign out** (icon at the top right) | The sign-in page |
| 3 | Sign in as `priya.shah@example.com` | Header: `Priya Shah`, `Cardio, Oncology`. Tree shows Cardio and Oncology, each opened with its binders. No Neuro |
| 4 | Click the arrow next to `CARDIO-301 Regulatory` | `IRB approvals` and `Protocol amendments` appear. Open `Protocol amendments`: `2026` appears |
| 5 | Tick `2026` and `ONC-118 Pharmacy` | Counter reads `2 of 20 destinations`. The left card lists both paths, e.g. `Cardio / CARDIO-301 Regulatory / Protocol amendments / 2026` |
| 6 | Type `pharmacy` in the filter | Only Oncology and `ONC-118 Pharmacy` stay. Type `zzz`: `No binders or folders match.` |
| 7 | Sign out, sign in as `sam.ito@example.com` | Only Neuro and `NEU-207 Regulatory`. Nothing from Cardio or Oncology |
| 8 | Sign out, sign in as `load.user@example.com` | 50 teams, closed. Open `Load Team 01`, then `Regulatory`. Tick 20 destinations, then a 21st | Folders appear in under a second. The 21st stays unticked and a toast says `A distribution can have at most 20 destinations.` |
| 9 | Sign in, wait. In DevTools, Network tab, filter `refresh` | About 14 minutes after sign-in one `POST /api/auth/refresh` (200). No dialog, no reload |
| 10 | Open the app in a second tab | No sign-in page. One quiet refresh, then the tree |
| 11 | In DevTools, Application, Cookies: `docbeam_refresh` | `Path=/api/auth`, `HttpOnly`, `Secure`, `SameSite=Strict`. Not visible to `document.cookie` |
| 12 | In the database, set the sign-in's end to the past: `docker compose exec postgres psql -U postgres -d auth_db -c "update refresh_tokens set expires_at = now() - interval '1 minute'"`. Then wait for the next refresh, or click a team | The dialog **Your sign-in has ended** opens over the page. The ticked destinations are still there. Enter the password: the dialog closes and `Signed in again.` appears |

### 1.4 Checks from the command line

```bash
set -a; . ./.env; set +a
TOKEN=$(curl -s -X POST localhost:5173/api/auth/login -H 'content-type: application/json' \
  -d "{\"email\":\"priya.shah@example.com\",\"password\":\"$SEED_USER_PASSWORD\"}" | jq -r .accessToken)
curl -s -o /dev/null -w '%{http_code}\n' localhost:5173/api/teams                                   # 401: no token
curl -s localhost:5173/api/teams -H "authorization: Bearer $TOKEN" | jq -r '.[].name'                  # Cardio, Oncology
NEURO=$(jq -r '.teams[] | select(.name=="Neuro") | .binders[0].id' services/platform/seed/demo.json)
curl -s -w '\n%{http_code}\n' localhost:5173/api/binders/$NEURO/contents -H "authorization: Bearer $TOKEN"  # 404 NOT_FOUND
```

## 2. Deploy to dev on AWS (one session, about 6 to 8 hours up, about 1.5 to 2 USD)

The person says yes once for the whole block. Tear down at the end (section 5).

| # | Command | Expect |
|---|---|---|
| 1 | `aws sts get-caller-identity --query Arn --output text` | `…:user/anantim-admin` |
| 2 | `export IMAGE_TAG=$(git rev-parse --short=12 HEAD)` and `git status --short` | Tag printed. Tree clean, so the image tags are not `-dirty` |
| 3 | `terraform -chdir=infra/envs/dev init -reconfigure -backend-config="bucket=docbeam-tfstate-346208529537"` | `successfully initialized` |
| 4 | `terraform -chdir=infra/envs/dev apply -target=module.ecr -var image_tag=$IMAGE_TAG` | 1 repository per image created (`Apply complete!`) |
| 5 | `for s in auth platform docbeam-api; do scripts/push-image.sh dev $s docker/service.Dockerfile --build-arg SERVICE=$s; done` | Three lines `…/docbeam-dev/<service>:<sha>` |
| 6 | `scripts/push-image.sh dev db-bootstrap docker/db-bootstrap/Dockerfile` | `…/docbeam-dev/db-bootstrap:<sha>` |
| 7 | `terraform -chdir=infra/envs/dev plan -var image_tag=$IMAGE_TAG -var jwt_authorizer_enabled=false` | `Plan: about 170 to add` (the number can move by a few) |
| 8 | `terraform -chdir=infra/envs/dev apply -var image_tag=$IMAGE_TAG -var jwt_authorizer_enabled=false` (type `yes`) | `Apply complete!`. About 20 minutes. API Gateway reads the issuer's OpenID configuration when it creates the authorizer, so the authorizer and the four protected routes wait for step 12b (D-M1-13). The ECS services start and fail health checks until steps 9 to 11 are done: that is expected |
| 9 | `scripts/run-db-bootstrap.sh dev` | `exit code: 0`, three databases, six roles |
| 10 | `scripts/run-task.sh dev auth signing-key` | Log `signing key written`, `exit code: 0`. A second run logs `signing key already present, nothing written` |
| 11 | `scripts/deploy-service.sh dev auth $(…/auth:$IMAGE_TAG)`, then `platform`, then `docbeam-api` (full image URI as the third argument; `terraform output ecr_repository_urls` shows them) | For auth: `Running migrations`, `Updating`, `Deployed`. For platform: also `Running the seed for platform`. Each ends with `Deployed <image> to docbeam-dev-<service>` |
| 12 | `scripts/check-internal.sh dev` | Three lines `3001 200 {"status":"ok","service":"auth"}`, `3002 200 …`, `3003 200 …`; `exit code: 0` |
| 12b | `curl -s $APP/api/.well-known/openid-configuration`, then `terraform -chdir=infra/envs/dev apply -var image_tag=$IMAGE_TAG` (type `yes`) | The JSON shows `issuer` `$APP/api`. Apply: `Apply complete! Resources: 5 added` (authorizer and four routes) |
| 13 | `scripts/deploy-web.sh dev` | `Deployed to https://<id>.cloudfront.net` |
| 14 | `terraform -chdir=infra/envs/dev plan -var image_tag=$IMAGE_TAG` | `No changes.` |

## 3. Verify on dev

`APP=$(terraform -chdir=infra/envs/dev output -raw app_url)`. The seed password is in Secrets Manager: `aws secretsmanager get-secret-value --secret-id docbeam-dev/seed/user-password --query SecretString --output text` (read it into a variable; never paste it into a file or the chat).

| # | Check | Expect |
|---|---|---|
| 1 | `curl -s -o /dev/null -w '%{http_code}\n' $APP/api/teams` | `401` |
| 2 | CloudWatch, ALB `RequestCount` for `app/docbeam-dev-internal` (use `alb_arn_suffix` output) across the minute of check 1 | No request counted: the gateway refused it |
| 3 | `curl -s -o /dev/null -w '%{http_code}\n' -X POST $APP/api/auth/token -H 'content-type: application/json' -d '{}'` and `…$APP/api/internal/users?email=a@b.c` | `404` for both: not routed |
| 4 | `curl -s $APP/api/.well-known/openid-configuration` | `{"issuer":"$APP/api","jwks_uri":"$APP/api/.well-known/jwks.json"}` |
| 5 | Log in with curl as Priya (`-i`) | `200`, `set-cookie: docbeam_refresh=…; Path=/api/auth; HttpOnly; Secure; SameSite=Strict` |
| 6 | With her token: `GET $APP/api/teams` | Cardio and Oncology |
| 7 | With her token: `GET $APP/api/binders/<Neuro binder id>/contents` | `404 NOT_FOUND` |
| 8 | Send 20 wrong logins in a second to `$APP/api/auth/login` | Some answers are `429` (throttle 5 a second, burst 10) |
| 9 | Browser at `$APP`: repeat section 1.3 steps 3, 5, 7, 8, 10 and 11 | Same results. Priya and Sam see different trees. Cookie path `/api/auth` |
| 10 | AWS Console (Sydney), ECS, cluster `docbeam-dev-cluster` | Services `docbeam-dev-auth`, `-platform`, `-docbeam-api`, each `1/1` running |
| 11 | EC2, Target groups `docbeam-dev-auth`, `-platform`, `-docbeam-api` | Each has 1 healthy target |
| 12 | API Gateway, `docbeam-dev-api`, Routes | 10 routes, no `ANY` and no `$default`. The four platform routes show `JWT` as authorizer |
| 13 | CloudFront, the distribution, Behaviors | `/api/*` with caching disabled and `AllViewerExceptHostHeader`; default behaviour for the web app |
| 14 | RDS, `docbeam-dev`, Connectivity | Not publicly accessible |
| 15 | CloudWatch Logs `/docbeam/docbeam-dev/platform` | `seed applied` lines for `demo.json` and `dev-load.json`, no secrets |
| 16 | `scripts/run-task.sh dev platform seed` (second run) | Every count `0` |

## 4. Prod (to run later)

Never from a session (D-G3). After M5 and the move to the Paid plan, from `main` in GitHub Actions with the typed input `deploy-prod`.

| # | Check | Expect |
|---|---|---|
| 1 | Workflows `auth`, `platform`, `docbeam-api`, `web`, `infra` | Green |
| 2 | `curl -s -o /dev/null -w '%{http_code}\n' https://<prod cloudfront>/api/teams` | `401` |
| 3 | ECS, `docbeam-prod-*` | Each service `2/2` across two zones |
| 4 | Platform log | No `seed applied` lines: `SEED_FILES` is empty until the client's hierarchy exists |
| 5 | Register and sign in with a test account | Works. Tree empty: `You are not in any team yet.` |

## 5. Tear down

```bash
scripts/empty-dev-buckets.sh dev      # first: destroy cannot empty large versioned buckets (D-M2-23)
terraform -chdir=infra/envs/dev destroy -var image_tag=$IMAGE_TAG
```

Expect `Destroy complete!`. Then `terraform -chdir=infra/envs/dev state list` prints nothing, and the ECR repositories, the cluster and the RDS instance are gone in the console. Dev costs about 4.5 USD a day while it is up.
