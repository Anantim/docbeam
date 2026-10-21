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

How every request from the browser travels: Web Client, then CloudFront (which forwards every /api/* call), then API Gateway (checks the token), then the VPC Link and internal load balancer into the private network, then the service. The steps below say "through API Gateway" for short. Background workers (the Lambdas) reach the database through RDS Proxy in prod (in dev, directly, one connection each), which shares a small pool of connections between them.

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

Accounts are set up by the study administrator (the seed script). The web app has no sign-up page; a visit to the old register address opens sign-in, and the Auth Service's register route is switched off at API Gateway (D-F1-17).

1. The user enters their email and password. An eye button in the password field shows or hides what was typed; it is hidden again after every attempt (D-F1-61).
2. Web Client sends them through API Gateway to the Auth Service. Login is one of the few routes that needs no token.
3. The Auth Service looks the user up in Auth DB and checks the password against the stored hash. The password itself is never stored.
4. **If the details are correct**, the Auth Service signs a token that lasts 15 minutes and sends it back, together with a refresh token in a secure cookie that the page's code cannot read. Web Client keeps the token for this browser tab and attaches it to every request. A minute before it expires, Web Client quietly swaps the refresh token for a new pair (POST /auth/refresh). Each refresh token works once; if an old one is used again more than 30 seconds after it was swapped, the whole sign-in is cancelled (within 30 seconds it is treated as a lost answer and the sign-in carries on, ADR-015, D-F1-19). Only a refused refresh ends the sign-in: a refresh that cannot reach the server, or a service that briefly cannot fetch the signing keys, gives a retryable error and the session stays (D-F1-14). After 12 hours the user enters the password again in a small dialog; requests made meanwhile wait and are sent again after sign-in, so nothing on the page is lost and no error appears behind the dialog.
5. **If they are wrong**, the Auth Service returns 401 with the same message whether the email or the password was wrong, so nobody can use it to find out who has an account. After 5 wrong passwords in a row, sign-in for that account pauses for 15 minutes, with the same message, and API Gateway limits how fast anyone can try. After any failed sign-in the page shows one fixed line: "After 5 wrong passwords in a row, sign-in pauses for 15 minutes. Wait, then try again." It is the same for every failure, so it reveals nothing about the account.
6. Signing out (POST /auth/logout) cancels the refresh token, so that sign-in cannot be resumed.

#### See your teams

1. Web Client asks for the user's teams through API Gateway, with the token attached.
2. API Gateway checks the token's signature and expiry. A missing, fake or expired token is rejected here with 401 and never reaches the private network.
3. The Document Platform checks the token again, then reads from Platform DB only the teams this user is a member of.
4. It returns the team names a page at a time, 50 per page, with a cursor for the next page, so a user in up to 50 teams gets them all in one call (D-F1-6, D-F1-16). The tree always starts with the teams only.

#### Open a team, binder or folder

1. The user clicks a team. Web Client asks for that team's binders.
2. The Document Platform checks in Platform DB that the user belongs to the team, and reads the binders in the same query. If the user is not a member, it returns 404.
3. The user clicks a binder or folder. Web Client asks for what is directly inside it, one level at a time.
4. The Document Platform checks membership of the team that owns the binder, then returns the folders and documents at that level, or 404.
5. This repeats for each deeper folder the user opens. Nothing is loaded until it is clicked, which keeps every response fast.
6. Binders and folders come 20 at a time. When the end of a level scrolls into view, Web Client asks for the next page with the cursor it was given; the access check runs again on every page, and a cursor names the last row seen, so nothing repeats or is skipped while the tree changes (D-F1-6).

#### Find a folder by name

1. One character typed in the tree's "Filter…" box narrows the rows already loaded, in the browser.
2. From 2 characters, after a short pause, Web Client asks the Document Platform for folders whose name contains the text (`GET /folders/search`). The platform searches only the user's own teams, in the same query, and returns each match with its full path, a page at a time (D-F1-67).
3. Picking a match opens the tree down to that folder and ticks it.

#### Choose destinations

1. Only folders receive files. Teams and binders are headings in the tree and have no tick box (D-F1-3).
2. The user ticks folders, before or after adding files. With no file selected, a tick goes to every file, including files added later while it stays ticked (it is "held"); with some files selected, it goes to those files only (D-F1-4, D-F1-5). A ticked folder shows how many files go to it ("3 files"), with the list one click away. This happens in the browser only; no request is sent.
3. Nothing is refused at the tick. The limits (at most 20 destinations, 100 files, 2,000 deliveries) are checked when the user presses Send.

> **Outcome.** The user has up to 20 folders they are allowed to use. Every browse response arrives in under 1 second, even for a user in 50 teams.

### Flow 2: Upload and distribute files

Diagram: Document Distribution Flow

#### Choose files

1. The user picks up to 100 files. Web Client refuses any file that is empty, over 1 GB, or of a type that is not allowed (allowed: PDF, DOCX, XLSX, PNG, JPG). The type comes from the file's contents, not its name: Web Client reads the first bytes (and, for DOCX and XLSX, the list of parts inside the ZIP) and refuses a file whose contents do not match its extension ("The contents are a PDF, but the name says .docx.") or are none of the allowed types. Refused files are listed in one "N files not added" box with the reason for each (D-F1-35, D-F1-44).
2. The user maps files to folders: a click on a file row selects or unselects it, and the folders ticked in the tree go to the selected files, or to every file when none is selected (Flow 1). Each file row shows how many folders it goes to ("2 folders", with the list one click away).
3. Web Client works out each file's fingerprint (SHA-256) in the background, so the page stays responsive. The user can preview any file before sending from its row. The preview opens the copy already in the browser, so nothing is sent.
4. The batch is kept for the browser tab (sessionStorage). If the page is reloaded, the files already uploaded are looked up again (GET /files?ids=) and the stored, clean ones come back with their folder ticks; a file that was still uploading cannot be read from disk again and is dropped, with a note saying how many could not be restored (D-F1-66).

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
5. If the file is clean, the Lambda reads the file's first bytes from the store to find its real type. If that type is the declared one, it tags the file clean, marks it uploaded and clean, and saves the detected type on the file record (`detected_type`), which every later screen uses for the file's type tag. If its size, fingerprint or contents do not match what the browser declared, it deletes the file and marks it failed (contents: reason CONTENT_TYPE). If a threat is found, it deletes the file and marks it infected. Each refusal leaves an audit record. The Object Store refuses to hand out any file that is not tagged clean.
6. While any file is being checked, Web Client asks the DocBeam API every 2 seconds (GET /files?ids=) and shows each file as Uploading, Scanning, Ready, Failed (the scan could not run or storage did not accept the file; Retry is offered) or Refused (malware found; final, the file cannot be sent). The reason is in the state's tooltip (D-F1-38, D-F1-60).
7. Send turns on only when every file is ready and goes to at least one folder. While it is off, a short line beside it says what blocks it, for example "Choose folders for 2 files" or "Wait for 1 file to finish scanning" (D-F1-20, D-F1-60).

#### Submit the job

1. The user clicks Send. A small dialog asks once, "Send 3 files to 2 folders?", with the line "Delivered files can't be recalled."; Cancel has the focus, so Esc or Enter answers no (D-F1-8, D-F1-23). On Send, Web Client sends the file IDs, their fingerprints and the file-to-destination mapping through API Gateway to the DocBeam API. It also sends a one-off key for this submission (Idempotency-Key, always required), so that a retry after a network error does not create a second job.
2. If that key was already used, even by a request that is still running, the DocBeam API returns that job and does nothing else.
3. The DocBeam API checks the batch itself: at most 100 files, 20 destinations and 2,000 deliveries, every file sent somewhere, and no destination listed twice for a file (otherwise 422 INVALID_BATCH). Then it checks in DocBeam DB that every file belongs to this user, was uploaded in the last 24 hours (otherwise 422 FILE_TOO_OLD), is confirmed and scanned clean (otherwise 422 FILE_NOT_READY), is not already in another job (otherwise 409 FILE_ALREADY_SUBMITTED), and has the same fingerprint as when its link was requested (otherwise 422 CHECKSUM_MISMATCH). If any check fails, it creates nothing.
4. Next it must ask the Document Platform about the destinations. For that it uses a service token, which the DocBeam API got from the Auth Service when it started and keeps renewing in the background, so no submission waits for one.
5. The DocBeam API sends all the destinations to the Document Platform in one request. For each one the platform checks that the binder exists, that the folder is inside that binder (a destination with no folder is refused: files go only to folders, D-F1-3), and that the user belongs to the binder's team. It answers with each destination's team, or lists the ones that failed. The team is never taken from the browser.
6. If any destination fails, the DocBeam API returns 422 DESTINATION_NOT_FOUND, names the bad destinations and creates nothing. A deleted folder and a folder in someone else's team get the same answer, so nobody can learn what exists outside their teams.
7. If the Document Platform does not answer, the DocBeam API returns 503 PLATFORM_UNAVAILABLE and creates nothing. Web Client shows "The platform is not answering. Try again." and the next Send reuses the same key, so a retry can never create a second job.
8. In **one database transaction**, the DocBeam API creates the job, links the files to it, creates one task for every file and destination pair (all marked pending, in one statement) and writes "job submitted" to the audit record. Either all of this is saved or none of it is.
9. It puts one message on the Job Queue. The message holds only the job ID.
10. It replies "job accepted", with the job ID and number of tasks, in under 500 ms (under 1 s at peak delivery load). Web Client clears the Distribute page and opens the new distribution on the Status page, with its panel open and the Status filters cleared, and says "Sent" (D-F1-31). The user is free to leave; everything below happens in the background.
11. **If that queue message is lost** (the send fails, or the API crashes just after saving), the Sweeper Lambda catches it. Every minute it looks for jobs that have not started 1 minute after they were queued and sends their message again (ADR-014). The job starts within about 2 minutes instead of never.

#### Split the job into tasks (fan-out)

1. The Job Queue starts the Fan-out Lambda with the job ID.
2. The Fan-out Lambda records in DocBeam DB that the job has started (`fanned_out_at`), so the Sweeper leaves it alone.
3. It reads the job's pending task IDs.
4. It puts one message per task on the Task Queue, 10 at a time. Each message holds only a task ID, never a token.
5. **If the Fan-out Lambda fails 3 times**, the job message moves to the Job DLQ. The DLQ Consumer then marks every pending task in the job as failed with **FANOUT_FAILED**, closes the job and tells anyone watching (see the last step of "Deliver each task").

#### Deliver each task

These steps run separately for every task. One slow or failed task never holds up the others.

1. The Task Queue starts the Delivery Lambda with one task ID.
2. The Delivery Lambda claims the task in DocBeam DB: it sets it to in progress and adds 1 to its attempt count. If the task is already completed or failed (the same message arrived twice), it stops here. If this is a second or later try, it pushes one small update to anyone watching, so the delivery shows as "Retrying" at once (D-F1-65).
3. It checks the file in the Object Store without downloading it: is it there, and does its fingerprint match? If the file is missing, the task fails with **FILE_NOT_UPLOADED**. If the fingerprint differs, it fails with **CHECKSUM_MISMATCH**. Either way, skip to step 7.
4. It uses its saved service token, getting a new one from the Auth Service only on a cold start or near expiry. If the platform ever rejects the token (401), it gets a new one and tries again at once.
5. It reads the file from the Object Store and streams it to the Document Platform, together with the task ID, the destination and the user it is acting for.
6. The Document Platform checks again that the destination still exists and that the user is still a member of its team. If this task already has a document, it returns it without reading the file again. Otherwise it checks that the file's first bytes match its type and works out the fingerprint as the file arrives. Then one of six things happens:
   1. **Member and fingerprint matches:** the platform saves the file in the Platform File Store and records the document in Platform DB, once per task ID. If the same task arrives again, it returns the existing document instead of saving a copy. It replies 201 (new) or 200 (already saved), and the Delivery Lambda marks the task **completed**.
   2. **No longer a member:** the platform replies 403 NOT_A_MEMBER and the task fails with **NOT_AUTHORIZED_AT_DELIVERY**.
   3. **Destination gone:** the binder or folder was deleted after the job was submitted. The platform replies 404 and the task fails with **DESTINATION_NOT_FOUND**.
   4. **Fingerprint does not match:** the platform deletes what it received, replies 422, and the task fails with **CHECKSUM_MISMATCH**.
   5. **Contents are not the declared type** (for example a renamed program): the platform replies 422 and the task fails with **UNSUPPORTED_TYPE**.
   6. **Platform down, busy, too slow or any other error:** the Delivery Lambda gives up on this attempt after at most 100 seconds (a busy platform holds the request for up to 30 seconds, then answers 503 PLATFORM_BUSY) and asks the queue to hand the message back after a short wait: 30 seconds after the first try, then 2, 5 and 10 minutes. The task goes back to pending until then.
7. Once the task is completed or failed, the Delivery Lambda locks the job record, saves the result and an audit entry, and checks whether every task in the job is now finished. If so, it marks the job finished (`completed_at`). The lock makes sure that when the last two tasks finish together, one of them always closes the job.
8. It looks up which open dashboards are watching this job (`ws_connections`) and pushes the new status through the WebSocket API to the sender and to viewers in that delivery's team. If a dashboard has gone away, its record is deleted. A failed push never fails the delivery.

#### When retries run out

1. If a delivery fails 5 times (about 17 minutes in all, enough to ride out a short platform outage), its message moves to the Task DLQ.
2. The DLQ Consumer marks the task failed with **RETRIES_EXHAUSTED** and the last error, closes the job if nothing else is open, and pushes the update to anyone watching.
3. If deliveries failed with RETRIES_EXHAUSTED or FANOUT_FAILED, the sender can press Retry failed while the job runs or within 24 hours of its first finish, as long as its files are less than 2 days old. The DocBeam API sets just those tasks back to pending and clears their failure, records the retry in the audit record, and sends the job through fan-out again. Deliveries that failed for a reason a retry cannot fix (a wrong fingerprint or type, a removed member, a deleted folder) stay failed.

> **Outcome.** The job is accepted at once and the user never waits for deliveries. Every file is checked by fingerprint at upload, before sending and on arrival. Each task ends either **completed** or failed with a clear reason, and a task is never lost without a visible failure. Files uploaded but never submitted are deleted after 24 hours.

### Flow 3: Track a job

Diagram: Track a Job

#### Connect for live updates

1. The user opens the dashboard. Web Client opens a live connection to the WebSocket API, putting the token in the connection address (browsers cannot add headers to this kind of connection).
2. The WebSocket API runs the WS Handler for a new connection.
3. The WS Handler checks the token. If it is invalid, the connection is refused with 401. If it is valid, the handler saves a record in `ws_connections` with the connection ID and the user.

#### See the job list

1. Web Client asks for the user's jobs through API Gateway to the DocBeam API (`GET /jobs`), 20 at a time, newest first.
2. The DocBeam API reads the jobs from DocBeam DB and counts their tasks by status, for the whole page in one query.
3. It returns the page and a cursor for the next one. Each job's status is worked out from its task counts: **pending** (nothing started, or no deliveries at all), **in progress** (some tasks still open), **completed** (all delivered), **completed with errors** (all finished, at least one failed) or cancelled (the sender stopped it and nothing is still running). The totals keep cancelled deliveries apart from real failures and show them in grey.
4. The list is one list of everything the user can see: the distributions they sent, and distributions by others with at least one delivery to a team the user belongs to. The DocBeam API asks the Document Platform for the user's teams (cached for 60 seconds) and finds those jobs by the team on each task. Counts, status, file names and folders cover only the deliveries to the user's teams (D-F1-21).
5. Each row shows the short ID (the first 8 characters) with the sender under it ("You" or a name), the status, when it was sent ("Today, 04:34"), and, at full width, the first file name and the first two folders, with "+N" for the rest (the full list on hover). Four filters narrow the list on the server: Status, Sender (anyone, me, or one person in my teams), Sent (any time, today, last 7 or 30 days) and Team (shown only to someone in more than one team). The filters are kept in the page address (D-F1-21, D-F1-40, D-F1-57, D-F1-59).
6. More rows load as the user scrolls near the end of the list, with the cursor the server gave; the cursor is the position of the last row (time sent and ID), so a distribution that arrives meanwhile cannot repeat or skip a row (D-F1-40, D-F1-49).
7. The Status tab shows how many distributions the user can see are still pending or in progress (`GET /jobs/running`, ignoring filters, D-F1-34). The list and that count are read again when the Status page opens, after a send, cancel or retry, when the tab comes back into view, and every 30 seconds while something is running. Live updates are only for the job the user has open.

#### Open a job

1. The user opens a job: their own, or one with deliveries to their team. A click on its row opens it in a side panel beside the list; a copied link opens it directly; and Open by ID takes the 8-character ID from the list (looked up with `GET /jobs?idPrefix=`, among the jobs the user can see), the full ID or a link (D-F1-29, D-F1-32). Opening a job this way (Open by ID, a link or the address) scrolls the list to its row and highlights it, reading up to 5 more pages if needed; if it is still not there, the row is shown pinned at the top (D-F1-74). The page address keeps the open job (`#/status/<job id>`), so a reload reopens it.
2. Web Client **first subscribes** to the job over the live connection, before loading its tasks. That way no update can slip through between loading and listening.
3. The WS Handler looks up who sent the job. If the viewer is someone else, it gets a service token if needed and asks the Document Platform for the viewer's teams. The viewer may watch the job only if at least one of its deliveries goes to one of those teams.
4. If allowed, the handler saves the job ID and the viewer's teams on the connection record. If not, it clears the subscription. Either way it answers on the connection: subscribed, or not found (a job that does not exist and one the viewer may not see get the same answer).
5. Once Web Client has the subscribed answer, it asks for the job's tasks through API Gateway, 100 per page, optionally filtered by status.
6. The DocBeam API makes the same check. If it fails, it returns 404. A viewer who is not the sender gets only the deliveries to their own teams.
7. It returns each task with its destination, status, attempt count, the file's type (the detected type, D-F1-44) and, for failed tasks, the reason.
8. The panel shows who sent the job and when ("Sent by Priya Shah · Today, 07:07"); for someone other than the sender it adds "Showing deliveries to your teams: Cardio, Neuro." Under it come a progress line, the status tabs with their counts (All, Completed, Failed, In progress, Pending, and Cancelled when there are any) and the deliveries, each with its file, folder path and status. A failed or cancelled delivery's reason, and its attempts where they apply, are in a tooltip on its status and on an info icon, written in plain words, never as a code (D-F1-52, D-F1-60). Completed deliveries have Preview and Download. Retry failed and Cancel distribution each explain what they do in a tooltip, and the progress line gives its counts in words (D-F1-72).
9. The web app shows job history only. Every action and delivery outcome is still written to the append-only audit record and `GET /audit` still answers, but no screen shows it (D-F1-13).
10. While deliveries are still waiting, the sender can press Cancel distribution, which asks first. The DocBeam API locks the job, marks every delivery that has not started as failed with CANCELLED, and records it in the audit record. Deliveries already running finish normally. The DocBeam API then pushes one update to everyone watching the job, and their pages reload the tasks. Cancelled deliveries show in grey and are counted apart from failures. Cancel is offered only while the distribution is running. Retry failed also pushes one update when it is pressed.

#### Live updates

1. Each time the Delivery Lambda or the DLQ Consumer finishes a task, it pushes the new status, the time of the change and fresh totals to the sender's connections and to connections of viewers in that delivery's team. Each gets totals for what they can see. The Delivery Lambda also pushes when a delivery starts a second try or a later one, so its chip changes to "Retrying" and the totals move without a refresh (D-F1-65).
2. The dashboard updates that row and the totals without a refresh. A push older than what the row already shows is ignored, since pushes can arrive out of order.
3. If the connection drops, Web Client reconnects, subscribes again, and reloads the tasks once to catch up. Nothing is missed.
4. When the user closes the page, the WebSocket API runs the WS Handler, which deletes the connection record.
5. Each connection record keeps the token's expiry, and nothing is pushed to an expired one. When Web Client refreshes its token (every 15 minutes), it reconnects with the new one and is checked again, so someone removed from a team stops getting updates within 15 minutes.

> **Outcome.** The sender sees every task change in real time, up to 2,000 per job, and anyone in a destination team sees the changes for their team's deliveries, with no refreshing and no polling.

### Flow 4: Download a file

Diagram: Retrieve a File

1. The user opens a job (their own, or one with deliveries to their team) and clicks Preview or Download on a completed delivery.
2. Web Client asks for a link through API Gateway to the DocBeam API, saying whether it is for a download or a preview. Anything else gets 400.
3. The DocBeam API looks up the file, its job, who sent it and which teams it was delivered to in DocBeam DB.
4. If the user is not the sender, it asks the Document Platform for the user's teams. The user may download the file only if it was delivered (the delivery completed) to one of them.
5. **If the file exists and the user is allowed**, the DocBeam API signs a download link for that one file, valid for 2 minutes, that saves the file under its original name, or, for a preview, opens it in the page. Like the upload link, it is signed locally with no call to AWS.
6. It returns the link with the file's name, type (the type detected from its contents) and size (read from its record, never from the browser), and Web Client downloads the file straight from the Object Store, or shows it in a viewer on the page: PDF and images straight from the link, DOCX and XLSX (up to 50 MB) turned into a read-only page in the browser. A preview is recorded in the audit record like a download. After Download, a bar on the page counts down the link's 2 minutes, then says the link has expired and Download gives a fresh one. The file contents never pass through our servers.
7. The Object Store checks the link's signature and expiry before sending anything. An expired or altered link is refused.
8. **If the file does not exist or the user is not allowed**, the DocBeam API returns 404, and neither a link nor an audit entry is created. The same answer covers a file not scanned clean or not in any distribution. Both cases get the same answer, so a stranger cannot even learn that the file exists.
9. If the uploaded file is past its storage period (33 days after upload), the DocBeam API answers 410 File no longer available instead of signing a link that would fail. It checks this only after the access check, so a stranger gets 404 even for an old file.

> **Outcome.** Only the sender, and members of a team the file was delivered to, can get a working link. Each link opens one file for 2 minutes, and downloads are direct and fast up to 1 GB. Uploaded files stay available for at least 30 days after the job finishes.
