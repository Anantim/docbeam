# DocBeam status

Updated 2026-10-14, after the kickoff session.

**Nothing built yet.** The plan is in `docs/PLAN.md`. Design changes agreed at kickoff are in `docs/DECISIONS.md`.

## Milestones

| Milestone | Flow | Estimate | Status |
|---|---|---|---|
| M0 | Foundations | 4.5 d | Not started |
| M1 | Flow 1: Browse destinations | 11 d | Not started |
| M2 | Flow 2: Upload and distribute | 13 d | Not started |
| M3 | Flow 3: Track a job | 7 d | Not started |
| M4 | Flow 4: Download a file | 2 d | Not started |
| M5 | Hardening and end-to-end checks | 2 d | Not started |

## Set up so far (checked read-only on 2026-10-14)

- AWS account `346208529537`, region `ap-southeast-2`, Free plan, 100 USD credits, plan ends 2027-04-13. Lambda concurrency limit 400.
- IAM user `docbeam-github-deploy` with one active key, made by hand.
- GitHub: repository secrets `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`; variables `AWS_REGION`, `TF_STATE_BUCKET`; environments `dev` and `prod` (main only).
- Local tools: Node 22.23.3, npm 10.9.9, Terraform 1.16.5, Docker 28.3.3 with Compose 2.39.2, AWS CLI 2.37.13, gh 2.102.0, jq 1.6.
- Not yet: state bucket `docbeam-tfstate-346208529537` (M0 script creates it), repo variables `INFRA_APPLY_ENABLED`, `ECS_DEPLOY_ENABLED`, `LAMBDA_DEPLOY_ENABLED`, `ALARM_EMAIL`.

## Known issues

- The deploy user has AdministratorAccess. Narrow it, or replace it with OIDC, after the move to the Paid plan.
- GitHub Free allows no required reviewer on a private repo, so prod is gated by a manual run from `main` with a typed confirmation (D-G3).
- The Free-plan account is under an AWS service control policy; some IAM read calls are denied. Any deny found during `terraform apply` will be listed here.
- Credits are limited. Keep dev down except during AWS testing.

## Next: M0

The person must:
- say yes before `bootstrap/create-state-backend.sh` runs and before each dev apply and image push;
- create the repo variable `INFRA_APPLY_ENABLED` (`false` while dev is down);
- provide a free LocalStack auth token if M0 finds one is needed.
