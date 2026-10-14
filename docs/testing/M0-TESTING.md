# M0 testing: Foundations

Every check is a command or a click, with the result to expect. Run them from the repo root (`~/docbeam`) on branch `m0`. Sections 2 and 3 change AWS and cost credits: dev costs about 3.2 to 3.5 USD a day while it is up.

## 1. Local

### 1.1 Tooling

| # | Command | Expect |
|---|---|---|
| 1 | `cp .env.example .env && npm install` | Finishes with no errors. Warnings about drizzle-kit's dev-only `esbuild` are known (see STATUS) |
| 2 | `npm run lint` | No output after `eslint .` |
| 3 | `npm run typecheck` | No errors |
| 4 | `npm test` | `Test Files 13 passed`, `Tests 39 passed` (or more) |
| 5 | `npm run build` | Ends with `✓ built in …` for the web app; each worker has `dist/lambda/index.mjs` |
| 6 | `terraform fmt -check -recursive infra` | No output |
| 7 | `for e in dev prod; do terraform -chdir=infra/envs/$e init -backend=false && terraform -chdir=infra/envs/$e validate; done` | `Success! The configuration is valid.` twice |

### 1.2 Start the stack

| # | Command | Expect |
|---|---|---|
| 1 | `docker compose up -d --build --wait --wait-timeout 600` | Every container ends `Healthy`: postgres, localstack, clamav, auth, platform, docbeam-api, workers, ws-local |
| 2 | `docker compose ps --format 'table {{.Service}}\t{{.Status}}'` | 8 rows, each `(healthy)` |
| 3 | `for p in 3001 3002 3003; do curl -s localhost:$p/health; echo; done` | `{"status":"ok","service":"auth"}`, then `platform`, then `docbeam-api` |
| 4 | `curl -s localhost:3003/nope` | `{"error":{"code":"NOT_FOUND","message":"Not found."}}` |

### 1.3 Behaviour by hand

| # | Check | Expect |
|---|---|---|
| 1 | `docker compose logs postgres \| grep "database ready"` | Three lines: `auth_db`, `platform_db`, `docbeam_db`, each with its `_owner` and `_app` role |
| 2 | `docker compose exec postgres psql -U postgres -c "\du"` | `auth_owner`, `platform_owner`, `docbeam_owner` with no `login` attribute; the three `_app` roles can log in |
| 3 | `docker compose logs auth \| grep migrations` | `migrations applied` with role `auth_owner` |
| 4 | `docker compose exec localstack awslocal sqs list-queues` | Six queues: `docbeam-local-job`, `-task`, `-upload-events` and a `-dlq` for each |
| 5 | `docker compose exec localstack awslocal sqs get-queue-attributes --queue-url http://sqs.ap-southeast-2.localhost.localstack.cloud:4566/000000000000/docbeam-local-task --attribute-names RedrivePolicy VisibilityTimeout` | `maxReceiveCount` 5, `VisibilityTimeout` 720 |
| 6 | Send a message: `docker compose exec localstack awslocal sqs send-message --queue-url http://sqs.ap-southeast-2.localhost.localstack.cloud:4566/000000000000/docbeam-local-job --message-body '{"jobId":"demo"}'`, then `docker compose logs workers --tail 5` | A line `"name":"fanout","msg":"job message received"` |
| 7 | `docker compose logs workers \| grep sweeper` (wait one minute after start) | `"name":"sweeper","msg":"sweeper run","task":"resend"` repeats every minute |
| 8 | Upload to the staging prefix: `docker compose exec localstack awslocal s3 cp /etc/hostname s3://docbeam-local-object-store/staging/u1/f1`, then `docker compose logs workers --tail 5` | A line `"name":"upload-events","msg":"upload event received"` |
| 9 | ClamAV: `printf 'zPING\0' \| nc localhost 3310` | `PONG` |
| 10 | Web app: `npm run dev -w @docbeam/web`, open http://localhost:5173 | A page with the heading `DocBeam` |
| 11 | `docker compose down -v && docker compose up -d --wait` | Comes back healthy from a clean volume |

