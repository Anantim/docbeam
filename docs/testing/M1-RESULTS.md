# M1 results

Evidence for `docs/testing/M1-TESTING.md`. Run on 2026-10-14 on the laptop (WSL2, Docker Desktop). The AWS sections are added when the AWS block has run.

## 1. Local

### 1.1 Stack

| Check | Result |
|---|---|
| `scripts/local-env.sh` | `.env is ready` |
| `docker compose down -v && docker compose up -d --build --wait` from nothing | auth, platform, docbeam-api, postgres, localstack, clamav, workers, ws-local `healthy`; seed `exited (0)` |
| Seed, first run (`docker compose logs seed`) | `demo.json`: teamsChanged 3, bindersChanged 5, foldersChanged 9, membersAdded 4, membersRemoved 0, skippedEmails 0. `dev-load.json`: teamsChanged 50, bindersChanged 100, foldersChanged 1500, membersAdded 50 |
| Seed, second run (`docker compose run --rm seed`) | Every count 0 for both files |

### 1.2 Tests

| Command | Result |
|---|---|
| `npm run lint` | clean |
| `npm run typecheck` | clean (services, shared, web) |
| `npm test` | 25 test files, 93 tests passed |
| `npm run build` | all workspaces built; web `dist/assets/index-*.js` 235 kB (74 kB gzip) |
| `npm run test:integration` | 8 test files, 74 tests passed |

Integration files and counts from the last run: `auth.test.ts` 20, `platform.test.ts` 14, `ingest.test.ts` 11, `docbeam-db.test.ts` 5, plus the M0 files (`services`, `postgres`, `localstack`, `workers`).

### 1.4 Command line through the Vite proxy

```
no token: 401
priya teams: Cardio,Oncology
{"error":{"code":"NOT_FOUND","message":"Not found."}} -> 404      (Neuro binder, Priya's token)
```

The login response carries `set-cookie: docbeam_refresh=…; Max-Age=43200; Path=/api/auth; HttpOnly; Secure; SameSite=Strict`.

### 1.3 Browser checks: NOT RUN by the agent

This session has no browser. The behaviours are covered by `web/src/auth/session.test.ts` (sign in, one refresh and one retry on 401, the ended state, a new tab's quiet refresh), `selection.test.ts` (21st refused), `tree.test.ts` and `Destinations.test.tsx` (lazy levels, filter, path). The clicks in section 1.3 of the testing document still have to be done by the person. This is listed under Known issues in `docs/STATUS.md`.

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
| 9 | Browser | **NOT RUN by the agent** (no browser in this session). Left to the person, see STATUS |
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
