# Runbook: first bring-up of a new environment

How to build a DocBeam environment from nothing, in the one order that works. It is written for dev and prod alike. **Dev** is built from a laptop session as shown here. **Prod is not deployed in this project** (D-M5-1): its differences are in section 9, and it never runs from a laptop or an agent session (D-G3).

This runbook was proved on 2026-10-17 by bringing dev up from nothing with it (`docs/testing/M5-RESULTS.md`, section 2): an empty state at 09:21 UTC, `terraform plan` showing `No changes.` and the site answering at 11:08 UTC. About 20 of those 107 minutes were the image pushes from a home connection, and about 35 minutes went on two failed attempts at the database bootstrap, because the RDS certificate bundle in the images could not be read by the non-root user (fixed in the Dockerfiles, D-M5-4). The order below did not have to change.

## 0. Before you start

| Need | How to check |
|---|---|
| AWS CLI v2 signed in as the admin user, region `ap-southeast-2` | `aws sts get-caller-identity --query Arn --output text` shows `…:user/anantim-admin` |
| Terraform 1.10 or later, Docker (with `buildx`), Node 22, `gh` signed in | `terraform version`, `docker version`, `node --version`, `gh auth status` |
| The state bucket exists | `aws s3 ls` shows `docbeam-tfstate-<account id>`. If not, `bootstrap/create-state-backend.sh` |
| Repository variables | `gh variable list` shows `AWS_REGION`, `TF_STATE_BUCKET`, `ALARM_EMAIL`, `ECS_DEPLOY_ENABLED`, `LAMBDA_DEPLOY_ENABLED`, `INFRA_APPLY_ENABLED` |
| A clean tree on the commit you want to deploy | `git status --short` prints nothing |
| Nothing from an earlier bring-up is left | `aws ecs list-clusters` shows no `docbeam-<env>-cluster`; `terraform -chdir=infra/envs/<env> state list` prints nothing |

Time: about 60 to 90 minutes. Cost of dev while up: about 4.5 USD a day (paid from credits). Tear it down when you are not using it (section 8).

Set these once in the shell. `ENV_NAME` is `dev` (prod only through the workflow).

```bash
export ENV_NAME=dev
export ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export IMAGE_TAG=$(git rev-parse --short=12 HEAD)          # a clean tree, so the tag has no "-dirty"
export TF_VAR_alarm_email=$(gh variable get ALARM_EMAIL)   # the address that gets alarm emails (not printed)
export R=$ACCOUNT.dkr.ecr.ap-southeast-2.amazonaws.com/docbeam-$ENV_NAME
export TFVARS="-var image_tag=$IMAGE_TAG -var upload_events_image_tag=$IMAGE_TAG"
```

## 1. Image repositories

```bash
terraform -chdir=infra/envs/$ENV_NAME init -reconfigure -backend-config="bucket=docbeam-tfstate-$ACCOUNT"
terraform -chdir=infra/envs/$ENV_NAME apply -auto-approve -target=module.ecr $TFVARS
```

Expect `Apply complete!` with the repositories `auth`, `platform`, `docbeam-api`, `db-bootstrap`, `upload-events`.

## 2. Images

The images must exist before the first full apply: Terraform starts the Upload Events Lambda from its image.

```bash
for s in auth platform docbeam-api; do
  scripts/push-image.sh $ENV_NAME $s docker/service.Dockerfile --build-arg SERVICE=$s
done
scripts/push-image.sh $ENV_NAME db-bootstrap docker/db-bootstrap/Dockerfile
scripts/push-image.sh $ENV_NAME upload-events workers/upload-events/Dockerfile      # about 1 GB, 5 to 10 minutes
```

Every image carries the RDS certificate bundle (`packages/shared/certs/rds-ca-bundle.pem`), so the services check the database certificate chain (D-M5-4). `push-image.sh` builds with `--provenance=false --sbom=false`: with an attestation the image becomes an OCI index and Lambda refuses it. ECR tags are immutable, so an image pushed the wrong way needs a new tag (pass it as `upload_events_image_tag`).

## 3. First apply, without the JWT authorizer

```bash
terraform -chdir=infra/envs/$ENV_NAME plan  $TFVARS -var jwt_authorizer_enabled=false     # read it: 247 to add, 0 to destroy (dev, 2026-10-17)
terraform -chdir=infra/envs/$ENV_NAME apply -auto-approve $TFVARS -var jwt_authorizer_enabled=false
```

The authorizer needs the Auth Service to answer through CloudFront, which cannot happen yet (D-M1-13). The first apply takes about 25 minutes (the database, the web distribution and the VPC Link are the slow parts). Expect `Apply complete!`.

AWS emails `ALARM_EMAIL` a "Confirm subscription" link for the alarm topic (a new topic on every bring-up). Until it is clicked, the four alarms send nothing; the alarm states are still readable in CloudWatch.

## 4. Database and signing key

```bash
scripts/run-db-bootstrap.sh $ENV_NAME          # creates the three databases and their roles; expect "exit code: 0"
scripts/run-task.sh $ENV_NAME auth signing-key  # writes the token signing key, once; expect "exit code: 0"
```

The bootstrap task connects with `PGSSLMODE=verify-full` and the RDS bundle. A "certificate verify failed" here means the image or the database host is wrong.