### 1.4 Tests

| # | Command | Expect |
|---|---|---|
| 1 | `npm run test:integration` (stack running) | `Test Files 4 passed`, `Tests 24 passed` |

### 1.5 The Upload Events image

| # | Command | Expect |
|---|---|---|
| 1 | `docker build --platform linux/amd64 -f workers/upload-events/Dockerfile -t docbeam-upload-events:local .` | Builds. About 700 MB |
| 2 | `docker run --rm --entrypoint clamscan docbeam-upload-events:local --version` | `ClamAV 1.4.x/<db version>/<date>` |
| 3 | Run it under the Lambda emulator (download `aws-lambda-rie-x86_64` into an empty folder first), then POST an SQS event to `/2015-03-31/functions/function/invocations` | `{"batchItemFailures":[]}` and an `upload event received` log line |

## 2. Deploy to dev on AWS

Ask the person before each command that changes AWS. Account `346208529537`, region `ap-southeast-2`.

| # | Command | Expect |
|---|---|---|
| 1 | `aws sts get-caller-identity --query Arn --output text` | `…:user/anantim-admin` |
| 2 | `bootstrap/create-state-backend.sh` | `State bucket docbeam-tfstate-346208529537 already exists. Nothing to do.` on a re-run (the first run creates it) |
| 3 | `terraform -chdir=infra/envs/dev init -reconfigure -backend-config="bucket=docbeam-tfstate-346208529537"` | `Terraform has been successfully initialized!` |
| 4 | `terraform -chdir=infra/envs/dev plan` | `Plan: 94 to add, 0 to change, 0 to destroy.` (the number can move by a few) |
| 5 | `terraform -chdir=infra/envs/dev apply` (type `yes`) | `Apply complete!`. About 20 minutes |
| 6 | `scripts/push-image.sh dev db-bootstrap docker/db-bootstrap/Dockerfile` | Prints `…dkr.ecr.ap-southeast-2.amazonaws.com/docbeam-dev/db-bootstrap:<sha>` |
| 7 | `scripts/run-db-bootstrap.sh dev` | Log shows `database ready` three times, six `role` lines, three `database` lines, `bootstrap finished`; `exit code: 0` |
| 8 | `scripts/run-db-bootstrap.sh dev` again | Same output, exit code 0 (safe to repeat) |
| 9 | `scripts/deploy-web.sh dev` | Prints an invalidation id and `Deployed to https://<id>.cloudfront.net` |
| 10 | `terraform -chdir=infra/envs/dev plan` | `No changes.` |

## 3. Verify on dev

| # | Check | Expect |
|---|---|---|
| 1 | `curl -sI $(terraform -chdir=infra/envs/dev output -raw app_url)` | `HTTP/2 200` |
| 2 | Open the `app_url` in a browser | The `DocBeam` page. Open `…/anything`: the same page (single-page app) |
| 3 | `aws s3api get-bucket-encryption --bucket $(terraform -chdir=infra/envs/dev output -raw object_store_bucket)` | `aws:kms`, `BucketKeyEnabled: true` |
| 4 | `aws s3api get-bucket-lifecycle-configuration --bucket <object store>` | A 33-day expiration and a 7-day multipart abort |
| 5 | `aws s3api get-bucket-versioning --bucket <platform files>` | `Enabled` |
| 6 | `aws s3api get-public-access-block --bucket <each of the three buckets>` | All four settings `true` |
| 7 | `aws rds describe-db-instances --query 'DBInstances[].[DBInstanceIdentifier,DBInstanceClass,MultiAZ,StorageEncrypted,Engine,EngineVersion]'` | `docbeam-dev-postgres`, `db.t4g.micro`, `False`, `True`, `postgres`, `16.x` |
| 8 | `aws rds describe-db-proxies --query 'DBProxies[].[DBProxyName,Status,RequireTLS]'` | `docbeam-dev-proxy`, `available`, `True` |
| 9 | `aws ec2 describe-nat-gateways --filter Name=state,Values=available --query 'length(NatGateways)'` | `1` |
| 10 | `aws secretsmanager list-secrets --query 'SecretList[].Name' --output text` | The RDS master secret, three `docbeam-dev/db/*_app`, four `docbeam-dev/service-client/*`, `docbeam-dev/auth/signing-key`, `docbeam-dev/seed/user-password` |
| 11 | `aws secretsmanager describe-secret --secret-id docbeam-dev/auth/signing-key --query 'VersionIdsToStages'` | `null` (empty, written in M1) |
| 12 | `aws ecr describe-repositories --query 'repositories[].repositoryName' --output text` | Five repositories under `docbeam-dev/` |
| 13 | `aws ecs list-clusters` and `aws ecs list-task-definitions` | `docbeam-dev-cluster` and `docbeam-dev-db-bootstrap` |
| 14 | `aws cloudfront list-distributions --query 'DistributionList.Items[].[Id,Status,DomainName]'` | One distribution, `Deployed` |

