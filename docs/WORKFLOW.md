# MyAvedan build workflow

How we build MyAvedan from an empty folder to a public pilot. This is the working plan for the codebase. The product reasoning behind it (architecture, pipeline, data model, budget, risks) is in the build blueprint published from the PRD; this file is the step-by-step "how".

Source documents:
- `MyAvedan_PRD_Technical_Blueprint_Free_Stack.docx` (PRD v1.0, 17 Nov 2026)
- MyAvedan Build Blueprint (artifact derived from the PRD)

---

## 1. Who does what

| Work | Owner |
| --- | --- |
| Code, tests, schema, CI, documentation | Engineering (this repo) |
| Accounts, billing settings, domain, secrets | TrutiAI account owner |
| Choosing sources, labelling the golden set, reviewing notices | Content reviewer |
| Legal review of privacy/terms before public launch | Qualified counsel |

### Accounts the owner must create (engineering cannot do this)

| Account | Needed from | Used for |
| --- | --- | --- |
| GitHub organisation + repository | M0 | Code, CI, scheduled pipeline |
| Cloudflare account, `myavedan.in` DNS moved to Cloudflare | M1 | Pages, Workers, D1, R2, Access |
| Google AI Studio API key, in a Google project **without billing** | M3 | Gemini free tier (extraction, summaries) |
| Google OAuth client | M7 | Optional applicant sign-in |

Secrets are never committed. They go into `wrangler secret put` (Workers) and GitHub encrypted secrets (Actions). See `.env.example`.

---

## 2. Repository layout

```
myavedan/
├─ apps/
│  ├─ web/            Astro + Preact public site (en, hi), static output
│  ├─ admin/          Review console (M4), behind Cloudflare Access
│  └─ api/            Cloudflare Worker: public, admin, ingest and cron routes
├─ packages/
│  ├─ schema/         Zod types, status(), date helpers, extraction JSON Schema
│  ├─ eligibility/    Pure TypeScript rule engine + table-driven tests
│  └─ ui/             Shared tokens (later)
├─ pipeline/          Python: discover, fetch, classify, parse, ocr, extract, ground, validate
│  └─ golden/         Hand-verified notices + expected JSON (M2)
├─ migrations/        D1 SQL migrations
├─ data/              snapshot.json the site builds from (sample data in development)
├─ docs/              This file and decision records
└─ .github/workflows/ ci, eval, deploy, discover, publish, nightly
```

npm workspaces tie the JavaScript packages together. Python lives in `pipeline/` with its own `requirements.txt`.

### The snapshot contract

The public site never talks to the database. It builds from one file, `data/snapshot.json`, validated by `packages/schema` at build time.

- **Development:** the snapshot holds clearly marked sample notices (`"sample": true`). Pages show a "Sample data" banner.
- **Production:** the publish job asks the API for approved records only and writes the same file before building.

This keeps drafts off the public site by construction and lets the site be built and tested before the pipeline exists.

---

## 3. Day-to-day workflow

### Branches and pull requests
1. `main` is always deployable. Nobody pushes to it directly.
2. One branch per task: `feat/…`, `fix/…`, `chore/…`, `content/…`.
3. Open a pull request early. CI must pass: type check, unit tests, schema validation of the snapshot, site build.
4. Changes to prompts, the extraction schema or the pinned model also run the golden-set evaluation (from M3) and cannot merge if critical-field accuracy drops.
5. Squash-merge. The merge deploys to staging; production deploys after staging is checked.

### Commit messages
`type(scope): summary`, for example `feat(eligibility): add DOB window rule`. Types: feat, fix, chore, docs, test, refactor, content.

### Local commands

| Command | Does |
| --- | --- |
| `npm install` | Install all workspaces |
| `npm test` | Unit tests for schema and eligibility |
| `npm run check` | Type check every workspace |
| `npm run validate:snapshot` | Validate `data/snapshot.json` against the schema |
| `npm run dev` | Public site on http://localhost:4321 |
| `npm run build` | Static site + Pagefind index in `apps/web/dist` |
| `npm run dev:api` | Worker API locally with a local D1 database |
| `npm run db:migrate:local` | Apply migrations to the local D1 database |

### Environments

| Environment | URL | Data | Deploys |
| --- | --- | --- | --- |
| Local | localhost | Sample snapshot, local D1 | On save |
| Staging | staging.myavedan.in | 2–3 real sources, own D1/R2/key | Every merge to `main` |
| Production | myavedan.in | Approved records only | Manual promote after staging check, then publish batches |

---

## 4. Build sequence

Each milestone ends with something that runs. Weeks assume two developers and one part-time reviewer.

### M0 · Foundation (week 1) — *code done; waiting on the GitHub repo*
- [x] Workflow document (this file)
- [x] Monorepo with npm workspaces, TypeScript config, `.gitignore`, `.env.example`
- [x] `packages/schema`: opportunity, post, dates, rules, evidence, events, snapshot types with validation rules; `computeStatus()` in IST
- [x] `packages/eligibility`: rule engine with boundary tests
- [x] `apps/web`: home, explore (filters, sort, shareable URLs), notice page (evidence chips, eligibility checker, calendar file), admit cards, results, full-text search, about/trust with error reporting, draft privacy/terms/disclaimer
- [x] `apps/api`: Worker with health, HMAC-signed ingest, rate-limited error reports, approved-snapshot export, cron stub
- [x] `migrations/0001_init.sql`: D1 schema, including FTS5 over notice chunks
- [x] `pipeline/`: section map, grounding check, validation and signed ingest client, tested; network and AI stages stubbed for M3
- [x] CI workflow: snapshot validation, tests, type check, site build, migration check, pipeline tests
- [ ] Owner: create the GitHub repository; then initialise git here, commit and push
- **Done when:** `npm test` and `npm run build` pass locally (passing on 17 Nov 2026) and in CI.

