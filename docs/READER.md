# Notice reader

How MyAvedan finds and reads official notices. It runs on a computer in India (see `docs/PC_RUNNER.md`).

## A run, step by step

1. **Visit each approved source** (`pipeline/sources/national-north.json`), politely: robots.txt respected, 2 seconds between requests to the same site, unchanged pages skipped (ETag / Last-Modified).
2. **Keep only recruitment links** on the source's official hosts (recruitment, advertisement, notification, CEN…; tenders, holidays, annual reports are ignored) and only links not seen before.
3. **First visit to a site:** every link already there is recorded as **backlog**, not read. Otherwise the first run would read hundreds of old notices. Pull open notices from the backlog deliberately with `--from-backlog N` (or the "from_backlog" box when running the workflow).
4. **New notices** (at most `--max-new`, default 10 per run) are downloaded, fingerprinted, and skipped if the API already has that exact file.
5. Each notice is read with Gemini: every fact comes back with its page and an exact quote. Quotes are checked against the page, automatic checks run, and the draft goes to the review console.
6. **Official links** (apply page, admit card, answer key, result, cut-off, corrigendum) are sent to the API **in one batch per run, with no AI**. The API suggests the matching recruitment (advertisement number first, then same organisation and title words) and only accepts links on the source's official hosts. A reviewer attaches each one with one click on the console's **Official links** tab; it then shows on the notice page and the Admit cards / Results pages after the next publish.

The reader's memory lives outside the code folder (`%USERPROFILE%\.myavedan\reader-state.json`, or `MYAVEDAN_STATE`), so updating the code never makes it forget what it has seen.

## Keeping quota use low

| Resource | How the reader saves it |
| --- | --- |
| Gemini | Only for brand-new full notices. Never for links or updates, never twice for the same file (fingerprint check with the API first). Repeated headers, footers and page numbers are stripped (3–7% fewer words). **Daily cap: 16 reads** (`GEMINI_DAILY_LIMIT`), counted across runs; notices over the cap wait for the next day. |
| Government websites | Two runs a day (11:00, 19:00 IST). Unchanged pages cost one tiny request (ETag / Last-Modified). A site that fails 4 times in a row is retried every 3 days instead of every run. robots.txt read once per run. |
| Cloudflare Worker and D1 | One request for all found links, one for the fingerprint check; each notice is one request. Matching reads the recruitment list once per batch. |
| GitHub Actions | The reader runs on your own machine, which uses no GitHub minutes. The site rebuilds only when something was approved. |

## Model choice (measured 20 Nov 2026 on the 5 test notices)

| Model | Time per long notice | Accuracy |
| --- | --- | --- |
| `gemini-3.8-flash` (default) | ~4–6 min on the free tier | All 12 UPPSC posts; 97 of 113 quotes confirmed |
| `gemini-3.5-flash-lite` | 10 s – 1.5 min | Missed 4 of UPPSC's 12 posts |

Accuracy wins, so the full model is the default and notices are read one at a time (reading several at once makes the free tier throttle hard). A day of 10–15 documents is roughly 1–1.5 hours of unattended background time, spread over two runs. The lite model can still be chosen with `--model gemini-3.5-flash-lite`, for example for short admit-card or result documents later.

## Coverage (first scan, 20 Nov 2026, from India)

- **37 of 46** sources answered; **24** already show recruitment links the generic reader can follow (945 links recorded as backlog).
- **Pages built by JavaScript** (the generic reader sees no links): SSC, SBI, RBI, NTA, NVS, HP Rajya Chayan Aayog, Rajasthan Police, rrbapply.gov.in. These need a small custom reader each, usually the site's own data feed.
- **Wrong starting page** (home page instead of the recruitment page): KVS, India Post GDS, DRDO.
- **Refused or unreachable:** UPSC (403), RRB Chandigarh, Prayagraj, Ajmer, Jammu, Northern Railway RRC, Employment News (moved), HPPSC (moved), SSB (wrong address).

Priority for custom readers: SSC, UPSC, RRB (rrbapply), SBI. They account for a large share of applicants.

## Commands

```
cd pipeline
python -m myavedan_pipeline.cli discover --dry-run          # visit all sources, read new notices, send nothing
python -m myavedan_pipeline.cli discover --max-new 5        # read up to 5 new notices and send them for review
python -m myavedan_pipeline.cli discover --from-backlog 3   # also read 3 notices from the backlog
python -m myavedan_pipeline.cli golden --only ssc           # re-read one test notice
python -m myavedan_pipeline.cli models                      # Gemini models this key can use
```
