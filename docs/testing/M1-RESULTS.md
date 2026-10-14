# M1 results

Evidence for `docs/testing/M1-TESTING.md`. Run on 2026-10-14 on the laptop (WSL2, Docker Desktop).

## 1. Local

### 1.1 Stack

| Check | Result |
|---|---|
| `scripts/local-env.sh` | `.env is ready` |
| `docker compose down -v && docker compose up -d --build --wait` from nothing | exit 0. auth, platform, docbeam-api, postgres, localstack, clamav, workers, ws-local `healthy` |
| `docker compose run --rm seed` | exit 0, two `seed applied` lines (the seed has its own profile: CI showed that `up --wait` fails on a container that exits, D-M1-14) |
| Seed, first run | `demo.json`: teamsChanged 3, bindersChanged 5, foldersChanged 9, membersAdded 4, membersRemoved 0, skippedEmails 0. `dev-load.json`: teamsChanged 50, bindersChanged 100, foldersChanged 1500, membersAdded 50 |
| Seed, second run (`docker compose run --rm seed`) | Every count 0 for both files |

### 1.2 Tests

| Command | Result |
|---|---|
| `npm run lint` | clean |
| `npm run typecheck` | clean (services, shared, web) |
| `npm test` | 25 test files, 93 tests passed |
| `npm run build` | all workspaces built; web `dist/assets/index-*.js` 235 kB (74 kB gzip) |
| `npm run test:integration` | 8 test files, 75 tests passed (includes the parallel wrong-password test added after the review question) |

Integration files and counts from the last run: `auth.test.ts` 21, `platform.test.ts` 14, `ingest.test.ts` 11, `docbeam-db.test.ts` 5, plus the M0 files (`services`, `postgres`, `localstack`, `workers`).

### 1.4 Command line through the Vite proxy

```
no token: 401
priya teams: Cardio,Oncology
{"error":{"code":"NOT_FOUND","message":"Not found."}} -> 404      (Neuro binder, Priya's token)
```

The login response carries `set-cookie: docbeam_refresh=…; Max-Age=43200; Path=/api/auth; HttpOnly; Secure; SameSite=Strict`.

### 1.3 Browser checks: YES (done by the person, 2026-10-14)

Evidence, as reported by the person:

- **Local:** register; sign in as all four seeded users; team visibility (Priya sees Cardio and Oncology, not Neuro); a new user with no teams sees the empty state; refresh cookie `Path=/api/auth`, `HttpOnly`, `Secure`, `SameSite=Strict`, `Max-Age 43200`, through CloudFront; F5 keeps the session; 5 wrong passwords, then the right one is refused with the same message; the "Your sign-in has ended" dialog keeps the ticks and "Signed in again." appears.
- **Dev** (`https://d2ii4puto0s1y9.cloudfront.net`): sign-in, team visibility and the cookie.

Not named in that report, and so covered only by `Destinations.test.tsx`, `selection.test.ts` and `session.test.ts`: the 21st tick in a browser, the filter, the single refresh with two tabs open, and the dialog on dev. They are not recorded as a separate result.

## 2. Deploy to dev on AWS (2026-10-14, one session, about 1 hour 30 minutes of AWS work so far)

Account `346208529537`, region `ap-southeast-2`. Identity `user/anantim-admin`. Tag `2d59b80efe69` for the first build, `2f825256fee7` after the fixes below.

| # | Step | Result |
|---|---|---|
| 4 | `terraform apply -target=module.ecr` | Five repositories created |
| 5-6 | `scripts/push-image.sh` for auth, platform, docbeam-api, db-bootstrap | Four `…/docbeam-dev/<name>:2d59b80efe69` |
| 8 | First full `terraform apply` | **Failed** after 153 resources: `CreateAuthorizer … Invalid issuer … Issuer must have a valid discovery endpoint`. API Gateway reads the issuer's OpenID configuration at creation, and the Auth Service was not up yet. Fixed with `jwt_authorizer_enabled` (D-M1-13) |
| 8 | Apply again with `-var jwt_authorizer_enabled=false` | `Apply complete!`. The four protected routes were not created |
| 9 | `scripts/run-db-bootstrap.sh dev` | three `database ready`, six `role`, `bootstrap finished`, `exit code: 0` |
| 10 | `scripts/run-task.sh dev auth signing-key` | `signing key written`, `exit code: 0` |
| 11 | `scripts/deploy-service.sh dev auth`, `platform`, `docbeam-api` | Each `Running migrations`, `Updating`, `Deployed`. Platform also `Running the seed for platform` |
| 12 | `scripts/check-internal.sh dev` (first try) | **Failed**: `jq` read the probe's `-e` as its own option. Fixed in `scripts/run-task.sh` |
| 12 | `scripts/check-internal.sh dev` | `3001 200 {"status":"ok","service":"auth"}`, `3002 200 …platform`, `3003 200 …docbeam-api`; `exit code: 0` |
| 12b | `curl $APP/api/.well-known/openid-configuration`, then apply with the authorizer | issuer `https://d2ii4puto0s1y9.cloudfront.net/api`; `Resources: 5 added` |
| 13 | `scripts/deploy-web.sh dev` | `Deployed to https://d2ii4puto0s1y9.cloudfront.net` |
| 14 | `terraform plan` | `No changes. Your infrastructure matches the configuration.` |

