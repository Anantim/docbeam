# DocBeam tester guide

DocBeam lets a coordinator send up to 100 files to up to 20 team folders in one action, watch every delivery live, and download what was delivered. This guide is for a quick hands-on test of the **dev** system.

- **Dev is down.** It was brought up for the F1 round on 2026-10-20, checked, and torn down again the same day; everything on it was deleted. No address in this guide works. Ask the person who sent you this guide for a new address when dev is up again; the accounts and steps below stay the same.
- **Password:** the person who sent you this guide gives it to you. It is the same for every account below.
- **Do not upload real or sensitive documents.** This is a test system. Use any harmless files you have (PDF, DOCX, XLSX, PNG or JPG, up to 1 GB each).

## The accounts

All are fictional (`@example.com`). Each person sees only the teams they belong to. The web app has no sign-up: the study administrator sets accounts up, so use these.

| Sign in as | Teams | What they can see |
|---|---|---|
| `priya.shah@example.com` | Cardio, Oncology | Can send to Cardio and Oncology folders. The main account for the tour. |
| `raj.mehta@example.com` | Cardio only | Sees only the Cardio deliveries of a distribution that also went to Oncology. |
| `sam.ito@example.com` | Neuro only | Shares no team with Priya or Raj, so a distribution they received is "not found" to Sam. |
| `anantim.patil@example.com` | Cardio, Neuro, Oncology | The demo sender; has earlier test distributions. |
| `paging.user@example.com` | Paging Team | One folder holds 60 subfolders: open Paging Team, PAGING-1 Archive, Archive 2026 and scroll to see them load 20 at a time. |
| `load.user@example.com` | 50 test teams | Used for load tests. Its list holds many old cancelled 2,000-delivery distributions (see known limits). Skip it unless you are curious. |

Folders you can send to: **Cardio** (CARDIO-301 Regulatory: IRB approvals, Protocol amendments; CARDIO-301 Site files: Delegation logs, Training records), **Oncology** (ONC-118 Regulatory: Ethics committee, Investigator CVs; ONC-118 Pharmacy: Temperature logs), **Neuro** (NEU-207 Regulatory: Site approvals).

## A 10-minute tour

Use a normal window for Priya and a private (incognito) window for the other users, so the sign-ins do not mix.

1. **Sign in (1 min).** Open the address and sign in as Priya. You stay signed in for 12 hours. Five wrong passwords in a row pause the account for 15 minutes, so type carefully.
2. **Browse (1 min).** On **Distribute**, the Destinations panel on the right lists only Priya's teams: Cardio and Oncology. Open a team and a binder (each click loads one level; long levels load more as you scroll) and use the search box. Binders have no tick; only folders do.
3. **Upload (2 min).** Drop files on the Files card or click **choose files**, and pick three or four small files of different types. Each row shows its state: Uploading, Checking, then **Ready** once the malware scan has passed (about 15 to 30 seconds).
4. **The malware test file (1 min).** Get the standard EICAR antivirus test file from eicar.org (it is harmless, but your own antivirus may block the download), save it as `eicar.pdf` and add it. Its row shows **Refused** with the reason, struck through, and **Send** stays off until you remove it with the cross. The file is deleted from storage and can never be sent or downloaded.
5. **Choose folders and send (1 min).** Tick two or three folders, for example Cardio / CARDIO-301 Regulatory / IRB approvals and Oncology / ONC-118 Regulatory / Ethics committee. With nothing selected a tick goes to all files; click one file row (Shift or Ctrl to select several) and a tick goes to those files only. The bar at the bottom reads, for example, "3 files to 2 folders: 6 deliveries". Click **Send**, read the question (Cancel is the default), and click **Send** again.
6. **Watch it live (1 min).** The Status page opens on your distribution in a side panel. The numbers on the filter row (Completed, Failed, In progress, Pending) move as documents arrive; each delivery row shows its folder and status.
7. **Preview and download (1 min).** On a completed row click the eye to **preview** the file in the page, and the arrow to **download** it. Both use a link that works for 2 minutes for that one file; a banner counts it down.
8. **The list and the panel (1 min).** With a distribution open, the list narrows to a column (ID, status, sent at) beside the panel. Press **Esc** to close the panel and the full list is back. The list has **Mine**, **My teams** and **All I can see**, and a **Status** menu; under it, "Showing 20" and **Show more**. A small copy icon after an ID (shown when you point at the row or tab to it, always in the panel) copies the link to that distribution. The page shows the history of your distributions only; a file the malware scan refused shows only in the Distribute file list.
9. **Other people's views (1 min).** In the private window sign in as **Raj**, open **Status**, switch to **My teams** and open the distribution: only the Cardio deliveries are there, nothing for Oncology. Sign out and sign in as **Sam**: click the **Open by ID** button (the magnifier on the Status page), paste the distribution ID and press Enter, and you get **Distribution not found**, the same answer as for one that does not exist.

## Known limits

- **Submit speed under heavy load.** A 2,000-delivery submit answers in under 500 ms at p99 on a quiet system and under 1 second at p99 while the system is delivering at full speed. The worst measured run was 992 ms, so the margin is thin, and single requests were slower. You will not notice this with a few files.
- **Old cancelled jobs.** The load user's list (and some of Anantim's) shows many old distributions marked **Cancelled** or **Completed** from load tests. They are real test data and cannot be removed.
- **Scans take time.** The malware scan takes about 15 seconds per file, 10 files at a time, so 100 files take a few minutes.
- **Small system.** Dev runs on the smallest sizes. If someone else is running a big test at the same moment, things can be slower.
- **The platform is a stand-in.** "Completed" means the document arrived in a stand-in for the real document platform.

## Reporting a problem

Send it to the person who gave you this guide. Include:

1. The time you saw it (with your time zone) and the account you were signed in as.
2. What you clicked, what you expected, and what happened (an error message, a stuck row, a wrong number).
3. The short ID of the distribution (shown on the Status page, for example `dcc343d0`) and the file name, if any.
4. A screenshot if you can.

Do not send the password in a report.
