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

## 2 and 3. Dev on AWS

Not run yet. They run as one block, after the person agrees (see the milestone plan, "AWS block").

Read-only checks done before it:

| Check | Result |
|---|---|
| `terraform fmt -check -recursive infra` | clean |
| `terraform validate` in `infra/envs/dev` and `infra/envs/prod` | `The configuration is valid.` |
| `terraform plan -var image_tag=x` in dev | `Plan: 175 to add, 0 to change, 0 to destroy.` No cycle |
| `terraform plan -var image_tag=x` in prod | `Plan: 182 to add, 0 to change, 0 to destroy.` Plan only, never applied |