Stack versions chosen in M0: Node 24, Astro 7, Preact 10, Tailwind 4, Pagefind 1.6, Wrangler 4, zod 3.

> The project folder is inside OneDrive. `node_modules` (about 400 packages) and `.wrangler/` will sync unless excluded. If syncing gets slow or locks files during installs, move the repository to a folder outside OneDrive, such as `C:\dev\myavedan`, once it is on GitHub.

### M1 · Hosting (week 2)
- [ ] Owner: Cloudflare account, move DNS, create D1 (`myavedan-staging`, `myavedan-prod`) and R2 buckets
- [ ] Deploy the static site to Pages (staging) with Wrangler direct upload from Actions
- [ ] Deploy the Worker with D1 binding; run migrations on staging
- [ ] Cloudflare Access policy on `admin.` and `/admin/*` API routes
- **Done when:** staging shows the sample site and the API health check reports the database.

### M2 · Sources and golden set (weeks 2–4)
- [ ] Reviewer: pick 10–15 tier-1 official sources; record host, reason, parser kind, cadence
- [ ] Reviewer: collect 25 notices (include scanned, bilingual, multi-post, corrigendum cases)
- [ ] Reviewer: hand-label each with the extraction schema, page and snippet for every critical field; second person checks
- [ ] Record minutes per notice; this sets how many sources review capacity can support
- **Done when:** `pipeline/golden/` has 25 labelled notices and the labelling time is known.

### M3 · Ingestion pipeline (weeks 4–8)
- [ ] Discover (conditional GET, robots.txt, per-host delay) and fetch with SHA-256 dedupe into R2
- [ ] Classify and link documents to opportunities
- [ ] Parse with PyMuPDF; OCR (Hindi + English) only for pages without a text layer
- [ ] Section map, Gemini extraction with response schema, grounding check, validation
- [ ] Post drafts to the Ingest API (HMAC-signed)
- [ ] Golden-set evaluation workflow; baseline accuracy recorded
- **Done when:** a new notice on a staging source appears as a draft with evidence, and the eval reports critical-field accuracy.

### M4 · Review console (weeks 5–9)
- [ ] Queue sorted by deadline, tier and change type
- [ ] Review screen: PDF page with highlighted snippet beside field cards; per-field approval for critical fields
- [ ] Diff view for new versions; reject and reprocess actions
- [ ] Publish queue, Worker cron, `repository_dispatch` to the publish workflow
- **Done when:** a reviewer approves a notice and it is live on staging within one publish cycle.

### M5 · Public launch scope (weeks 6–10)
- [ ] Snapshot export endpoint (approved records only) feeding the site build
- [ ] Pagefind filters for state, qualification, status, organisation; sort by deadline and date
- [ ] Reviewed summaries in English and Hindi; Hindi interface strings
- [ ] Calendar export for important dates
- [ ] "Report an error" on every field, wired to corrections
- **Done when:** the PRD's MVP acceptance checklist passes on staging.

### M6 · Hardening and soft launch (weeks 11–12)
- [ ] Security checks: admin authorisation, secrets, injection, rate limits
- [ ] Accessibility (keyboard, screen reader, contrast) and throttled mobile testing
- [ ] Broken-link and stale-source checks in the nightly workflow
- [ ] Photo and signature resizer (browser only)
- [ ] Counsel review of privacy notice and terms
- **Done when:** no open critical findings; soft launch to a small group.

### M7 · Personal utility (weeks 13–20)
- [ ] Google sign-in (Better Auth), saved items merged from the device, dashboard
- [ ] Checklist from verified fields; reminders (in-app, Web Push); daily reminder cron
- [ ] Eligibility v2: post-wise rules, domicile, more relaxation cases
- [ ] Ask MyAvedan pilot: reviewed FAQ first, then limited free-form questions
- **Done when:** the PRD's Phase 2 definition of done passes.

### M8 · Expansion (week 21+)
- [ ] Notice-specific photo presets, more languages, keyword-to-filter search, new categories

---

## 5. Content workflow (how a notice goes live)

```
official source → discover → fetch + hash → classify + link → parse/OCR → section map
  → AI extract → grounding check → validate → Ingest API → review queue
  → reviewer approves each critical field → publish queue → site build → live
  → opted-in users notified
```

Rules that never bend:
1. Only allowlisted official hosts are sources. Never aggregator sites.
2. Nothing reaches the public site without human approval of every critical field.
3. Every critical field shows evidence (page and section) or "not in notice".
4. A new version never erases the old one; superseded versions keep their evidence.
5. No applicant personal data is sent to the free AI tier.
6. Applications and payments always happen on the official portal.

---

## 6. Conventions

- **Dates:** ISO 8601 with the `+05:30` offset (`2026-12-15T23:59:00+05:30`). Date-only values are `YYYY-MM-DD` and mean that day in IST. Keep the stated time; "till 18:00 hrs" is not end of day.
- **Age limits:** stored as a date-of-birth window (`born_on_or_after`, `born_on_or_before`).
- **Evidence references:** `{ page, section, snippet }` on every critical field.
- **Status:** never stored; computed by `status()` at build time and again on page load.
- **Language:** official names, numbers and dates are never translated.
- **Sample data:** anything invented carries `"sample": true` and is labelled on screen.

---

## 7. Definition of done for any change

- Tests added or updated; `npm test` passes
- Types check; snapshot validates; site builds
- User-facing text reviewed for plain language, works on a 360 px wide screen and with the keyboard
- No secrets, no personal data in logs
- This file updated if the workflow or a milestone changed
