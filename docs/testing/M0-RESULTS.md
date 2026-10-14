# M0 results: Foundations

Run on 2026-10-14, branch `m0`, account `346208529537`, region `ap-southeast-2`. Commands and short outputs, in the order of `M0-TESTING.md`.

## Summary

| Area | Result |
|---|---|
| Local tooling (lint, typecheck, test, build) | Pass |
| Local stack (8 containers healthy) | Pass |
| Integration tests (24) | Pass |
| State bucket | Pass |
| Dev apply, bootstrap task, web deploy | Pass, after one fix (RDS Proxy, D-M0-6) |
| Destroy and re-create cycle | Pass, no name conflicts |
| Final teardown, nothing billable left | Pass |
| GitHub pipelines on PR #1 | Pass (deploy jobs skipped) |
| **Deviation from the design** | RDS Proxy is off in dev (D-M0-6), approved |

## 1. Local

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | No findings |
| Typecheck | `npm run typecheck` | No errors |
| Unit tests | `npm test` | `Test Files 14 passed (14)`, `Tests 43 passed (43)` |
| Build | `npm run build` | Web built (`dist/assets/index-*.js`, 219.73 kB); each worker has `dist/lambda/index.mjs` |
| Terraform format | `terraform fmt -check -recursive infra` | Clean |
| Terraform validate | `terraform validate` in `infra/envs/dev` and `infra/envs/prod` | `Success! The configuration is valid.` both |
| Bundle runs alone | `node -e "import('./f.mjs')..."` on the fan-out bundle | `{"batchItemFailures":[]}` and one log line |
| gitleaks (local) | `gitleaks detect --source /repo` | `no leaks found` |
| actionlint | `rhysd/actionlint` | Only a style warning, fixed |

### Stack

`docker compose up -d --build --wait` brought all 8 containers to healthy on the first run: postgres, localstack, clamav, auth, platform, docbeam-api, workers, ws-local.

- Bootstrap log: `database ready` for `auth_db`, `platform_db`, `docbeam_db`, each with its `_owner` and `_app` role.
- `auth` log: `migrations applied`, role `auth_owner`.
- `workers` log: six queues polled; the S3 `staging/` event reached the Upload Events handler (`upload event received`).
- Image build and Lambda emulator: `docbeam-upload-events:local` (726 MB, ClamAV 1.4.3 with definitions). Invoking it through the Lambda Runtime Interface Emulator returned `{"batchItemFailures":[]}` and logged `upload event received`.

### Integration tests (`npm run test:integration`)

`Test Files 4 passed (4)`, `Tests 24 passed (24)`.

- `postgres.test.ts`: three databases with the right owners; six roles (owners NOLOGIN, apps LOGIN, none superuser); an app role cannot enter another database; an app role cannot create tables; citext and the migrations table owned by the owner role; the bootstrap runs again without errors.
- `localstack.test.ts`: both buckets, versioning on the Platform File Store; job, task and upload-events queues with visibility 360, 720 and 3,600, 14-day retention, redrive 3, 5, 5; `staging/` upload reaches the worker.
- `workers.test.ts`: each of the six queues runs its handler and is emptied; the sweeper runs on its timer.
- `services.test.ts`: `/health` 200 on 3001, 3002 and 3003; the shared 404 error shape; ws-local connect, subscribe, push, disconnect; ClamAV answers `PONG`.

## 2. Deploy to dev on AWS

### State bucket

| Command | Result |
|---|---|
| `bootstrap/create-state-backend.sh` | `Creating state bucket docbeam-tfstate-346208529537 in ap-southeast-2` |
| `aws s3api get-bucket-versioning` | `Status: Enabled` |
| `aws s3api get-bucket-encryption` | `aws:kms`, `BucketKeyEnabled: true` |
| `aws s3api get-public-access-block` | all four `true` |
| `aws s3api get-bucket-policy` | `DenyInsecureTransport` (TLS only), no other deny (D-M0-4) |
| Run again | `State bucket … already exists. Nothing to do.` |

