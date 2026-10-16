# DocBeam

DocBeam lets clinical trial coordinators send up to 100 files to up to 20 team folders in one action, track every delivery live and download what was delivered.

The design is in `docs/design/`. Build progress is in `docs/STATUS.md`, the plan in `docs/PLAN.md`, and changes to the design in `docs/DECISIONS.md`. Rules for coding agents are in `AGENTS.md`.

## Run it locally

You need Node 22, npm and Docker (Compose v2). Nothing else.

```bash
scripts/local-env.sh              # creates .env: safe defaults, plus a local signing key and secrets
npm install
docker compose up -d --build --wait   # every container reports healthy
docker compose run --rm seed          # demo teams, binders, folders and users (Priya, Raj, Sam, Anantim); safe to repeat
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
export IMAGE_TAG=$(git rev-parse --short=12 HEAD)          # clean tree, so the tag is not "-dirty"
export TF_VAR_alarm_email=$(gh variable get ALARM_EMAIL)   # the address that gets alarm emails (it needs `gh` signed in)
B="bucket=docbeam-tfstate-<account id>"
terraform -chdir=infra/envs/dev init -reconfigure -backend-config="$B"
terraform -chdir=infra/envs/dev apply -target=module.ecr -var image_tag=$IMAGE_TAG   # repositories only
for s in auth platform docbeam-api; do
  scripts/push-image.sh dev $s docker/service.Dockerfile --build-arg SERVICE=$s
done
scripts/push-image.sh dev db-bootstrap docker/db-bootstrap/Dockerfile
# Terraform starts the Upload Events Lambda from this image, so it must exist before the apply (about 1 GB, 5 to 10 minutes).
# push-image.sh builds with --provenance=false --sbom=false: with an attestation the image becomes an OCI index and
# Lambda refuses it ("image manifest, config or layer media type ... is not supported"). ECR tags are immutable, so an
# image pushed the wrong way needs a new tag (pass it as upload_events_image_tag below).
scripts/push-image.sh dev upload-events workers/upload-events/Dockerfile
# First apply of a new environment: without the authorizer (D-M1-13), 229 resources, about 20 to 25 minutes.
terraform -chdir=infra/envs/dev apply -var image_tag=$IMAGE_TAG -var upload_events_image_tag=$IMAGE_TAG -var jwt_authorizer_enabled=false
# AWS emails ALARM_EMAIL a "Confirm subscription" link. Click it, or the four alarms send nothing:
#   aws sns list-subscriptions-by-topic --topic-arn <alarm_topic_arn output>   (the subscription ARN stops saying PendingConfirmation)
scripts/run-db-bootstrap.sh dev                # creates the databases and roles
scripts/run-task.sh dev auth signing-key       # writes the token signing key, once
R=<account id>.dkr.ecr.ap-southeast-2.amazonaws.com/docbeam-dev
for s in auth platform docbeam-api; do scripts/deploy-service.sh dev $s $R/$s:$IMAGE_TAG; done   # migrate, seed, update
scripts/check-internal.sh dev                  # /health of each service from inside the network
npm run build                                  # bundles the worker Lambdas
for w in fanout delivery dlq sweeper; do scripts/deploy-lambda.sh dev $w workers/$w/dist/lambda; done   # replaces the placeholder code
scripts/deploy-lambda.sh dev upload-events $R/upload-events:$IMAGE_TAG                # skips: it already runs this image
terraform -chdir=infra/envs/dev apply -var image_tag=$IMAGE_TAG -var upload_events_image_tag=$IMAGE_TAG   # now with the authorizer
scripts/deploy-web.sh dev                      # publishes the web app
gh variable set LAMBDA_DEPLOY_ENABLED --body true   # after the Lambdas exist: the workers workflow deploys on a merge
```

Add `-auto-approve` to a `terraform apply` or `destroy` that runs without a terminal (an agent session), after you have agreed to it. If the Upload Events image was pushed under another tag than the services, pass that tag as `upload_events_image_tag` in every plan, apply and destroy.

Dev costs about 3 to 5 USD a day while it is up, paid from credits. Tear it down when you are not testing. `destroy` needs the same variables as `apply`, or Terraform asks for them:

```bash
terraform -chdir=infra/envs/dev destroy -var image_tag=$IMAGE_TAG -var upload_events_image_tag=$IMAGE_TAG \
  -var alarm_email="$(gh variable get ALARM_EMAIL)"
```