### Defect found and fixed on dev

40 parallel wrong logins to `/api/auth/login` gave **31 answers of 500**. Cause: the pure-JavaScript bcrypt took 1.6 s a hash on the 0.25 vCPU task (`hashSync ms 1606`, 4 parallel compares 5,894 ms) and the login held a transaction open during the compare, so the 2-connection pool ran dry. Fixes (D-M1-13): native `bcrypt` (228 ms on the laptop), password compared before the short transaction, auth task 0.5 vCPU and 1 GB. After redeploying (`2f825256fee7`): 40 requests gave `40 x 401`, then `29 x 401, 11 x 429`. No 500. A good login took 0.82 s.

## 3. Verify on dev

| # | Check | Result |
|---|---|---|
| 1 | `GET $APP/api/teams` with no token | `401` |
| 2 | ALB `RequestCount` over the minute of 33 unauthenticated calls | The API Gateway log shows 33 `401` (30 `GET /teams`, 3 `GET /binders/{binderId}/contents`). The ALB counted 58 and 12 requests in the two minutes before, which equal the login tests (40 + 29 + 1), and 0 in the minute of the 33 calls |
| 3 | `POST $APP/api/auth/token`, `GET $APP/api/internal/users?email=…` | `404`, `404` |
| 4 | `GET $APP/api/.well-known/openid-configuration` | `{"issuer":"https://d2ii4puto0s1y9.cloudfront.net/api","jwks_uri":"https://d2ii4puto0s1y9.cloudfront.net/api/.well-known/jwks.json"}` |
| 5 | Login as Priya | `200`, `set-cookie: docbeam_refresh=<redacted>; Max-Age=43200; Path=/api/auth; HttpOnly; Secure; SameSite=Strict` |
| 6 | `GET /api/teams` with her token | `Cardio,Oncology` |
| 7 | `GET /api/binders/<Neuro binder>/contents` with her token | `404` |
| 7b | `GET /api/teams` with `Bearer abc.def.ghi` | `401` |
| 7c | Load user, `GET /api/teams` | 50 teams in 0.38 s through CloudFront and the gateway |
| 8 | 40 parallel wrong logins, twice | `40 x 401`, then `29 x 401 + 11 x 429` (after the fix; before it, 31 x 500) |
| 9 | Browser | Done by the person: sign-in, team visibility and the cookie on dev (see 1.3) |
| 10 | ECS services | `docbeam-dev-auth`, `-platform`, `-docbeam-api`: 1 running, 1 desired each |
| 11 | Target groups | auth `healthy`, platform `healthy`, docbeam-api `healthy` |
| 12 | API Gateway routes | 10 routes, no `ANY`, no `$default`. Six `NONE` (four auth routes, JWKS, OpenID), four `JWT` (teams, binders, binder contents, folder contents) |
| 12b | Stage throttles | default 50 and 100; `POST /auth/login` and `POST /auth/refresh` 5 and 10 |
| 13 | CloudFront behaviours | `/api/*` with 7 allowed methods; default behaviour serves the web app (`index.html` 200 on `/` and on `/some/page`) |
| 14 | RDS | `docbeam-dev-postgres`, `PubliclyAccessible: False` |
| 15 | Seed log | See check 16 |
| 16 | `scripts/run-task.sh dev platform seed` again | `demo.json` and `dev-load.json`: every count 0, `exit code: 0` |

## 4. Prod

Not run (never from a session). `terraform plan` for prod: `Plan: 182 to add, 0 to change, 0 to destroy.`

## 5. Final check (AGENTS.md step 5)

Prompt outputs and the milestone's steps in the TDD, one line each. **NO** lines are listed first in the summary at the end.

