# DocBeam status

Updated 2026-10-14, at the end of M1 (branch `m1`, pull request open).

**M1 is built and verified locally and on dev,** including the browser checks done by the person. A user can register, sign in and browse only their own teams, binders and folders. A request with no token gets 401 at the gateway; another team's binder gets 404. Dev AWS is **down** (destroyed on 2026-10-14 after the merge: 175 resources, nothing billable left). Plan: `docs/PLAN.md`. Decisions: `docs/DECISIONS.md` (D-M1-1 to D-M1-15). Evidence: `docs/testing/M1-RESULTS.md`. Teaching text: `docs/walkthrough/M1.md`.

## Milestones

| Milestone | Flow | Estimate | Status |
|---|---|---|---|
| M0 | Foundations | 4.5 d | Merged (PR #1, #2). Two NOs accepted |
| M1 | Flow 1: Browse destinations | 11 d | Built, 0 NO in the YES/NO check. PR #3 ready to merge by the person |
| M2 | Flow 2: Upload and distribute | 13 d | Not started |
| M3 | Flow 3: Track a job | 7 d | Not started |
| M4 | Flow 4: Download a file | 2 d | Not started |
| M5 | Hardening and end-to-end checks | 2 d | Not started |

## What M1 did

- **Auth Service:** register, login, RS256 tokens with `kid`, JWKS and OpenID configuration, refresh rotation with reuse detection, logout, the 5-wrong-password pause, service tokens, internal user lookup, four service clients upserted by the migrate task, a support script to end a pause.
- **Document Platform:** schema, four browse routes with membership in each query, destination check, user teams, `POST /documents` (repeat-safe ingest), seed script and files (demo and 50-team load).
- **DocBeam API:** service and full DocBeam DB schema, with an append-only audit trail for the app role.
- **Public edge:** API Gateway HTTP API, JWT authorizer, VPC Link, ten routes listed one by one, throttles, CloudFront `/api/*` with the prefix stripped.
- **Web app:** register, sign in, quiet refresh with Web Locks, 12-hour dialog, lazy destination tree, up to 20 destinations.
- **Infra:** modules `alb`, `ecs-service`, `api-gateway`; scripts `run-task.sh`, `check-internal.sh`, a seed step in `deploy-service.sh`.
- **Tests:** 93 unit and web tests, 75 integration tests, all green.

## Decisions taken in M1 (see `docs/DECISIONS.md`)

D-M1-1 local secrets and signing key; D-M1-2 ALB listener per service, plain HTTP (accepted risk); D-M1-3 seed format; D-M1-4 seed users; D-M1-5 first-bytes check; D-M1-6 ingest field order; D-M1-7 pause details; D-M1-8 new tab refresh; D-M1-9 tree; D-M1-10 DB connection parts; D-M1-11 web tests; D-M1-12 CORS origins and the CloudFront page rewrite; D-M1-13 authorizer switch, native bcrypt, bigger auth task; D-M1-14 image tag default, seed as its own compose run, deploy guards.

## Set up so far

- AWS account `346208529537`, region `ap-southeast-2`, Free plan, credits end 2027-04-13.
- State bucket `docbeam-tfstate-346208529537`. Deploy user `docbeam-github-deploy`, GitHub secrets and variables `AWS_REGION`, `TF_STATE_BUCKET`, environments `dev` and `prod`.
- Dev is **down**. Its last apply used image tag `2f825256fee7` and the app was `https://d2ii4puto0s1y9.cloudfront.net`; a new apply gives a new CloudFront address and needs the two-step bring-up in the README.
- Set: `ECS_DEPLOY_ENABLED=true`, `INFRA_APPLY_ENABLED=false` (keep `false` while dev is down). Not yet: `LAMBDA_DEPLOY_ENABLED` (M2), `ALARM_EMAIL` (before M2).

## Known issues

- **Prod bring-up is not a one-click workflow.** The `infra` workflow's prod job runs one `terraform plan` and `apply` with `jwt_authorizer_enabled` at its default `true`. On a brand-new prod that apply fails at the authorizer exactly as dev did (D-M1-13), and the repositories, images, bootstrap tasks and signing key have to exist in a set order. Prod therefore does **not** do the two-pass apply today. Before the prod apply (after M5), either add a `first_bring_up` input to the `infra` workflow that passes `-var jwt_authorizer_enabled=false` and add the bootstrap steps, or run the sequence in the README "Build dev" against prod by hand with the person's approval. Decide this in the M5 plan.
- **After the first apply, task definitions in Terraform carry the image `bootstrap`** (D-M1-14). Running `scripts/run-task.sh` on a family needs a `deploy-service.sh` first. The services themselves are unaffected.
- The first-time `terraform apply` for the web distribution can take 3 minutes and the VPC Link 2 minutes.
- Internal traffic is plain HTTP inside the VPC (D-M1-2, accepted).
- The M0 items still stand: no RDS Proxy in dev (D-M0-6), the deploy user has AdministratorAccess, GitHub Free has no required reviewer for prod (D-G3), `npm audit` shows four moderate findings in drizzle-kit's dev chain.
- The deploy jobs ran on the M1 merge against dev and were green. They skip with a notice when the service or the environment does not exist (D-M1-14), and since D-M1-15 they skip when the service already runs the image. A manual run of a service workflow from `main` with `force` redeploys dev.
- The M1 merge ran every workflow twice because the PR was merged twice (GitHub logged two `pr_merge` events). Both deploys succeeded. D-M1-15 makes a repeat harmless; it is on branch `fix-duplicate-runs`.
- The first image tag deployed on dev was `2d59b80efe69` for platform and docbeam-api; later builds share `2f825256fee7`. Same code.
- Credits are limited. Dev costs about 4.5 USD a day while up.

## How to run it

```bash
scripts/local-env.sh
docker compose up -d --build --wait
docker compose run --rm seed
npm run lint && npm run typecheck && npm test && npm run build
npm run test:integration
npm run dev -w @docbeam/web      # http://localhost:5173
```

Dev on AWS: `docs/testing/M1-TESTING.md` section 2 (two-step first apply). Tear down: `terraform -chdir=infra/envs/dev destroy -var image_tag=<tag>`.

## Next: M2 (Upload and distribute)

M2 needs from the person:
- the merge of the M1 pull request;
- `ECS_DEPLOY_ENABLED=true` (the browser check is done), and `LAMBDA_DEPLOY_ENABLED` when told;
- the repository variable `ALARM_EMAIL` set before M2's first apply, and the SNS email confirmed;
- a yes before each dev apply, image push and task run.

M2 also needs (decided 2026-10-14, D-M1-14 follow-up):
- **Draining.** Add a per-service `deregistration_delay` variable to the `alb` module (default 30 s) and a `stop_timeout` to `ecs-service`. The platform gets **120 s for the target group and 120 s `stopTimeout` in dev and in prod alike**, so dev tests the same draining as prod. The Delivery Lambda streams to `POST /documents` with a 100 s client limit (Step 2.4), and a 30 s drain would cut a long stream during a rolling deploy. Auth and docbeam-api stay at 30 s. Do it in the M2 step that makes Delivery call the platform (Step 2.4), with a test that a deploy during a long upload does not fail it.

M2 builds on: `ecs-service` (add task role rights for the DocBeam API), the `alb` and `api-gateway` modules (add the DocBeam API routes to `public_routes`), the DocBeam DB schema from 1.5, `POST /destinations/check` and the service token flow, the Upload Events handler skeleton (the scanner is task 2.1b, a carried-over item from M0).