### First apply: a Free-plan block

`terraform apply` (dev) created 104 items and failed at the proxy:

```
creating RDS DB Proxy (docbeam-dev-proxy): … FreeTierRestrictionError:
This feature isn't available with free plan accounts.
```

Work stopped and the person decided option A (D-M0-6). `terraform destroy` removed 91 resources. Read-only checks afterwards: no RDS instance, proxy, NAT gateway, Elastic IP, ECS cluster, secret, bucket (except the state bucket), distribution, repository, VPC or log group.

### Fix

`enable_rds_proxy` in `infra/modules/rds` (dev `false`, prod `true`), a fixed `max_connections = 100` parameter group, `LAMBDA_POOL` and `SERVICE_POOL` in `packages/shared/src/db.ts`, and a unit test for the connection budget. Worst case in dev: **79 of 100** connections.

### Second apply (also the re-create test)

| Command | Result |
|---|---|
| `terraform plan` | `Plan: 86 to add, 0 to change, 0 to destroy.` |
| `terraform apply` | `Apply complete! Resources: 86 added, 0 changed, 0 destroyed.` No name conflicts (secrets, buckets, repositories, log groups, RDS) |
| `terraform plan -detailed-exitcode` | `No changes`, exit 0 |
| `scripts/push-image.sh dev db-bootstrap docker/db-bootstrap/Dockerfile` | `…/docbeam-dev/db-bootstrap:3ed72538824a` (and the `bootstrap` tag) |
| `scripts/run-db-bootstrap.sh dev` | three `database ready` lines, six `role` lines, three `database` lines, `bootstrap finished`, `exit code: 0` |
| `scripts/run-db-bootstrap.sh dev` again | Same output, `exit code: 0` |
| `scripts/deploy-web.sh dev` | `Deployed to https://d2qlgusf9o4cwi.cloudfront.net` |

## 3. Verify on dev

| # | Check | Result |
|---|---|---|
| 1 | `curl -sI <app_url>` | `HTTP/2 200` |
| 2 | `<app_url>/some/path` | `200`, page title `DocBeam` (single-page app) |
| 3 | Object Store encryption | `aws:kms`, bucket key `True` |
| 4 | Object Store lifecycle | `expire-after-33-days` 33; `abort-abandoned-multipart-uploads` 7 |
| 5 | Platform File Store | versioning `Enabled`, old versions expire after 90 days |
| 6 | Block Public Access on all three buckets | `True True True True` three times |
| 6a | CORS on the Object Store | `GET POST PUT`, exposes `ETag` |
| 7 | RDS | `docbeam-dev-postgres db.t4g.micro MultiAZ False StorageEncrypted True postgres 16.13 PubliclyAccessible False` |
| 8 | RDS Proxy | none (D-M0-6) |
| 8a | `max_connections` | `100` |
| 9 | NAT gateways | `1` |
| 10 | Secrets | RDS master, three `docbeam-dev/db/*_app`, four `docbeam-dev/service-client/*`, `docbeam-dev/auth/signing-key`, `docbeam-dev/seed/user-password` |
| 11 | Signing key secret | `VersionIdsToStages: None` (empty) |
| 12 | ECR | `docbeam-dev/auth`, `db-bootstrap`, `docbeam-api`, `platform`, `upload-events` |
| 13 | ECS | cluster `docbeam-dev-cluster`, task definition `docbeam-dev-db-bootstrap:2` |
| 14 | CloudFront | one distribution, `Deployed` |
| 15 | Log group | `/docbeam/docbeam-dev/db-bootstrap` |
| 16 | Object Store policy (extra) | `put-object` by `anantim-admin`: `AccessDenied … with an explicit deny in a resource-based policy` |

These were read through the AWS CLI. The Sydney console views listed in `M0-TESTING.md` section 3 show the same resources; I did not drive the browser console.

## 5. Tear down

`terraform destroy`: `Destroy complete! Resources: 86 destroyed.` Read-only checks afterwards:

