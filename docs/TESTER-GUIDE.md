# DocBeam tester guide

DocBeam lets a coordinator send up to 100 files to up to 20 team folders in one action, watch every delivery live, and download what was delivered. This guide is for a quick hands-on test of the **dev** system.

- **Address:** https://dalv1a3ih6hi2.cloudfront.net (works only while dev is up; it is taken down in a day or two and everything on it is deleted).
- **Password:** the person who sent you this guide gives it to you. It is the same for every account below.
- **Do not upload real or sensitive documents.** This is a test system. Use any harmless files you have (PDF, DOCX, XLSX, PNG or JPG, up to 1 GB each).

## The accounts

All are fictional (`@example.com`). Each person sees only the teams they belong to. Creating new accounts is switched off on dev, so use these (the "Create an account" link will not work).

| Sign in as | Teams | What they can see |
|---|---|---|
| `priya.shah@example.com` | Cardio, Oncology | Can send to Cardio and Oncology folders. The main account for the tour. |
| `raj.mehta@example.com` | Cardio only | Sees only the Cardio deliveries of a distribution that also went to Oncology. |
| `sam.ito@example.com` | Neuro only | Shares no team with Priya or Raj, so a distribution they received is "not found" to Sam. |
| `anantim.patil@example.com` | Cardio, Neuro, Oncology | The demo sender; has earlier test distributions. |
| `load.user@example.com` | 50 test teams | Used for load tests. Its list holds many old cancelled 2,000-delivery distributions (see known limits). Skip it unless you are curious. |

Folders you can send to: **Cardio** (CARDIO-301 Regulatory: IRB approvals, Protocol amendments; CARDIO-301 Site files: Delegation logs, Training records), **Oncology** (ONC-118 Regulatory: Ethics committee, Investigator CVs; ONC-118 Pharmacy: Temperature logs), **Neuro** (NEU-207 Regulatory: Site approvals).

## A 10-minute tour

Use a normal window for Priya and a private (incognito) window for the other users, so the sign-ins do not mix.

1. **Sign in (1 min).** Open the address and sign in as Priya. You stay signed in for 12 hours. Five wrong passwords in a row pause the account for 15 minutes, so type carefully.
2. **Browse (1 min).** On **Distribute**, the Destinations panel on the right lists only Priya's teams: Cardio and Oncology. Expand a team and a binder to see its folders; use the filter box.
3. **Upload (2 min).** Click **Click to browse** (or drag files in) and pick three or four small files of different types. Each row goes Checking, Uploading, then **Verified** once the malware scan has passed (about 15 to 30 seconds).
4. **The malware test file (1 min).** Get the standard EICAR antivirus test file from eicar.org (it is harmless, but your own antivirus may block the download), save it as `eicar.pdf` and add it. Its row shows **Refused: malware found**, struck through, and **Send** stays disabled until you remove it with the cross. The file is deleted from storage and can never be sent or downloaded.
5. **Send (1 min).** Tick two or three folders, for example Cardio / CARDIO-301 Regulatory / IRB approvals and Oncology / ONC-118 Regulatory / Ethics committee. The **Review** section lists every folder with its files. Click **Send N deliveries**.
6. **Watch it live (1 min).** The Status page opens on your distribution. The counts (Delivered, Failed, In progress, Waiting) move as documents arrive; each row shows its destination and status.
7. **Preview and download (1 min).** On a delivered row click the eye to **preview** the file in the page, and the arrow to **download** it. Both use a link that works for 2 minutes for that one file; a banner counts it down.
8. **Audit (1 min).** Open the **Audit** tab of the distribution: "Distribution sent" with who, what, where and when. The **Audit trail** page in the top bar lists every event, including the preview and download links you issued; use the filter chips.
9. **Other people's views (1 min).** In the private window sign in as **Raj**, open **Status**, switch to **My teams** and open the distribution: only the Cardio deliveries are there, nothing for Oncology. Sign out and sign in as **Sam**: paste the distribution ID into the Open box on the Status page and you get **Distribution not found**, the same answer as for one that does not exist.

## Known limits

- **Submit speed under heavy load.** A 2,000-delivery submit answers in under 500 ms at p99 on a quiet system and under 1 second at p99 while the system is delivering at full speed. The worst measured run was 992 ms, so the margin is thin, and single requests were slower. You will not notice this with a few files.
- **Old cancelled jobs.** The load user's list (and some of Anantim's) shows many old distributions marked **Cancelled** or **Completed** from load tests. They are real test data and cannot be removed.
- **Scans take time.** The malware scan takes about 15 seconds per file, 10 files at a time, so 100 files take a few minutes.
- **Small system.** Dev runs on the smallest sizes. If someone else is running a big test at the same moment, things can be slower.
- **The platform is a stand-in.** "Delivered" means the document arrived in a stand-in for the real document platform.

## Reporting a problem

Send it to the person who gave you this guide. Include:

1. The time you saw it (with your time zone) and the account you were signed in as.
2. What you clicked, what you expected, and what happened (an error message, a stuck row, a wrong number).
3. The short ID of the distribution (shown on the Status page, for example `dcc343d0`) and the file name, if any.
4. A screenshot if you can.

Do not send the password in a report.
