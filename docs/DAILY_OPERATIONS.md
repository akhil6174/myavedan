# Running MyAvedan day to day

What runs by itself, what you do each day, and what to do when Reader health shows a problem.

---

## What runs by itself

| What | When | Where to see it |
| --- | --- | --- |
| Notice reader on your PC: checks all official sites and their list pages, reads new notices / results / admit cards, skips old ones and copies, sends drafts | 11:00 and 19:00 (or as soon as the PC wakes) | admin.myavedan.in → **Reader health**; logs in `%USERPROFILE%\.myavedan\logs\` |
| Site rebuild with approved notices | within 30 min – 2 h of approving, at once if *Urgent*, and nightly at 00:30 | myavedan.in |
| Status labels on the site (open / closing soon / closed) | every page load, from the official dates | myavedan.in |

You never need to start these by hand.

---

## Every day (about 20–45 minutes)

1. **Review queue** (admin.myavedan.in → **Queue**), ideally after the 11:00 and 19:00 runs.
   - Open each draft. Red **"Must check against the PDF"** items first: open the PDF at the quoted place and fix or confirm.
   - Approve or correct every **Critical** field (dates, vacancies, seats by category, age, qualification, fee).
   - Check **"This document is:"**. Openings → *Approve and publish*. Results, admit cards, answer keys, cut-offs, corrigenda → pick the suggested recruitment → *Attach and publish*.
   - Reject anything you don't want live (wrong notice, not a recruitment). Give a short reason.
   - Tick **Urgent** for date changes / deadline extensions so they go live at once.
2. **Unsure links** (Reader health → *Unsure links*): open each; **Read it** (choose what it is) or **Not needed**. 5–10 minutes.
3. **Error reports** (Queue page shows the count): check against the PDF, mark *confirmed / not an error / fixed*.

## Every week (5 minutes)

- **Reader health → Official sites**: anything at the top marked as needing attention? Use the table below.
- **Reader health → Recent runs**: were there runs every day? Many errors?

## Once in a while

| What | When |
| --- | --- |
| Remove a published notice that's wrong or cancelled (admin → **Published** → *Remove from site*) | when needed |
| Add or remove reviewers (admin → **Reviewers**) | when needed |
| Renew the GitHub dispatch token (publishing stops with "GitHub refused the dispatch (403)") | before its expiry date |
| Re-run the site audit | every 3–6 months, or when several sites are flagged |

---

## Reader health: problems and what to do

| What you see | What it means | What to do |
| --- | --- | --- |
| **No run for a day** (Recent runs has a gap) | The PC was off or asleep at 11:00 and 19:00 | Keep the PC on at those times, or start a run: `Start-ScheduledTask 'MyAvedan notice reader'` in PowerShell. Check the task exists: `Get-ScheduledTask 'MyAvedan notice reader'`. |
| A run shows **errors** mentioning `GEMINI_API_KEY is not set` | The Gemini key is missing on the PC | Put `GEMINI_API_KEY=...` in `%USERPROFILE%\.myavedan\.env` (see docs/PC_RUNNER.md). |
| Errors mentioning **401 bad signature** | The PC's ingest secret doesn't match the API | Ask Claude to set a new ingest secret on the PC and the API (same as on 21 Nov). |
| **"left for next run (Google busy)"** | Google's AI was overloaded | Nothing: the next run reads them. If it happens every run for days, the daily Gemini quota may be used up; tell Claude. |
| A site shows **Failed** or **Not reachable for N days** | The site is down, slow, or moved | Open the site in your browser. If it's down, wait: the reader retries every 3 days. If the address changed, tell Claude the new address. |
| A site shows **Blocks the reader** | The site refuses automated visits (e.g. UPSC 403) | Nothing to force. Tell Claude: we look for an official alternative page or feed. |
| A site shows **Needs custom reader** | Its page is built by JavaScript, so the reader sees no links | Notices from it can be missed. Tell Claude to build a custom reader for it (biggest sites first). Meanwhile check that site by hand once a week. |
| A site shows **Paused (keeps failing)** | 4 failures in a row; tried every 3 days | Same as Failed. |
| **Nothing new for 45+ days** on a site | The site may have moved its notices to another page | Open the site, find where notices are now listed, and tell Claude the page (it gets added as a list page). |
| Lots of **Unsure links** from one site | That site names documents in an unusual way | Mark them; if a pattern repeats, tell Claude so the reader learns it. |
| A draft is **Validation failed** | Some extracted value breaks the site's rules (e.g. a date in the wrong order) | Open it, fix the flagged field, approve. |
| Drafts read by the **lite model** | Main AI models were busy | Check the posts and seats tables carefully against the PDF. |

**When in doubt:** the run log for the time is in `%USERPROFILE%\.myavedan\logs\reader-<date>-<time>.log`. Share its last lines with Claude.

---

## For visitors (what they can do on myavedan.in)

- **My profile**: fill date of birth, qualification, category once. Every job card then shows **✓ You can apply**, **! Check one condition**, or **✕ Not eligible**. Kept on their device only.
- **I've applied**: a checkbox on each recruitment's page. New admit cards, answer keys and results for those recruitments appear under **My profile → New updates**, with a count next to *My profile* in the menu.
- **Saved**, **Can I apply?**, the **Timeline** on each notice, and **Add dates to calendar**.

These are on-device only: no accounts, no emails. Alerts show when the visitor opens the site. (Email / WhatsApp / browser push alerts would need accounts or a push service; possible later.)