### Prod

Prod is defined in `infra/envs/prod` and in the `deploy-prod` workflows, but it is **not deployed in this project**. This is a portfolio build on the AWS Free plan, and the decision is recorded in M5. The code is there so a deployment would be one reviewed run, never a laptop or an agent session (D-G3): **Actions, pick the workflow, Run workflow from `main`, type `deploy-prod`**, with the `prod` environment limited to `main`. The full visitor-facing README comes in M5.

### Roll back

- **A service (ECS):** run `scripts/deploy-service.sh <env> <service> <previous image uri>`. It registers the older image as a new task definition, runs the migrations (forward-only, so a backward-compatible schema is kept for one deploy) and waits for the service to settle. Or in the console (read only here), copy the previous task definition's image from the service's deployment history.
- **A worker (Lambda):** re-run the `workers` workflow on the previous commit with `force` ticked, or run `scripts/deploy-lambda.sh <env> <function> <bundle-dir | image-uri> --force` with the previous bundle or image. It skips a function that does not exist or already runs that code.
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
  shared/            Code every service and worker uses (src/):
                       limits, constants, errors      the numbers of the design, error codes and the one error shape
                       jwt, service-token             token check for every service; the service token Delivery uses
                       batch, file-types, checksum    batch limits and file allow-list (also used by the web app), SHA-256 helpers
                       db, db-url, lambda-db          database pool and URLs; one connection per Lambda copy
                       secrets, logger                Secrets Manager reads; JSON logger
                       sqs, upload-events             queue helpers; S3 event parsing for the Upload Events Lambda
                       task-outcome, push             the one transaction that ends a task; pushes to WebSocket subscribers
                       browser.ts                     the part of the package the web app imports
  worker-runtime/    Runs the Lambda handlers against LocalStack queues (poller, workers); ws-local
infra/
  modules/
    network          VPC, public and private subnets, a NAT gateway, an S3 gateway endpoint
    rds              PostgreSQL instance, per-database app secrets, Lambda connection details, RDS Proxy (prod)
    ecr              One image repository per service and for Upload Events
    s3               Object Store (staged uploads, CORS, role allow-list, notifications), Platform File Store, web bucket
    cloudfront       The single site: web app, /api to API Gateway, page rewrite
    api-gateway      HTTP API with the JWT authorizer and the DocBeam API routes
    alb              Internal load balancer, one listener per service, security groups, draining
    ecs-cluster      Fargate cluster
    ecs-service      One ECS service with its task definition, roles and migrate/seed task definitions
    secrets          Generated secrets: service client secrets, the seed user password, the signing key's secret
    sqs              Job, Task and Upload Events queues with their DLQs
    lambda           One Lambda (zip or container image), its role, security group and queue triggers
    scheduler        EventBridge schedules for the Sweeper (every minute and daily)
    alarms           The four CloudWatch alarms and the SNS topic that emails ALARM_EMAIL
  envs/dev/          Calls the modules with dev values
  envs/prod/         Calls the modules with prod values (defined, not deployed: see Prod)
bootstrap/           One-time state bucket script (ADR-012)
docker/              Service and worker Dockerfiles, Postgres and LocalStack init, DB bootstrap
scripts/
  local-env.sh         Creates .env with safe local defaults and local secrets
  push-image.sh        Builds an image for linux/amd64 (no attestation) and pushes it to ECR, tagged with the commit
  run-db-bootstrap.sh  Runs the one-off task that creates the databases and roles
  run-task.sh          Runs a one-off task of a service (migrate, seed, signing-key) from its newest deployed revision
  deploy-service.sh    Migrates, registers a task definition with a new image and rolls an ECS service; skips if unchanged
  deploy-lambda.sh     Updates a Lambda from a bundle or an image; skips if it is missing or already runs that code
  deploy-web.sh        Builds the web app, syncs it to S3 and clears the CloudFront cache
  check-internal.sh    Calls /health of each service from inside the network
tests/integration/   Integration tests that run on the Compose stack
tests/scripts/       Tests of the deploy scripts
.github/workflows/   One workflow per service, workers, Upload Events image, infra, CI
docs/                Design, plan, status, decisions and testing records
```

Two rules: `infra/envs/*` never holds resources of its own, and each service keeps its migrations in its own folder (ADR-009).