## 5. Deploy the services, then check them from inside the network

```bash
for s in auth platform docbeam-api; do scripts/deploy-service.sh $ENV_NAME $s $R/$s:$IMAGE_TAG; done   # migrate, seed, update
scripts/check-internal.sh $ENV_NAME             # three "200" lines: the health of each service from inside the VPC
```

`deploy-service.sh` runs the migrations, loads the seed (the platform's demo and load hierarchy and the demo users) and waits for the service to settle. After the first apply, Terraform's task definitions carry the image `bootstrap` (D-M1-14); `deploy-service.sh` registers the real image as a new revision. `scripts/run-task.sh` needs that marked revision, so deploy before running any one-off task on a service.

## 6. Worker code

```bash
npm ci && npm run build                          # bundles the worker Lambdas, with the RDS bundle beside each
for w in fanout delivery dlq ws sweeper; do scripts/deploy-lambda.sh $ENV_NAME $w workers/$w/dist/lambda; done
scripts/deploy-lambda.sh $ENV_NAME upload-events $R/upload-events:$IMAGE_TAG    # skips: it already runs this image
```

Terraform creates each Lambda from a placeholder (D-M2-6); this step replaces it with the real code. Expect `Deployed …` for each of the five and a skip for Upload Events.

## 7. Second apply with the authorizer, then the web app

```bash
terraform -chdir=infra/envs/$ENV_NAME apply -auto-approve $TFVARS                # the authorizer and the routes that need it (dev: 26 added, 8 destroyed: the routes are re-created with the authorizer)
scripts/deploy-web.sh $ENV_NAME                 # prints "Deployed to https://<id>.cloudfront.net"
terraform -chdir=infra/envs/$ENV_NAME plan $TFVARS                               # expect "No changes."
```

Check it:

```bash
APP=$(terraform -chdir=infra/envs/$ENV_NAME output -raw app_url)
curl -s -o /dev/null -w '%{http_code}\n' $APP/                    # 200
curl -s -o /dev/null -w '%{http_code}\n' $APP/api/teams           # 401 from the gateway, without a token
```

The seed password is in Secrets Manager (`docbeam-<env>/seed/user-password`). Never paste it into a file or a chat. Sign in at `$APP` as `priya.shah@example.com`.

Switches (the person sets them): `ECS_DEPLOY_ENABLED=true` and `LAMBDA_DEPLOY_ENABLED=true` let the merge workflows deploy to the new environment. Keep `INFRA_APPLY_ENABLED=false` while dev is down.

## 8. Tear down

```bash
scripts/empty-dev-buckets.sh dev --dry-run      # names and counts only
scripts/empty-dev-buckets.sh dev                # empties the two data buckets (all versions); never the state bucket
terraform -chdir=infra/envs/dev destroy -auto-approve $TFVARS
terraform -chdir=infra/envs/dev state list      # prints nothing
aws s3 ls                                       # shows only docbeam-tfstate-<account id>
```

`terraform destroy` fails on buckets with many versions, so empty them first (D-M2-23). `destroy` needs the same `-var` values as `apply`.

## 9. Prod differences (prod is not deployed in this project)

- **Plan:** the AWS account must be on the Paid plan. The Free plan blocks RDS Proxy.
- **Proxy:** `infra/envs/prod` sets `enable_rds_proxy = true`; the Lambdas then connect through the proxy (`lambda_db_host`), and the 79-connection budget (D-M0-6) can be relaxed. The bundle includes Amazon Root CA 1 for the proxy's certificate.
- **Sizing:** Multi-AZ database, two tasks per service across zones, one NAT gateway per zone.
- **Who runs it:** never a laptop or an agent session. In GitHub, Actions, the `infra` workflow, Run workflow from `main`, type `deploy-prod`, with the `prod` environment limited to `main` (D-G3).
- **Order:** the same as sections 1 to 7. The `infra` workflow's prod job today runs one apply with the authorizer on, which fails on a brand-new prod exactly as dev did (D-M1-13), and the repositories, images and bootstrap tasks have to exist first. A first prod bring-up therefore needs the workflow split into the steps above, or the first steps run by the person with a prod-scoped session. This is the main thing to change before prod is ever deployed.
- **Seed:** `seed_files` is empty in prod until the client's hierarchy exists (G18).
- **Deploy user:** `docbeam-github-deploy` has AdministratorAccess today; narrow it before prod.

## 10. Things that go wrong

| Symptom | Cause and fix |
|---|---|
| `FreeTierRestrictionError` creating the proxy | The Free plan (D-M0-6). Keep `enable_rds_proxy = false` |
| Lambda: "image manifest, config or layer media type … is not supported" | Image pushed with an attestation. Push again under a new tag with `push-image.sh` |
| The second apply creates the authorizer but `/api/...` returns 500 | Run `scripts/check-internal.sh`; the Auth Service must answer through CloudFront first |
| `run-task.sh`: "No revision … registered by scripts/deploy-service.sh" | Deploy the service first (section 5) |
| `destroy` fails with `bufio.Scanner: token too long` | Empty the data buckets first (section 8) |
| "certificate verify failed" from a service | The bundle is missing from the image, or `DB_HOST` is not the database's own address. Run `scripts/update-rds-ca.sh` if AWS rotated the authority |