| Check | Result |
|---|---|
| `aws rds describe-db-instances` | empty |
| `aws rds describe-db-proxies` | empty |
| `aws ec2 describe-nat-gateways` (available, pending, deleting) | empty |
| `aws ec2 describe-addresses` | empty |
| `aws ecs list-clusters` | empty (so no tasks) |
| `aws secretsmanager list-secrets` | empty |
| `aws s3 ls` | only `docbeam-tfstate-346208529537` |
| `aws cloudfront list-distributions` | none |
| `aws ecr describe-repositories` | empty |
| non-default VPCs, `/docbeam` log groups | none |

## GitHub pipelines (PR #1)

First run: everything passed except the integration job, which failed in the image build with `npm error code ECONNRESET` (the registry reset a connection while three images built at once). Not a code defect. Fix: npm fetch retries in `docker/service.Dockerfile` and `docker/workers.Dockerfile`. Second run, all passing:

`Format and validate (dev)`, `Format and validate (prod)`, `Plan dev` (plan comment posted), `Lint, typecheck, test and build`, `Integration tests (Compose and LocalStack)`, `gitleaks`, `Lint, test and bundle` (workers), `Lint, typecheck and build` (web), `Build the image` (Upload Events), `service / Lint and test` and `service / Docker build` for auth, platform and docbeam-api. Every deploy job (`Deploy to dev`, `Deploy to prod`, worker, Upload Events image, `Apply dev`, `Plan and apply prod`) shows `skipping`.

Not exercised: the deploy jobs themselves (the switches are off by design), the daily scheduled rebuild (it runs only from `main`), and the apply on merge.

## Final check: the M0 requirements

