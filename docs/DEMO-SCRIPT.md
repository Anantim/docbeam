# Demo script: a 3 to 5 minute screen recording on dev

What the video shows, in order: sign in, add files, the virus test file refused, tick folders (to all files, and to some only), the question before Send, a send, the Status panel with its deliveries, Raj seeing only the Cardio deliveries and Sam getting "not found", a 2,000-delivery send, the platform stopped and the backlog draining, the list with its filters, a preview. Target length 3 to 5 minutes.

**The video is recorded by a script.** `scripts/demo/record.ts` plays this plan in Playwright at 1280x720 with a visible cursor and a caption for each step, then writes `docs/demo/docbeam-demo.webm` (VP9, under 25 MB) and one frame per step to a `frames` folder next to the video (git-ignored), so every step can be looked at. The recorder writes a webm (the encoder Playwright brings); an mp4 is made from it with ffmpeg (see the end of this file). The earlier OBS recording (`docbeam-demo.mp4`, 2026-10-18) showed the old screens and was replaced. An older automated recorder is in git history (commit `9b2141e`).

```bash
scripts/demo-files.sh                                   # the demo files, in ~/docbeam-demo-files
export DEMO_URL=$(terraform -chdir=infra/envs/dev output -raw app_url)
export DEMO_PASSWORD=$(aws secretsmanager get-secret-value --secret-id docbeam-dev/seed/user-password \
  --query SecretString --output text --region ap-southeast-2)        # never written to a file
DEMO_DEV=1 node --no-warnings scripts/demo/record.ts    # DEMO_DEV=1 adds the big send and the outage (dev only)
```

Without `DEMO_DEV` and `DEMO_URL` it records the local stack (`docker compose up`, `npm run dev -w @docbeam/web`) and skips the big send and the outage, which need AWS. `DEMO_PACE` (default 2) stretches how long each caption stays.

The video link goes into the README ("Demo video" section).

## Before recording

### Bring dev up (about 60 to 90 minutes, about 4.5 USD a day while up)

Follow `docs/RUNBOOK-first-bring-up.md` sections 0 to 7. The short form, from a clean tree on `main`:

```bash
export ENV_NAME=dev ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export IMAGE_TAG=$(git rev-parse --short=12 HEAD) TF_VAR_alarm_email=$(gh variable get ALARM_EMAIL)
export R=$ACCOUNT.dkr.ecr.ap-southeast-2.amazonaws.com/docbeam-dev
export TFVARS="-var image_tag=$IMAGE_TAG -var upload_events_image_tag=$IMAGE_TAG"
```

then sections 1 to 7 of the runbook, in order. When `scripts/deploy-web.sh dev` prints the address, that is the page you record.

### Get ready (2 minutes)

Make the files and set the three variables shown at the top (`scripts/demo-files.sh`, `DEMO_URL`, `DEMO_PASSWORD`). Do one dry run against the local stack first (no `DEMO_DEV`). The first sign-in after a bring-up is slower.

## The script

| Step | Screen | Caption (what the video says) |
|---|---|---|
| 1 | Sign-in page | DocBeam sends clinical trial documents to many team folders at once, and tracks every delivery. Sign in as Anantim. |
| 2 | Distribute, Files | Add the files once. Each is checked in the browser, uploaded, and scanned for malware. Each file shows its state: Uploading, Scanning, Ready. |
| 3 | The refused file | The standard antivirus test file (a real DOCX that holds the EICAR test string, made by `scripts/demo-files.sh`) is refused. It is deleted and can never be sent. It is removed. |
| 4 | Select all, tick folders | Select the files, or leave none selected for all of them, then tick folders. I only see my own teams. The words beside Destinations say who a tick is for ("for 2 selected files" while files are ticked, nothing otherwise). When Send is off, the reason is text beside Clear. The full summary comes in the question before Send. |
| 5 | One file selected | With some files selected, a tick goes to those files only. The folders of a file are one click away (the "3 folders" button). |
| 6 | Send | Sending asks first. Delivered files can not be recalled, and Cancel is the default. |
| 7 | Status panel | Send opened this panel by itself, with the toast "Sent" (D-F1-31). Each delivery is tracked; the numbers move on their own, pushed over a WebSocket. Every delivery has a status; Preview and Download are on completed rows. The list narrows beside the panel. |
| 8 | Raj, then Sam | Raj is in Cardio only and sees only the Cardio deliveries. Sam is in Neuro only and gets "not found", the same answer as for one that does not exist. |
| 9 | Dev only: Load User | A big one: 100 files to 20 folders, 2,000 deliveries, in one action (`scripts/demo-send.sh`); counts live, only the rows in view drawn. |
| 10 | Dev only: the outage | The Document Platform is stopped (`scripts/demo-outage.sh stop`): nothing is lost, deliveries retry. It starts again and the backlog drains by itself to 2,000 delivered, once each. |
| 11 | The list | One list of distributions. Filter by whose they are and by status; scroll for more. Anyone in a destination team can preview a file; the link lasts two minutes. |

The script waits for each state it shows (for example every file Ready, the distribution Completed), so a slow day makes a longer video, not a broken one. If a step fails, the recorder stops with the step's name; fix it and run it again from the top.

## After recording

Tear dev down at once (about 4.5 USD a day):

```bash
scripts/empty-dev-buckets.sh dev --dry-run    # read it
scripts/empty-dev-buckets.sh dev
terraform -chdir=infra/envs/dev destroy -auto-approve $TFVARS
terraform -chdir=infra/envs/dev state list    # prints nothing
aws s3 ls                                     # only docbeam-tfstate-<account id>
```

The README points at `docs/demo/docbeam-demo.mp4`, which is made from the webm (ffmpeg is installed now): `ffmpeg -i docs/demo/docbeam-demo.webm -c:v libx264 -pix_fmt yuv420p -crf 26 -movflags +faststart docs/demo/docbeam-demo.mp4`. `.gitignore` keeps `*.mp4` out except this file. Last recorded 2026-10-21 on dev, after the row height, cells, reasons and date format changes (273 s, 23 checked frames).
