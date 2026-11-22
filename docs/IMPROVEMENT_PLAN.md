# Improvement plan: accuracy, review speed, coverage and candidate features

Based on the suggestions in *notice_extraction_website_productivity_suggestions.txt*, checked against what MyAvedan already does. 11 items, in 4 batches. Each batch is built and tested on its own branch, then merged and deployed by the owner.

Skipped on purpose: per-fact page quotes on the public site (owner asked for a simpler site; quotes stay in the review console) and public site-status badges (the console's Reader health page covers it). Already done: calendar export (.ics) and official PDF/source links on every notice.

---

## Batch 1: reader accuracy (pipeline only)

All in `pipeline/`. Nothing changes on the website or console, so this batch is the safest to ship first. Takes effect on the PC's next run after merge (no deploy needed).

### 1.1 Hindi digits and key terms (1A): skipped at the owner's request
- **What:** after text extraction and OCR, convert Devanagari digits ०-९ to 0-9, and add an English hint next to key Hindi headings (रिक्तियां → vacancies, आयु सीमा → age limit, शैक्षणिक योग्यता → qualification, अंतिम तिथि → last date, आवेदन शुल्क → fee, उत्तर कुंजी → answer key, परिणाम → result, प्रवेश पत्र → admit card).
- **How:** a small `normalise.py` applied to every page's text before compaction *and* before the fact check, so quotes still match.
- **Needs:** nothing new.
- **Tests:** Hindi sample lines in → expected text out; the fact check still matches a quote containing Hindi digits.

### 1.2 Tables read as tables (1B)
- **What:** vacancy, age, fee and pay tables are sent to Gemini as clean Markdown tables instead of scrambled lines. This targets mistakes like the RRB vacancy (1265 vs 1215).
- **How:** PyMuPDF's built-in table finder (`page.find_tables()`, already installed: PyMuPDF 1.28). Each table found is added to that page's text as a Markdown table, marked `[table]`, keeping the page number so citations still work. Scanned pages (OCR) have no table structure; they stay as text.
- **Needs:** nothing new to install.
- **Tests:** the 5 golden notices: tables detected on the vacancy pages; re-run the RRB notice and check 1215 is read. Costs ~5 Gemini calls once.

### 1.3 Priority order for Gemini calls (1C)
- **What:** each run reads in this order, within the 40-a-day limit:
  1. corrigenda / date changes
  2. openings whose dates in the link text are recent (likely short windows)
  3. results, admit cards, answer keys, cut-offs
  4. other new items
  5. backlog, newest first
- **How:** a `priority()` score replacing today's simple order (new first, then backlog). Links the reviewer sent from the Unsure list stay at the very top.
- **Needs:** nothing new.
- **Tests:** a mixed list of candidates sorts as above.

### 1.4 Same notice under a new address (1D)
- **What:** before any AI call, recognise a document already sent under a different address (mirrors, re-uploads) by **organisation + advertisement number + title words**.
- **How:** the reader already knows the link text; the API gets a new check `POST /api/ingest/similar` returning matches among existing documents of the same organisation (advertisement number match, or ≥90% title-word overlap). Then:
  - same file fingerprint → skipped (as today)
  - same advertisement number, different file, link looks like a corrigendum/revision → **read it** and file as a corrigendum (revisions matter)
  - same advertisement number and title, not a revision → skipped as a probable duplicate, logged in the run report so nothing disappears silently
- **Needs:** one small API endpoint (part of the batch 2 deploy; until it's live the reader just skips this check).
- **Tests:** API unit tests for matching; reader test for the three outcomes.

### 1.5 Second check on critical facts (1E)
- **What:** a rule-based reader (no AI) finds the **last date, total vacancies, age limits and fee** in the text with patterns ("last date … 15.12.2026", "total … 1,248 posts", "18 to 27 years", "₹100"). If it finds a value and Gemini's differs, the field gets a **red flag**: "Second check found 1215 on page 4; AI read 1265".
- **How:** `crosscheck.py`, run after Gemini and before sending. It only adds flags; it never changes values. If the rules find nothing, nothing is flagged.
- **Needs:** nothing new.
- **Tests:** patterns on real notice snippets (English and Hindi); golden notices produce no false red flags.

---

## Batch 2: review console

`apps/api` and `apps/admin`. Needs the production deploy (Actions → Deploy → production).

### 2.1 Results and admit cards matched automatically (2A)
- **What:** when a draft is a result / admit card / answer key / cut-off / corrigendum, the recruitment picker is **pre-filled** with the best match, with the reason shown ("same advertisement number 05/2026"). One click to attach.
- **How:** reuse the matching already used for Official links (`suggest()` in `links.ts`: advertisement number, organisation, title words). Computed when the draft arrives and when the review page opens.
- **Tests:** existing matching tests plus cases with advertisement numbers written differently ("CEN 08/2026" vs "CEN-08-2026").

### 2.2 Red and yellow flags (2B)
- **What:**
  - **Red (must check):** value differs from its quote, second-check disagreement (1.5), dates out of order, vacancy totals that don't add up, quote not found in the PDF.
  - **Yellow (for information):** certificate warning, lite model used, unreadable/OCR pages, section not found, type changed from content.
  - Queue shows a red/yellow count per draft; the review page lists red first. A draft with **no red flags** gets an "Approve all checked fields" shortcut (still a person's click).
- **How:** a fixed mapping from flag code to tier in the API; the console uses it. Old flags without a tier default to their current error/warning level.
- **Tests:** mapping tests; approval still blocked while any critical field is unchecked.

### 2.3 Similar-document check endpoint (for 1.4)
- `POST /api/ingest/similar` (signed), deployed in this batch.

---

## Batch 3: candidate features on myavedan.in

`apps/web` (and `packages/eligibility`, which already decides eligibility per post). Needs the production deploy.

### 3.1 "Can I apply?" search (3A)
- **What:** a page `/can-i-apply/` where a candidate enters **date of birth, category (UR/OBC/SC/ST/EWS, PwBD, ex-servicemen), highest qualification and state**, and sees every open or upcoming recruitment with posts they qualify for, with the reason for each ("age 24 within 18–27 + 3 years OBC").
- **How:** runs entirely in the browser using the existing eligibility engine on the published data; nothing is sent anywhere. Answers are remembered on the device only if the candidate ticks "remember on this device".
- **Tests:** engine tests already exist; add page-level tests with sample profiles.

### 3.2 One timeline per recruitment (3B)
- **What:** on each notice page, a vertical timeline: notification → apply from / last date → corrigenda → admit card → answer key → result / cut-off, with past steps ticked, the current step highlighted and future dates shown as "expected" when tentative.
- **How:** built from the dates and updates already in each record. Replaces the separate Updates list on the notice page. The Results and Admit cards pages link to the timeline.

### 3.3 Watchlist (3D)
- **What:** a "Save" button on every card and notice page; a **Saved** page listing them with status and next date. Stored on the candidate's device only (no login).
- **How:** browser storage with a safe fallback if it's blocked. A small badge on saved items' cards.

Design follows the current Superdesign look (white cards, teal buttons).

---

## Batch 4: custom readers for big sites (2C)

The biggest coverage gain and the most work, done site by site in this order: **SSC, UPSC, RRB (rrbapply), NTA, SBI, RBI**, then the rest of the "Needs custom reader" list on the Reader health page.

- **How, for each site:**
  1. Look at what the page loads (most JavaScript sites fetch their notice list from a JSON feed). If there is one, read that feed directly: fast, small, no browser.
  2. Only if there's no feed, use a headless browser (**Playwright**) to render the page.
  3. Either way, the result is the same list of (link, text) pairs the reader already understands, so classification, outdated checks, unsure list, reading and review all work unchanged. Same politeness rules (robots.txt, 2 s between requests).
- **UPSC** returns 403 to the reader: try its official RSS/"what's new" pages first; if it still blocks, report it on the health page rather than work around a site's refusal.
- **Needs (only if a site has no feed):** installing Playwright and its Chromium browser on the PC (~150 MB download, one command). I'd ask before installing.
- **Tests:** a saved copy of each site's feed/page → expected links.

---

## What I need from you

| When | What |
| --- | --- |
| Batch 1 | Nothing up front. Merge when ready (no deploy needed). ~5 Gemini calls for the RRB / golden re-test. |
| Batch 2 | Merge + **Deploy → production**. |
| Batch 3 | Merge + **Deploy → production**. A look at the new pages; you may want wording changes. |
| Batch 4 | Your OK to install Playwright + Chromium on the PC *if* a site needs it. Merge per site. |

## Order and rough effort

1. Batch 1: reader accuracy (about a day)
2. Batch 2: review console (about half a day)
3. Batch 3: candidate features (about a day)
4. Batch 4: custom readers (several days, one site at a time)

Batches 1–3 are independent of each other except 1.4, which uses the endpoint from batch 2 (the reader simply skips that check until it's deployed).