| # | Requirement | YES / NO | Evidence |
|---|---|---|---|
| 1 | Monorepo as in "Repository layout", with root README | YES | `README.md`; folders `services/`, `workers/`, `web/`, `packages/`, `infra/`, `bootstrap/`, `docker/`, `scripts/`, `.github/workflows/` |
| 2 | Shared TypeScript and ESLint config, `.gitignore`, `.env.example` | YES | `tsconfig.base.json`, `eslint.config.js`, `.gitignore`, `.env.example` |
| 3 | `packages/shared`: one JWT check, common error shape | YES | `packages/shared/src/jwt.ts`, `errors.ts`; `jwt.test.ts` (wrong `iss`, `aud`, `exp`, `kid`, `token_use`, scope), `errors.test.ts` |
| 4 | `packages/worker-runtime` runs handlers against LocalStack queues | YES | `src/poller.ts`, `src/batch.ts`; `workers.test.ts`; `batch.test.ts` |
| 5 | Three services answer `/health` | YES | `services.test.ts`; `curl` 200 for 3001, 3002, 3003 |
| 6 | Six workers' handlers run and log | YES | `workers/*/src/index.test.ts`; `workers.test.ts` (six queues) |
| 7 | `docker-compose.yml`: Postgres with three databases and roles, LocalStack with bucket and queues, clamav, workers, ws-local | YES | `docker-compose.yml`; `postgres.test.ts`, `localstack.test.ts` |
| 8 | Every container healthy on `docker compose up` | YES | `docker compose ps`: 8 rows `(healthy)` |
| 9 | Upload Events handler scans through `clamav` and refuses EICAR locally (Step 0.1 text) | NO (scheduled) | M0 builds the container, the image with ClamAV and a handler that logs. Scanning and the EICAR check are Step 2.1 and 2.1b in PLAN. ClamAV answers `PONG` (`services.test.ts`) |
| 10 | `bootstrap/create-state-backend.sh`; bucket exists | YES | script; `get-bucket-*` outputs above |
| 11 | Terraform modules for Step 0.2: network, rds, ecr, s3 (+ cloudfront, ecs-cluster, secrets) | YES | `infra/modules/*`; apply created 86 resources |
| 12 | `rds` includes RDS Proxy | NO (approved) | Free plan blocks it: `FreeTierRestrictionError`. Off in dev, on in prod. D-M0-6, `infra/modules/rds/main.tf` |
| 13 | Dev sized as designed (one NAT, single-AZ `db.t4g.micro`); prod Multi-AZ, NAT per zone | YES | `infra/envs/dev/main.tf`, `infra/envs/prod/main.tf`; checks 7, 9 |
| 14 | KMS-encrypted RDS storage; secrets generated, none typed in | YES | check 7; `random_password`, `manage_master_user_password`; gitleaks clean |
| 15 | Object Store: SSE-KMS and Bucket Key, BPA, TLS only, role allow-list, clean-tag rule, 33-day expiry, 7-day multipart cleanup, CORS exposing ETag | YES | checks 3, 4, 6, 6a, 16; `infra/modules/s3/main.tf` |
| 16 | Platform File Store: versioning, 90-day old versions, `DeleteObjectVersion` denied | YES (prod) | Versioning and 90 days verified on dev (check 5). The deny is a prod-only variable so dev can be destroyed (D-M0-4); it is in `infra/envs/prod/main.tf` and was not applied |
| 17 | Web bucket and CloudFront | YES | checks 1, 2, 14 |
| 18 | Databases and roles made by a bootstrap task, never by hand | YES | `scripts/run-db-bootstrap.sh dev` log |
| 19 | Signing key secret created empty, written later | YES | check 11 |
| 20 | `envs/dev` and `envs/prod` only call modules | YES | `infra/envs/*/main.tf` |
| 21 | Scripts to push images and deploy the web app | YES | `scripts/push-image.sh`, `scripts/deploy-web.sh`, `scripts/run-db-bootstrap.sh`, `scripts/deploy-service.sh` |
| 22 | One workflow per service, filtered by path | YES | `auth.yml`, `platform.yml`, `docbeam-api.yml`, `web.yml` |
| 23 | Worker workflow and daily Upload Events rebuild | YES | `workers.yml`; `upload-events-image.yml` (`cron: '17 3 * * *'`) |
| 24 | Infra workflow: plan on PR, apply dev on merge, prod only by manual run with approval | YES | `infra.yml`; `Plan dev` check; prod gate per D-G3 (typed `deploy-prod`, `main` only, `prod` environment) |
| 25 | gitleaks | YES | `ci.yml` job; local run `no leaks found` |
| 26 | Deploy jobs skip unless the switch is `true` | YES | all deploy jobs `skipping` on PR #1 |
| 27 | Rollback steps written | YES | `README.md` "Roll back" |
| 28 | `docs/testing/M0-TESTING.md`, `M0-RESULTS.md`, STATUS | YES | this file; `docs/STATUS.md` |
| 29 | npm install, lint, typecheck, test, build pass | YES | section 1 |
| 30 | State bucket exists, dev apply succeeds, resources visible | YES | sections 2 and 3 (read through the CLI) |
| 31 | Walkthrough (AGENTS.md step 6) | YES | `docs/walkthrough/M0.md` |

### Verdict

**Two NOs.** Both are stated above and neither is hidden.

- **#12 RDS Proxy:** the account's Free plan blocks it. It is a design change, approved by the person (D-M0-6) and recorded in `docs/DECISIONS.md`. It closes in M5, which runs dev with the proxy on after the move to the Paid plan.
- **#9 Scanning and EICAR locally:** the text of Step 0.1 says the handler scans locally. The M0 prompt asks only that each handler runs and logs, and the scanner is built in Step 2.1 (ADR-016). The ClamAV container and image are in place and healthy.

By the rule in AGENTS.md ("one unaddressed requirement means the milestone fails"), #12 is a NO against the letter of Step 0.2. Please decide whether to accept the deviation as recorded or to move to the Paid plan first.

## Known follow-ups (also in `docs/STATUS.md`)

- Repo variable `INFRA_APPLY_ENABLED` is not created yet (the person sets it to `false`).
- The three deploy switches are all off.
- Four moderate `npm audit` findings come from drizzle-kit's dev-only esbuild-kit chain.