| # | Requirement | | Evidence |
|---|---|---|---|
| 1 | Auth: register | YES | `auth.test.ts` "register" (3 tests); `services/auth/src/routes/accounts.ts` |
| 2 | Auth: login, same 401 for every failure | YES | `auth.test.ts` "gives the same 401 for an unknown email and a wrong password" |
| 3 | RS256 user tokens with `kid`, `iss`, `aud`, `token_use`, `name` | YES | `tokens.test.ts`; `auth.test.ts` "returns a 15-minute RS256 token…" |
| 4 | JWKS and OpenID configuration | YES | `app.test.ts`; dev check 4 |
| 5 | Refresh rotation and reuse detection | YES | `sessions.test.ts`; `auth.test.ts` "a used token coming back cancels the whole sign-in" |
| 6 | Logout | YES | `auth.test.ts` "logout cancels the sign-in and clears the cookie" |
| 7 | Pause after 5 wrong passwords | YES | `login-attempts.test.ts`; `auth.test.ts` "pauses sign-in for 15 minutes…" |
| 8 | Service tokens, internal user lookup, four clients seeded by the migrate task | YES | `auth.test.ts` "service tokens and user lookup" (4 clients, 401, 403, 200, 404); `service-clients.test.ts` |
| 9 | Platform: schema, four browse routes, membership in each query, 404 otherwise | YES | `platform.test.ts` "browse: only your own teams" (8 tests); `routes/browse.ts` |
| 10 | Destination check (teamName, path) and user teams routes | YES | `platform.test.ts` "service routes" (4 tests) |
| 11 | `POST /documents`: 201, 200, 403, 404, 422 x2, parallel repeats | YES | `ingest.test.ts` (11 tests) |
| 12 | Seed script and files, 50-team dev seed, safe to re-run, prunes, warns on unknown email | YES | Seed logs (local and dev: second run all 0); `platform.test.ts` "seed script"; the warning is `skippedEmails` in the report and a `warn` log line in `seed-run.ts` |
| 13 | DocBeam API skeleton with database and migrations | YES | `docbeam-db.test.ts` (5 tests); dev check 11 |
| 14 | Edge: HTTP API, JWT authorizer, VPC Link, each route listed one by one | YES | Dev checks 12 (10 routes, no `ANY` or `$default`), 3 (404 on internal routes), 11 |
| 15 | Edge: tight throttling on `/auth/login` and `/auth/refresh` | YES | Dev check 12b (5 and 10); check 8 (429 seen) |
| 16 | Edge: CORS with credentials | YES (accepted deviation) | Configured with credentials from `cors_allowed_origins`: `http://localhost:5173` in dev, none in prod. The CloudFront origin the TDD names cannot be listed (Terraform cycle) and nothing cross-origin calls the gateway. D-M1-12, accepted by the person on 2026-10-14 |
| 17 | Edge: CloudFront `/api/*` behaviour with the prefix stripped | YES | Dev check 13; login through `$APP/api/auth/login` returned 200 |
| 18 | Web: register, sign in, quiet refresh with Web Locks, 12-hour dialog | YES | `session.test.ts`; browser checks by the person, section 1.3 above (register, sign in, F5, dialog keeps the ticks) |
| 19 | Web: lazy tree, select up to 20 | YES | `Destinations.test.tsx`, `selection.test.ts`; team visibility in the browser (section 1.3). The 21st tick in a browser is not in the person's report |
| 20 | Migrations as one-off ECS tasks; the seed after migrations as a deploy step | YES | Dev steps 11: `Running migrations`, `Running the seed for platform`; `scripts/deploy-service.sh` |
| 21 | Unit and integration tests the strategy lists for these parts | YES | 93 and 74 tests; table in the testing document, section 1.2 |
| 22 | `docs/testing/M1-TESTING.md`, `M1-RESULTS.md`, STATUS updated | YES | These files |
| 23 | Demo works locally: register, log in, browse only your own teams | YES | Browser checks by the person (1.3); section 1.4 through the Vite proxy |
| 24 | Demo works on dev | YES | Dev checks 5, 6, 7; the person's browser check on dev |
| 25 | No token: 401 at the gateway | YES | Dev checks 1 and 2 |
| 26 | Another team's binder: 404 | YES | Local 1.4; dev check 7 |
| 27 | Tell the person when to set `ECS_DEPLOY_ENABLED` | YES | In the hand-over message: after the browser check |

**Summary: 0 NO.** Items 16 and 18 were NO until 2026-10-14. The person accepted D-M1-12 (item 16) and did the browser checks (item 18). One note stays on item 19: the 21st tick, the filter and the two-tab lock were not named in the browser report and rest on the component and session tests.

### Added after the PR checks

| Finding | Fix |
|---|---|
| CI `Integration tests`: `docker compose up --wait` exited 1 because the seed container exits | `seed` has a profile and runs with `docker compose run --rm seed` (D-M1-14) |
| CI `Plan dev`: `No value for required variable image_tag` | `image_tag` defaults to `bootstrap` (D-M1-14) |
| A merge while dev is down would turn the deploy jobs red | The deploy jobs check that the ECS service (web: the web bucket output) exists and skip with a notice (D-M1-14) |
| Review question: can parallel wrong passwords get around the pause? | No: see the answer in the PR. New test `auth.test.ts` "parallel wrong passwords cannot get around the pause" |
