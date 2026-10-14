# DocBeam: rules for every coding agent session

Read this whole file before doing anything. It applies to every session and every milestone.

## What we are building

DocBeam lets clinical trial coordinators send up to 100 files to up to 20 team folders in one action, track every delivery live and download what was delivered. The design is complete; your job is to implement it exactly.

## Source of truth

Read these in order. They are the spec; do not invent behaviour that is not in them.

1. `docs/design/01-design-requirements.md`: the client's brief (it calls the project DocBridge; the product is DocBeam).
2. `docs/design/02-blueprint.md`: scope, users, success metrics.
3. `docs/design/03-user-flows.md`: the four user flows step by step.
4. `docs/design/04-adrs.md`: every architecture decision and why.
5. `docs/design/05-technical-design.md`: schemas, API contracts, repo layout, milestones and steps, concurrency, failure handling, testing strategy, launch plan.

Also available: `docs/design/diagrams/` (Eraser diagram code, detailed and simplified) and `docs/design/ui/Main.dc.html` (the UI mockup source: screens, states, copy and layout to match).

`docs/DECISIONS.md` records design changes agreed during the build; it wins over everything in `docs/design/`. Otherwise, when documents disagree, the technical design wins, then the ADRs, then the blueprint, then the flows, then the brief. If something is unclear, missing or contradictory, stop and ask. Do not guess.

Write all code yourself from these documents. Do not copy code from any other repository, and do not look for one.

## Where this runs

- Laptop: Windows with Ubuntu in WSL2. Repo at `~/docbeam`. Node 22, npm, Docker Desktop (WSL integration on), Terraform 1.10 or later, AWS CLI v2, GitHub CLI (`gh`, signed in).
- AWS: one account on the **AWS Free plan**, region **Asia Pacific (Sydney), `ap-southeast-2`**, for everything. The AWS CLI's default profile is the person's admin user. Never ask for keys and never print them.
- Free plan limits, already designed around (see the technical design, Step 0.2 and 0.3):
  - No GuardDuty: malware scanning is ClamAV inside the Upload Events Lambda (ADR-016).
  - No IAM OIDC identity provider: GitHub Actions signs in with the `docbeam-github-deploy` IAM user's access keys, stored as the repository secrets `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.
  - Only `ap-southeast-2`, `us-east-1` and `us-west-2` work. Use `ap-southeast-2`.
  - Lambda concurrency limit is 400, so dev uses the prod trigger caps (Delivery 50, Upload Events 10).
  - No RDS Proxy on the Free plan: dev Lambdas connect directly to the database, at most 1 connection each; prod keeps the proxy (D-M0-6).
- GitHub (already set up by the person):
  - Repository variables: `AWS_REGION` = `ap-southeast-2`, `TF_STATE_BUCKET` = `docbeam-tfstate-<account id>`.
  - Environments: `dev`, and `prod` (only `main` allowed). GitHub Free gives no required reviewer on a private repo, so prod jobs run only on a manual run from `main` with the typed input `deploy-prod` (D-G3).
  - Switches, set by the person when you say so: `ECS_DEPLOY_ENABLED` (from M1, once ECS services exist), `LAMBDA_DEPLOY_ENABLED` (from M2) and `INFRA_APPLY_ENABLED` (dev apply on merge; `false` while dev is down). Workflows must skip those jobs while a switch is not `true`.
- Terraform state: S3 bucket `docbeam-tfstate-<account id>` in `ap-southeast-2`, created by `bootstrap/create-state-backend.sh` (versioned, encrypted, private, `use_lockfile = true`, no DynamoDB). Check whether it exists before creating it.

## Safety rules

