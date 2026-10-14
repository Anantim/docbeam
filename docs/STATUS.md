# DocBeam status

Updated 2026-10-14, at the end of M0 (pull request #1, branch `m0`).

**M0 is built and verified.** Nothing user-facing exists yet: the repository, the local stack, the dev and prod Terraform and the pipelines are in place. Dev AWS is **down** (destroyed after the checks). The plan is in `docs/PLAN.md`; agreed design changes are in `docs/DECISIONS.md`; M0's evidence is in `docs/testing/M0-RESULTS.md`; a teaching explanation is in `docs/walkthrough/M0.md`.

## Milestones

| Milestone | Flow | Estimate | Status |
|---|---|---|---|
| M0 | Foundations | 4.5 d | Built, in review (PR #1). Two NOs in the YES/NO check, see below |
| M1 | Flow 1: Browse destinations | 11 d | Not started |
| M2 | Flow 2: Upload and distribute | 13 d | Not started |
| M3 | Flow 3: Track a job | 7 d | Not started |
| M4 | Flow 4: Download a file | 2 d | Not started |
| M5 | Hardening and end-to-end checks | 2 d | Not started |

## What M0 did

- Monorepo (npm workspaces, TypeScript strict, ESLint, vitest), `packages/shared` (JWT check, error shape, shared types, connection limits), `packages/worker-runtime` (queue poller, sweeper timers, ws-local).
- Three service skeletons (`/health`, config, Drizzle, migrate entrypoint) and six worker skeletons; the Upload Events image with ClamAV.
- `docker-compose.yml`: Postgres 16 (3 databases, 6 roles), LocalStack 4.14, ClamAV, services, workers, ws-local. All 8 containers healthy.
- Terraform: modules `network`, `rds`, `ecr`, `s3`, `cloudfront`, `ecs-cluster`, `secrets`; `envs/dev` and `envs/prod`; the state bucket script; scripts to push images, run the DB bootstrap task, deploy the web app and deploy an ECS service.
- GitHub Actions: CI, one workflow per service and the web app, workers, the Upload Events image (daily rebuild), infra, gitleaks. All green on PR #1; deploy jobs skipped.
- Proven on dev: apply (86 resources), DB bootstrap task (twice), web deploy, destroy, apply again with no name conflicts, destroy. Nothing billable left.

## Decisions taken in M0 (see `docs/DECISIONS.md`)

- **D-M0-1** `ecs-cluster` and `secrets` modules; the signing-key secret is created empty.
- **D-M0-2** Migrations run as the owner role with `SET ROLE`.
- **D-M0-3** ws-local lives in `worker-runtime`; Compose services migrate then start; Upload Events image on Debian with ClamAV from apt; gitleaks from a pinned image.
- **D-M0-4** State bucket has no deny for other principals; dev teardown settings are module variables.
- **D-M0-5** LocalStack pinned to 4.14 (the newest needs an auth token).
- **D-M0-6** No RDS Proxy in dev: the Free plan blocks it.

## Set up so far

- AWS account `346208529537`, region `ap-southeast-2`, Free plan, 100 USD credits at kickoff, plan ends 2027-04-13. Lambda concurrency limit 400.
- State bucket `docbeam-tfstate-346208529537` (created by `bootstrap/create-state-backend.sh` in M0).
- IAM user `docbeam-github-deploy`, GitHub secrets `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`; variables `AWS_REGION`, `TF_STATE_BUCKET`; environments `dev` and `prod` (main only).
- Not yet: repo variables `INFRA_APPLY_ENABLED` (person, `false`), `ECS_DEPLOY_ENABLED` (from M1), `LAMBDA_DEPLOY_ENABLED` (from M2), `ALARM_EMAIL` (before M2).

## Known issues

- **RDS Proxy is off in dev** (D-M0-6). Dev Lambdas will connect to the instance directly, with at most 1 connection each. Worst case 79 of `max_connections = 100`. **M5 runs with `enable_rds_proxy = true`, after the move to the Paid plan**, so the release checks test the prod setup.
- **Step 0.1 says the Upload Events handler scans through ClamAV locally.** M0 builds the container and image; scanning and the EICAR check come in Step 2.1.
- The deploy user has AdministratorAccess. Narrow it, or replace it with OIDC, after the move to the Paid plan.
- GitHub Free allows no required reviewer on a private repo, so prod is gated by a manual run from `main` with a typed confirmation (D-G3).
- The Free-plan account is under an AWS service control policy. The only deny found in M0 was RDS Proxy. Any other will be listed here.
- Platform File Store `DeleteObjectVersion` deny is prod-only, so dev can be destroyed (D-M0-4).
- `npm audit` shows four moderate findings, all inside drizzle-kit's dev-only esbuild-kit chain. Not shipped in any image.
- The deploy jobs in the workflows target ECS services, Lambdas and task definitions that M1 and M2 create. They stay off until their switch is set, and have not run yet.
- The daily Upload Events rebuild runs from `main` only, so it first runs after the merge.
- The database connection limits (`LAMBDA_POOL`, `SERVICE_POOL`) are unused until a service or worker opens a connection; the connection budget is checked by a unit test, not yet by load.
- Credits are limited. Keep dev down except during AWS testing.

## How to run it

```bash
cp .env.example .env
npm install
docker compose up -d --build --wait
npm run lint && npm run typecheck && npm test && npm run build
npm run test:integration
```

Dev on AWS: see `README.md` "Build dev" and `docs/testing/M0-TESTING.md` section 2. Tear down: `terraform -chdir=infra/envs/dev destroy`.

## Next: M1 (Browse destinations)

M1 needs from the person:
- the decision on the RDS Proxy deviation (accept D-M0-6 as recorded);
- the repo variable `INFRA_APPLY_ENABLED` created (`false` while dev is down);
- a yes before each dev apply, image push and task run, and `ECS_DEPLOY_ENABLED=true` when told.

M1 builds on: the `ecs-cluster` module and the ECR repositories (add the `alb` and `ecs-service` modules), the migrate entrypoints (`node dist/migrate.js`), the DB bootstrap and its roles, the `secrets` module (client secrets, empty signing-key secret) and the `deploy-service.sh` script, whose names follow `docbeam-<env>-<service>` and `docbeam-<env>-<service>-migrate`.
