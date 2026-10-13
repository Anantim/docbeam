# DocBeam detailed user flows

## Detailed User Flows

These are the four things a user does in DocBeam, written out step by step. Each flow matches its sequence diagram in the [Eraser workspace](https://app.eraser.io/workspace/Wj6gXZ0DTYhnxzoPnwYY), and the step numbers follow the same order.

### Before you read

| **Term** | **What it means here** |
|---|---|
| **Web Client** | The DocBeam web page the user works in |
| **Token (JWT)** | A signed pass the user gets at login. It lasts 15 minutes and goes with every request so each service knows who is asking. A separate refresh token, kept in a secure cookie, quietly gets a new one, so a sign-in lasts 12 hours |
| **Service token** | The same idea, but for one of our services calling another. It says which service is calling and what it may do (ADR-013) |
| **Presigned link** | A short-lived web address that lets the browser upload or download one specific file directly, with no server in between |
| **Fingerprint (SHA-256)** | A code worked out from a file's contents. If even one byte changes, the fingerprint changes, so it proves the file arrived intact |
| **Task** | One file going to one destination. 10 files sent to 3 folders is 30 tasks |

How every request from the browser travels: Web Client, then API Gateway (checks the token), then the VPC Link and internal load balancer into the private network, then the service. The steps below say "through API Gateway" for short. Background workers (the Lambdas) reach the database through RDS Proxy, which shares a small pool of connections between them.

### Who can see what

Access is decided by team membership. If you belong to a team, you can see and send to every binder and folder in that team. There are no separate permissions per binder or folder in v1. The sender always sees their whole distribution; anyone else sees only the deliveries that went to their own teams. Membership is checked again at every step that matters, never assumed from an earlier check.

| **Situation** | **What happens** |
|---|---|
| Priya is in Team Cardio and Team Oncology. She opens the destination browser | She sees only Cardio and Oncology, with all their binders and folders |
| Priya types in the ID of a binder that belongs to Team Neuro | **404 Not found**. The answer does not even confirm the binder exists |
| Priya submits a job with one destination in Team Neuro | **422 DESTINATION_NOT_FOUND**. The whole job is refused and nothing is created |
| Raj, also in Team Cardio, opens Priya's job | He sees only the deliveries to Cardio and can download only the files delivered to Cardio. Priya's Oncology deliveries stay hidden from him |
| Sam, who is in neither Cardio nor Oncology, opens Priya's job | **404 Not found**, the same answer as for a job that does not exist |
| Priya is removed from Oncology after submitting, before delivery | Her Oncology tasks fail with **NOT_AUTHORIZED_AT_DELIVERY**. Her Cardio tasks still deliver |

### Flow 1: Browse and choose destinations

Diagram: Browse Destinations

#### Log in

1. The user enters their email and password.
2. Web Client sends them through API Gateway to the Auth Service. Login is one of the few routes that needs no token.
3. The Auth Service looks the user up in Auth DB and checks the password against the stored hash. The password itself is never stored.
4. **If the details are correct**, the Auth Service signs a token that lasts 15 minutes and sends it back, together with a refresh token in a secure cookie that the page's code cannot read. Web Client keeps the token for this browser tab and attaches it to every request. A minute before it expires, Web Client quietly swaps the refresh token for a new pair (POST /auth/refresh). Each refresh token works once; if an old one is ever used again, the whole sign-in is cancelled. After 12 hours the user enters the password again in a small dialog, and nothing on the page is lost.
5. **If they are wrong**, the Auth Service returns 401 with the same message whether the email or the password was wrong, so nobody can use it to find out who has an account. After 5 wrong passwords in a row, sign-in for that account pauses for 15 minutes, with the same message, and API Gateway limits how fast anyone can try.
6. Signing out (POST /auth/logout) cancels the refresh token, so that sign-in cannot be resumed.

#### See your teams

1. Web Client asks for the user's teams through API Gateway, with the token attached.
2. API Gateway checks the token's signature and expiry. A missing, fake or expired token is rejected here with 401 and never reaches the private network.
3. The Document Platform checks the token again, then reads from Platform DB only the teams this user is a member of.
4. It returns the list of team names.

#### Open a team, binder or folder

1. The user clicks a team. Web Client asks for that team's binders.
2. The Document Platform checks in Platform DB that the user belongs to the team, and reads the binders in the same query. If the user is not a member, it returns 404.
3. The user clicks a binder or folder. Web Client asks for what is directly inside it, one level at a time.
4. The Document Platform checks membership of the team that owns the binder, then returns the folders and documents at that level, or 404.
5. This repeats for each deeper folder the user opens. Nothing is loaded until it is clicked, which keeps every response fast.

#### Choose destinations

1. The user ticks the folders (or the top level of a binder) they want to send to, up to 20. This happens in the browser only; no request is sent.

> **Outcome.** The user has up to 20 destinations they are allowed to use. Every browse response arrives in under 1 second, even for a user in 50 teams.

### Flow 2: Upload and distribute files

Diagram: Document Distribution Flow

#### Choose files

1. The user picks up to 100 files. Web Client refuses any file over 1 GB or of a type that is not allowed (allowed: PDF, DOCX, XLSX, PNG, JPG).
2. The user maps each file to one or more of the destinations chosen in Flow 1. Web Client shows how many deliveries this makes, for example 100 files x 20 destinations = 2,000.
3. Web Client works out each file's fingerprint (SHA-256) in the background, so the page stays responsive. The user can preview any file before sending, from the file list or the Review section. The preview opens the copy already in the browser, so nothing is sent.

#### Get upload links

1. Web Client sends each file's name, size, type and fingerprint through API Gateway to the DocBeam API, up to 20 files per request. It asks for **one link per file, not per destination**: a file is uploaded once even if it goes to 20 places.
2. The DocBeam API creates a record for each file in DocBeam DB. The file belongs to the user but is not part of any job yet. Its storage location is `staging/{userId}/{fileId}`.
3. The DocBeam API signs a presigned upload link for each file, valid for 15 minutes. Signing happens inside the DocBeam API using its own AWS permissions, never the user's, and makes no call to AWS. The link only allows uploading that one file, at that size or smaller, of that type, with that fingerprint.
4. It returns the file IDs and links. For any file over 100 MB, it tells Web Client to upload that file in parts instead.

#### Large files (over 100 MB)

1. When Web Client starts a large file, it works out a fingerprint for each part as well as for the whole file, and asks the DocBeam API to start a multipart upload.
2. The DocBeam API asks the Object Store to start one, saves the upload ID in DocBeam DB and returns one signed link per part. Each link carries that part's fingerprint, so the Object Store refuses a damaged part.
3. If the upload runs past 15 minutes, Web Client asks for fresh links for the parts it has not started yet, so a slow 1 GB upload never gets stuck.
4. When every part is in, Web Client tells the DocBeam API. The API checks that all the parts are there and add up to the declared size, asks the Object Store to join them, and saves the checksum the Object Store reports for the joined file.

#### Upload

1. Web Client uploads each file (or each part) straight to the Object Store, 4 to 6 at a time. The file contents never pass through API Gateway or the DocBeam API.
2. The Object Store checks the upload against the link: size, type and fingerprint. If anything does not match, it refuses the upload (403) and stores nothing. Web Client marks that file as failed so the user can retry it.
3. For a large file, the parts are joined as described above.
4. Once a file is stored, the Object Store puts an event on the Upload Events Queue. The Upload Events Lambda checks the stored file's size and fingerprint, then scans the file for malware with ClamAV.
5. If the file is clean, the Lambda tags it clean and marks it uploaded and clean. If a threat is found, it deletes the file and marks it infected. The Object Store refuses to hand out any file that is not tagged clean.
6. While any file is being checked, Web Client asks the DocBeam API every 2 seconds (GET /files?ids=) and shows each file as Checking, Verified, or Refused with the reason (infected, or could not be checked).
7. The Send button turns on only when every file is verified.

#### Submit the job

1. Under the file list and the destinations, a Review section shows every destination with the names of the files going to it, each of which can be previewed or removed from that folder (a file left with no folder drops out of the distribution). The user clicks Send, and Web Client sends the file IDs, their fingerprints and the file-to-destination mapping through API Gateway to the DocBeam API. It also sends a one-off key for this submission (Idempotency-Key, always required), so that a retry after a network error does not create a second job.
2. If that key was already used, even by a request that is still running, the DocBeam API returns that job and does nothing else.
3. The DocBeam API checks the batch itself: at most 100 files, 20 destinations and 2,000 deliveries, every file sent somewhere, and no destination listed twice for a file (otherwise 422 INVALID_BATCH). Then it checks in DocBeam DB that every file belongs to this user, was uploaded in the last 24 hours (otherwise 422 FILE_TOO_OLD), is confirmed and scanned clean (otherwise 422 FILE_NOT_READY), is not already in another job (otherwise 409 FILE_ALREADY_SUBMITTED), and has the same fingerprint as when its link was requested (otherwise 422 CHECKSUM_MISMATCH). If any check fails, it creates nothing.
4. Next it must ask the Document Platform about the destinations. For that it uses a service token, which the DocBeam API got from the Auth Service when it started and keeps renewing in the background, so no submission waits for one.
5. The DocBeam API sends all the destinations to the Document Platform in one request. For each one the platform checks that the binder exists, that the folder is inside that binder, and that the user belongs to the binder's team. It answers with each destination's team, or lists the ones that failed. The team is never taken from the browser.
6. If any destination fails, the DocBeam API returns 422 DESTINATION_NOT_FOUND, names the bad destinations and creates nothing. A deleted folder and a folder in someone else's team get the same answer, so nobody can learn what exists outside their teams.
7. In **one database transaction**, the DocBeam API creates the job, links the files to it, creates one task for every file and destination pair (all marked pending, in one statement) and writes "job submitted" to the audit trail. Either all of this is saved or none of it is.
8. It puts one message on the Job Queue. The message holds only the job ID.
9. It replies "job accepted", with the job ID and number of tasks, in under 500 ms. The user is free to leave; everything below happens in the background.
10. **If that queue message is lost** (the send fails, or the API crashes just after saving), the Sweeper Lambda catches it. Every minute it looks for jobs that have not started 2 minutes after they were queued and sends their message again (ADR-014). The job starts within about 3 minutes instead of never.

#### Split the job into tasks (fan-out)

1. The Job Queue starts the Fan-out Lambda with the job ID.
2. The Fan-out Lambda records in DocBeam DB that the job has started (`fanned_out_at`), so the Sweeper leaves it alone.
3. It reads the job's pending task IDs.
4. It puts one message per task on the Task Queue, 10 at a time. Each message holds only a task ID, never a token.
5. **If the Fan-out Lambda fails 3 times**, the job message moves to the Job DLQ. The DLQ Consumer then marks every pending task in the job as failed with **FANOUT_FAILED**, closes the job and tells anyone watching (see the last step of "Deliver each task").

#### Deliver each task

These steps run separately for every task. One slow or failed task never holds up the others.

1. The Task Queue starts the Delivery Lambda with one task ID.
2. The Delivery Lambda claims the task in DocBeam DB: it sets it to in progress and adds 1 to its attempt count. If the task is already completed or failed (the same message arrived twice), it stops here.
3. It checks the file in the Object Store without downloading it: is it there, and does its fingerprint match? If the file is missing, the task fails with **FILE_NOT_UPLOADED**. If the fingerprint differs, it fails with **CHECKSUM_MISMATCH**. Either way, skip to step 7.
4. It uses its saved service token, getting a new one from the Auth Service only on a cold start or near expiry. If the platform ever rejects the token (401), it gets a new one and tries again at once.
5. It reads the file from the Object Store and streams it to the Document Platform, together with the task ID, the destination and the user it is acting for.
6. The Document Platform checks again that the destination still exists and that the user is still a member of its team. If this task already has a document, it returns it without reading the file again. Otherwise it checks that the file's first bytes match its type and works out the fingerprint as the file arrives. Then one of six things happens:
   1. **Member and fingerprint matches:** the platform saves the file in the Platform File Store and records the document in Platform DB, once per task ID. If the same task arrives again, it returns the existing document instead of saving a copy. It replies 201 (new) or 200 (already saved), and the Delivery Lambda marks the task **completed**.
   2. **No longer a member:** the platform replies 403 NOT_A_MEMBER and the task fails with **NOT_AUTHORIZED_AT_DELIVERY**.
   3. **Destination gone:** the binder or folder was deleted after the job was submitted. The platform replies 404 and the task fails with **DESTINATION_NOT_FOUND**.
   4. **Fingerprint does not match:** the platform deletes what it received, replies 422, and the task fails with **CHECKSUM_MISMATCH**.
   5. **Contents are not the declared type** (for example a renamed program): the platform replies 422 and the task fails with **UNSUPPORTED_TYPE**.
   6. **Platform down, too slow or any other error:** the Delivery Lambda gives up on this attempt after at most 100 seconds and asks the queue to hand the message back after a short wait: 30 seconds after the first try, then 2, 5 and 10 minutes. The task goes back to pending until then.
7. Once the task is completed or failed, the Delivery Lambda locks the job record, saves the result and an audit entry, and checks whether every task in the job is now finished. If so, it marks the job finished (`completed_at`). The lock makes sure that when the last two tasks finish together, one of them always closes the job.
8. It looks up which open dashboards are watching this job (`ws_connections`) and pushes the new status through the WebSocket API to the sender and to viewers in that delivery's team. If a dashboard has gone away, its record is deleted. A failed push never fails the delivery.

#### When retries run out

1. If a delivery fails 5 times (about 17 minutes in all, enough to ride out a short platform outage), its message moves to the Task DLQ.
2. The DLQ Consumer marks the task failed with **RETRIES_EXHAUSTED** and the last error, closes the job if nothing else is open, and pushes the update to anyone watching.
3. If deliveries failed with RETRIES_EXHAUSTED or FANOUT_FAILED, the sender can press Retry failed deliveries while the job runs or within 24 hours of its first finish, as long as its files are less than 2 days old. The DocBeam API sets just those tasks back to pending and clears their failure, records the retry in the audit trail, and sends the job through fan-out again. Deliveries that failed for a reason a retry cannot fix (a wrong fingerprint or type, a removed member, a deleted folder) stay failed.

> **Outcome.** The job is accepted at once and the user never waits for deliveries. Every file is checked by fingerprint at upload, before sending and on arrival. Each task ends either **completed** or failed with a clear reason, and a task is never lost without a visible failure. Files uploaded but never submitted are deleted after 24 hours.

### Flow 3: Track a job

Diagram: Track a Job

#### Connect for live updates

1. The user opens the dashboard. Web Client opens a live connection to the WebSocket API, putting the token in the connection address (browsers cannot add headers to this kind of connection).
2. The WebSocket API runs the WS Handler for a new connection.
3. The WS Handler checks the token. If it is invalid, the connection is refused with 401. If it is valid, the handler saves a record in `ws_connections` with the connection ID and the user.

#### See the job list

1. Web Client asks for the user's jobs through API Gateway to the DocBeam API.
2. The DocBeam API reads the jobs from DocBeam DB and counts their tasks by status, for the whole page in one query.
3. It returns the list. Each job's status is worked out from its task counts: **pending** (nothing started), **in progress** (some tasks still open), **completed** (all delivered), **completed with errors** (all finished, at least one failed) or cancelled (the sender stopped it and nothing is still running).
4. The list has two views: My distributions, and My teams' distributions. The second shows distributions by others with at least one delivery to a team the user belongs to. The DocBeam API asks the Document Platform for the user's teams (cached for 60 seconds) and finds those jobs by the team on each task. Counts and status cover only the deliveries to the user's teams.
5. The list refreshes its counts every 30 seconds. Live updates are only for the job the user has open.

#### Open a job

1. The user opens a job: their own, or one with deliveries to their team (for example from a shared link).
2. Web Client **first subscribes** to the job over the live connection, before loading its tasks. That way no update can slip through between loading and listening.
3. The WS Handler looks up who sent the job. If the viewer is someone else, it gets a service token if needed and asks the Document Platform for the viewer's teams. The viewer may watch the job only if at least one of its deliveries goes to one of those teams.
4. If allowed, the handler saves the job ID and the viewer's teams on the connection record. If not, the subscription is refused.
5. Web Client then asks for the job's tasks through API Gateway, 100 per page, optionally filtered by status.
6. The DocBeam API makes the same check. If it fails, it returns 404. A viewer who is not the sender gets only the deliveries to their own teams.
7. It returns each task with its destination, status and, for failed tasks, the reason.
8. The job page also has an Audit tab: every action on the job and every delivery outcome the user may see, with who and when, read from an append-only record. A separate Audit trail page shows the whole history across every distribution the user can see, filtered by distribution or type of event. For other people's distributions it shows when they were sent, retried or cancelled, and the events for deliveries to the user's teams.
9. While deliveries are still waiting, the sender can press Cancel distribution. The DocBeam API locks the job, marks every delivery that has not started as failed with CANCELLED, and records it in the audit trail. Deliveries already running finish normally. The DocBeam API then pushes one update to everyone watching the job, and their pages reload the tasks.

#### Live updates

1. Each time the Delivery Lambda or the DLQ Consumer finishes a task, it pushes the new status, the time of the change and fresh totals to the sender's connections and to connections of viewers in that delivery's team. Each gets totals for what they can see.
2. The dashboard updates that row and the totals without a refresh. A push older than what the row already shows is ignored, since pushes can arrive out of order.
3. If the connection drops, Web Client reconnects, subscribes again, and reloads the tasks once to catch up. Nothing is missed.
4. When the user closes the page, the WebSocket API runs the WS Handler, which deletes the connection record.
5. Each connection record keeps the token's expiry, and nothing is pushed to an expired one. When Web Client refreshes its token (every 15 minutes), it reconnects with the new one and is checked again, so someone removed from a team stops getting updates within 15 minutes.

> **Outcome.** The sender sees every task change in real time, up to 2,000 per job, and anyone in a destination team sees the changes for their team's deliveries, with no refreshing and no polling.

### Flow 4: Download a file

Diagram: Retrieve a File

1. The user opens a job (their own, or one with deliveries to their team) and clicks Preview or Download on a file.
2. Web Client asks for a link through API Gateway to the DocBeam API, saying whether it is for a download or a preview.
3. The DocBeam API looks up the file, its job, who sent it and which teams it was delivered to in DocBeam DB.
4. If the user is not the sender, it asks the Document Platform for the user's teams. The user may download the file only if it was delivered (the delivery completed) to one of them.
5. **If the file exists and the user is allowed**, the DocBeam API signs a download link for that one file, valid for 2 minutes, that saves the file under its original name, or, for a preview, opens it in the page. Like the upload link, it is signed locally with no call to AWS.
6. It returns the link, and Web Client downloads the file straight from the Object Store, or shows it in a viewer on the page: PDF and images as they are, DOCX and XLSX turned into a read-only page in the browser. A preview is recorded in the audit trail like a download. The file contents never pass through our servers.
7. The Object Store checks the link's signature and expiry before sending anything. An expired or altered link is refused.
8. **If the file does not exist or the user is not allowed**, the DocBeam API returns 404 and no link is ever created. Both cases get the same answer, so a stranger cannot even learn that the file exists.
9. If the uploaded file is past its storage period (33 days after upload), the DocBeam API answers 410 File no longer available instead of signing a link that would fail.

> **Outcome.** Only the sender, and members of a team the file was delivered to, can get a working link. Each link opens one file for 2 minutes, and downloads are direct and fast up to 1 GB. Uploaded files stay available for at least 30 days after the job finishes.