- **Secrets.** Never write a secret, key, password or token into a file, a commit, a log or the chat. Local values go in `.env` (git-ignored), with a `.env.example` holding only names and safe local defaults. In AWS, secrets are generated (Terraform `random_password`, RDS-managed master password, a bootstrap task for the signing key) and live in Secrets Manager. gitleaks runs in CI and must stay clean.
- **AWS changes need a yes.** Before any command that creates, changes or deletes AWS resources (`terraform apply`, `terraform destroy`, `aws ... create/put/delete/update`, image pushes), say in one or two lines what it will do and what it costs, and wait for the person to agree.
- **Cost.** Dev costs about 3 to 5 USD a day while it is up, paid from Free plan credits. When AWS testing for a task is done, remind the person to tear dev down (`terraform -chdir=infra/envs/dev destroy`) unless they want it kept up.
- **Prod.** Never apply or deploy to prod. Prod goes through the GitHub `infra` workflow with the person's approval, after M5 passes and the account is on the Paid plan.
- **Console.** The AWS Console is for reading only. Every AWS resource is created by Terraform (ADR-012).
- **Design documents.** Do not edit `docs/design/`. If the design must change, stop, explain why, and wait. After the person agrees, record the change in `docs/DECISIONS.md` (date, what, why) and in the code.

## How to work

1. **Plan first, then wait.** At the start of a milestone, read `docs/STATUS.md` and `docs/PLAN.md` (if they exist) and the milestone's steps in the technical design. Write the plan: one task per line, each naming its **inputs** (documents, sections, existing files, values it needs) and its **outputs** (files created or changed, routes, tables, AWS resources, tests), plus how it will be checked. Stop and wait for approval. Do not write code before the plan is approved.
2. **Build in small steps.** Follow the repo layout, names and limits in the technical design exactly. Add unit tests for the logic the testing strategy lists, and integration tests that run on Docker Compose with LocalStack. Commit after each task with a clear message.
3. **Testing document.** For each milestone write `docs/testing/M{n}-TESTING.md` with these sections, every check a command or a click plus the expected result:
   1. Local: start the stack, run the tests, check each demo behaviour by hand.
   2. Deploy to dev on AWS: exact commands in order.
   3. Verify on dev: exact checks, including what to look for in the AWS Console (Sydney).
   4. Prod (to run later): what to check after the prod deploy.
   5. Tear down.
4. **Run the testing round yourself** before reporting: everything in sections 1 to 3 of the testing document (ask before the AWS commands). Fix what fails and run it again. Record the evidence (command, short output, test names) in `docs/testing/M{n}-RESULTS.md`.
5. **Final check.** Walk the milestone's prompt and the milestone's steps in the technical design line by line. Give every requirement YES or NO with evidence: a file and line, a test name, or a command with its output. **One unaddressed requirement means the milestone FAILS.** Fix it, or report it clearly as a NO with the reason; never hide it.
6. **Walkthrough.** Write `docs/walkthrough/M{n}.md` to teach the person what the milestone built, in plain English: the big picture; one request traced start to finish (what happens, why, the files, what to see in the AWS Console); the 2 to 4 parts where a mistake would cause real harm and the tests that cover them; what can be ignored; 8 to 10 questions a reviewer might ask, with short answers; a short glossary. About 4 pages, no code dumps.
7. **Hand over.** Update `docs/STATUS.md` (what is done, what was decided, known issues, how to run it, what the next milestone needs), commit, push the branch `m{n}` and open a pull request to `main` with `gh pr create`. Tell the person: what to check in the browser, which GitHub variable to switch on (if any), and the teardown command.

## Style

- Stack: the design fixes React with Vite, PostgreSQL, Lambda, ECS Fargate and Terraform. For the rest use TypeScript (`strict`, ESM, Node 22) in an npm workspaces monorepo, Fastify for the services, Drizzle with drizzle-kit for each service's schema and migrations, vitest for tests and esbuild to bundle the Lambdas. Propose something else only with a strong reason, in the plan, for the person to approve.
- Plain, simple English in docs, comments and messages. Short sentences.
- No dead code, no placeholder TODOs left behind without a line in `docs/STATUS.md`.
