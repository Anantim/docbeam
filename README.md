# DocBeam

DocBeam lets clinical trial coordinators send up to 100 files to up to 20 team folders in one action, track every delivery live and download what was delivered.

The design is in `docs/design/`. Build progress is in `docs/STATUS.md`, the plan in `docs/PLAN.md`, and changes to the design in `docs/DECISIONS.md`. Rules for coding agents are in `AGENTS.md`.

## Run it locally

You need Node 22, npm and Docker (Compose v2). Nothing else.

```bash
cp .env.example .env              # safe local defaults only
npm install
docker compose up -d --build --wait   # every container reports healthy
```

| What | Address |
|---|---|
| Auth Service | http://localhost:3001/health |
| Document Platform | http://localhost:3002/health |
| DocBeam API | http://localhost:3003/health |
| ws-local (stand-in for the WebSocket API) | ws://localhost:3004 |
| Web app (dev server, `npm run dev -w @docbeam/web`) | http://localhost:5173 |
| PostgreSQL | localhost:5432 (admin login `postgres`, password in `.env`) |
| LocalStack (S3 and SQS) | http://localhost:4566 |
| ClamAV | localhost:3310 |

Checks:

```bash
npm run lint
npm run typecheck
npm test                  # unit tests
npm run build
npm run test:integration  # needs the Compose stack running
docker compose down -v    # stop and wipe the local data
```

Locally the `workers` container polls the LocalStack queues and runs the same handler code that runs in Lambda. LocalStack is pinned to 4.14, the last image that runs without an auth token (see `docs/DECISIONS.md`, D-M0-5).

## Deploy to AWS

Everything runs in one AWS account, region `ap-southeast-2` (Sydney), on the Free plan. Every resource is created by Terraform; the console is for reading only (ADR-012).

### One-time setup (by hand)

1. **Deploy user (D-G1).** Create the IAM user `docbeam-github-deploy`, make one access key, and store it as the GitHub repository secrets `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. Never put the key in a file or a commit.
2. **GitHub.** Repository variables `AWS_REGION` and `TF_STATE_BUCKET`; environments `dev` and `prod` (prod: `main` only).
3. **State bucket.** `bootstrap/create-state-backend.sh` creates `docbeam-tfstate-<account id>` (versioned, encrypted, private). It does nothing if the bucket exists.

### Switches (repository variables)

| Variable | Turns on | When |
|---|---|---|
| `INFRA_APPLY_ENABLED` | `terraform apply` for dev on merge to `main` | `false` while dev is down |
| `ECS_DEPLOY_ENABLED` | service and web deploy jobs | from M1 |
| `LAMBDA_DEPLOY_ENABLED` | worker and Upload Events deploy jobs | from M2 |
| `ALARM_EMAIL` | the address that gets alarm emails | before M2 |

Deploy jobs are skipped unless their switch is `true`.

### Build dev

```bash
terraform -chdir=infra/envs/dev init -backend-config="bucket=docbeam-tfstate-<account id>"
terraform -chdir=infra/envs/dev apply          # about 20 minutes (RDS and CloudFront)
scripts/push-image.sh dev db-bootstrap docker/db-bootstrap/Dockerfile
scripts/run-db-bootstrap.sh dev                # creates the databases and roles
scripts/deploy-web.sh dev                      # publishes the web app
```

Dev costs about 3 to 5 USD a day while it is up, paid from credits. Tear it down when you are not testing:

```bash
terraform -chdir=infra/envs/dev destroy
```

### Prod

Prod is never applied from a laptop or an agent session. It runs only through the GitHub workflows, by hand: **Actions, pick the workflow, Run workflow from `main`, type `deploy-prod`.** The `prod` environment is limited to `main`. Do this only after M5 passes and the account is on the Paid plan (D-G3).

### Roll back

- **A service (ECS):** run `scripts/deploy-service.sh <env> <service> <previous image uri>`. It registers the older image as a new task definition, runs the migrations (forward-only, so a backward-compatible schema is kept for one deploy) and waits for the service to settle. Or in the console (read only here), copy the previous task definition's image from the service's deployment history.
- **A worker (Lambda):** re-run the `workers` workflow on the previous commit, or `aws lambda update-function-code` with the previous image or zip.
- **The web app:** check out the previous commit and run `scripts/deploy-web.sh <env>`.
- **Infrastructure:** revert the commit and let the `infra` workflow plan and apply, or run `terraform apply` from the previous commit. Read the plan first.

## Folder map

```
services/
  auth/              Auth Service (ECS). Owns auth_db and its migrations/
  platform/          Document Platform (ECS). Owns platform_db, migrations/ and seed/
  docbeam-api/       DocBeam API (ECS). Owns docbeam_db and its migrations/
workers/
  fanout/            Lambda, Job Queue consumer
  delivery/          Lambda, Task Queue consumer
  upload-events/     Lambda container image with ClamAV (ADR-016)
  dlq/               Lambda, reads all three DLQs
  ws/                Lambda, $connect, subscribe and $disconnect
  sweeper/           Lambda, scheduled (ADR-014)
web/                 React and Vite app, served by S3 and CloudFront
packages/
  shared/            JWT check for every service, error shape, shared types, logger
  worker-runtime/    Runs the Lambda handlers against LocalStack queues; ws-local
infra/
  modules/           network, rds, ecr, s3, cloudfront, ecs-cluster, secrets (more come with each milestone)
  envs/dev/          Calls the modules with dev values
  envs/prod/         Calls the modules with prod values
bootstrap/           One-time state bucket script (ADR-012)
docker/              Service and worker Dockerfiles, Postgres and LocalStack init, DB bootstrap
scripts/             Image push, web deploy, DB bootstrap run, ECS deploy
tests/integration/   Integration tests that run on the Compose stack
.github/workflows/   One workflow per service, workers, Upload Events image, infra, CI
docs/                Design, plan, status, decisions and testing records
```

Two rules: `infra/envs/*` never holds resources of its own, and each service keeps its migrations in its own folder (ADR-009).
