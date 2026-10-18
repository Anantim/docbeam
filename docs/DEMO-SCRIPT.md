# Demo script: a 3 to 5 minute screen recording on dev

What the video shows, in order: sign in, upload files, the virus test file refused, a 2,000-delivery send, the Audit tab (who sent what, where and when), Raj seeing only the Cardio deliveries and Sam getting "not found", live tracking, the platform stopped and the backlog draining, a preview and a download. Target length 3 to 5 minutes. `scripts/demo/record.ts` records every step in a browser (1280 x 720, a cursor, a caption per step, no voice); this table is the plan it follows. Record at 1080p with the browser zoom at 110%.

The video link goes into the README ("Demo video" section) when it exists.

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

### Get ready (5 minutes)

```bash
scripts/demo-files.sh                       # 12 PDFs, a PNG and the EICAR test file in ~/docbeam-demo-files
export SEED_PW=$(aws secretsmanager get-secret-value --secret-id docbeam-dev/seed/user-password \
  --query SecretString --output text --region ap-southeast-2)    # copy it to the sign-in box; never show it on screen
```

- Use two browser windows: one signed in as **Anantim Patil** (`anantim.patil@example.com`, in Cardio, Oncology and Neuro) for the upload, and one signed in as **Load User** (`load.user@example.com`, in 50 teams) for the big send. The password is the seed password for both.
- Hide the bookmarks bar and the password. Keep the AWS Console closed.
- Do one dry run of the whole script first. The first sign-in after a bring-up is slower.

## The script

| Time | Screen | Say | Do |
|---|---|---|---|
| 0:00 | Sign-in page | "DocBeam sends clinical trial documents to many team folders at once and tracks every delivery. This is the version running on AWS." | Sign in as Anantim. |
| 0:15 | Distribute, Destinations panel | "I only see the teams I belong to." | Expand Cardio, tick two folders and one Oncology folder. |
| 0:35 | Pick files | "Up to 100 files, each checked in the browser: type, size and a SHA-256 fingerprint." | Select all the PDFs and the PNG from the demo folder. Rows go Checking, then Verified. |
| 1:00 | The refused file | "Every upload is scanned for malware. This is the standard antivirus test file." | Add `EICAR test file.pdf`. Show it turn to Refused ("infected"). Say it is deleted and can never be sent or downloaded. |
| 1:20 | Mapping, Review | "Files go to folders. Here are 13 files to 3 folders, 39 deliveries." | Map the files, click Review, then Send. |
| 1:40 | Status page | "Each delivery is tracked. The counts move live." | Watch the counts and rows change. Open one delivered row. |
| 1:55 | Status page, Audit tab | "The Audit tab records who sent what, to where, and when." | Click the Audit tab of the distribution just sent. Point at the "Distribution sent" row (sender, time) and the per-delivery rows (file, destination). About 12 seconds. |
| 2:10 | Raj's window (Cardio only) | "Raj is in the Cardio team only. He sees only the Cardio deliveries of this distribution, and nothing for Oncology." | Sign in as `raj.mehta@example.com`, open the distribution (same address). Point at the rows: Cardio folders only. About 20 seconds. |
| 2:30 | Sam's window (Neuro only) | "Sam is in the Neuro team only. For this distribution he gets 'not found', the same answer as for one that does not exist." | Sign in as `sam.ito@example.com`, open the same address: "Distribution not found". About 15 seconds. |
| 2:45 | Second window, Load User | "Now a big one: 100 files to 20 folders, 2,000 deliveries, sent in one action." | In a terminal off screen run `scripts/demo-send.sh`; paste the printed address into the second window. |
| 3:05 | Live tracking | "Counts, per-delivery status, failures with a reason. Nothing is polled; it is pushed over a WebSocket." | Scroll the table (it draws only the rows in view). Point at the bars. |
| 3:30 | Terminal and Status page | "Now I stop the Document Platform. This is what an outage looks like." | Run `scripts/demo-outage.sh stop`. Show deliveries turn amber (retrying), nothing is lost. |
| 4:00 | Status page | "Start it again. The backlog drains by itself and the dead-letter queue stays empty." | Run `scripts/demo-outage.sh start`. Watch the counts climb to 2,000 delivered. |
| 4:30 | Status page, one delivered row | "Anyone in a destination team can open the file; everyone else gets nothing." | Click Preview on a PDF, then Download. Show the countdown bar for the 2-minute link. |
| 4:50 | End | "Built with Terraform and checked end to end on this system. The code and the design are on GitHub." | Stop. |

The times above are the live pace of about 5 minutes. The recorded video speeds up the waiting parts (the upload and scan of the big send, the terminal steps and the drain), so it runs 3 to 5 minutes.

If a step goes wrong, stop recording, fix it, start again from the top of that row.

## After recording

Tear dev down at once (about 4.5 USD a day):

```bash
scripts/empty-dev-buckets.sh dev --dry-run    # read it
scripts/empty-dev-buckets.sh dev
terraform -chdir=infra/envs/dev destroy -auto-approve $TFVARS
terraform -chdir=infra/envs/dev state list    # prints nothing
aws s3 ls                                     # only docbeam-tfstate-<account id>
```

Then put the video link in the README.