**In the console (Sydney, read only):** VPC (2 private and 2 public subnets, 1 NAT gateway, an S3 gateway endpoint); RDS (instance and proxy, both available); S3 (three `docbeam-dev-*` buckets, no public access); CloudFront (one distribution); ECR (five repositories); ECS (cluster `docbeam-dev-cluster`); Secrets Manager (the secrets above); CloudWatch Logs (`/docbeam/docbeam-dev/db-bootstrap`).

## 4. Prod (to run later)

Not run in M0. After M5 passes and the account is on the Paid plan, run the `infra` workflow by hand from `main` with `deploy-prod` typed, then check:

| # | Check | Expect |
|---|---|---|
| 1 | The `infra` workflow summary | Plan and apply finish; `check` jobs green |
| 2 | `aws rds describe-db-instances --query 'DBInstances[?starts_with(DBInstanceIdentifier,`docbeam-prod`)].[MultiAZ,DeletionProtection]'` | `True`, `True` |
| 3 | `aws ec2 describe-nat-gateways --filter Name=state,Values=available --query 'length(NatGateways)'` | `2` (plus any dev gateway) |
| 4 | `aws s3api get-bucket-policy --bucket <prod platform files>` | Contains `DenyDeleteObjectVersion` |
| 5 | Re-run the `infra` workflow | `No changes` in the plan |

## 5. Tear down

```bash
# Dev (AWS). Takes about 10 to 15 minutes (CloudFront and RDS).
terraform -chdir=infra/envs/dev destroy

# Check that nothing billable is left. Every command should return nothing or 0:
aws rds describe-db-instances --query 'DBInstances[].DBInstanceIdentifier'
aws rds describe-db-proxies --query 'DBProxies[].DBProxyName'
aws ec2 describe-nat-gateways --filter Name=state,Values=available,pending --query 'NatGateways[].NatGatewayId'
aws ec2 describe-addresses --query 'Addresses[].PublicIp'
aws ecs list-clusters --query 'clusterArns'
aws secretsmanager list-secrets --query 'SecretList[].Name'
aws s3 ls                                   # only docbeam-tfstate-346208529537
aws cloudfront list-distributions --query 'DistributionList.Items[].Id'
aws ecr describe-repositories --query 'repositories[].repositoryName'

# Local
docker compose down -v
```

### Re-create dev

Dev is built so it can be destroyed and re-created every day. After a destroy, no name is held back (secrets have a 0-day recovery window, buckets and repositories are force-deleted):

```bash
terraform -chdir=infra/envs/dev init -reconfigure -backend-config="bucket=docbeam-tfstate-346208529537"
terraform -chdir=infra/envs/dev apply
scripts/push-image.sh dev db-bootstrap docker/db-bootstrap/Dockerfile
scripts/run-db-bootstrap.sh dev
scripts/deploy-web.sh dev
```

The state bucket stays. It costs cents a month and holds the state.
