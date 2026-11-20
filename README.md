# MyAvedan

AI-powered opportunity discovery and application companion, built by TrutiAI. MyAvedan turns official recruitment notices into clear, evidence-linked facts, checks eligibility with transparent rules, and helps applicants track every date. Applications and payments always happen on the official portal.

**How we build it:** [docs/WORKFLOW.md](docs/WORKFLOW.md), milestones M0–M8, branch and release rules, and what the account owner needs to set up.

## Run it locally

Needs Node 22.23+ (24 recommended) and, for the pipeline, Python 3.10+.

```bash
npm install
npm test                  # schema, eligibility engine, API helpers
npm run validate:snapshot # data/snapshot.json against the schema
npm run dev               # site on http://localhost:4321 (sample data)
npm run build             # static site + search index in apps/web/dist
```

Worker API with a local database (no Cloudflare account needed):

```bash
npm run db:migrate:local
npm run db:seed:local -w @myavedan/api
npm run dev:api           # http://localhost:8787/api/health
```

Local secrets go in `apps/api/.dev.vars` (see `.env.example`); that file is never committed.

Pipeline tests:

```bash
cd pipeline
python -m pip install -r requirements-dev.txt
python -m pytest
```

## What is here

| Path | What it is |
| --- | --- |
| `packages/schema` | The data contract: snapshot schema with validation rules, IST date helpers, `computeStatus()` |
| `packages/eligibility` | Deterministic eligibility engine (age windows, relaxations, qualification, verdicts) |
| `apps/web` | Astro + Preact public site: home, explore, notice pages with evidence and eligibility checker, admit cards, results, search, about/trust, legal drafts |
| `apps/api` | Cloudflare Worker: health, signed ingest, error reports, approved-snapshot export, review console API and hosting |
| `apps/admin` | Review console (Preact): queue, side-by-side review against the notice, approval, error reports. See [docs/REVIEW_CONSOLE.md](docs/REVIEW_CONSOLE.md) |
| `migrations` | D1 schema |
| `scripts/fetch-snapshot.mjs` | Downloads approved notices for a site build. See [docs/PUBLISHING.md](docs/PUBLISHING.md) |
| `pipeline` | Python pipeline: section map, grounding check, validation, signed ingest client; network and AI stages arrive in M3 |
| `data/snapshot.json` | Sample notices (invented, marked `"sample": true`) the site builds from in development |

The site never reads the database directly. It builds from `data/snapshot.json`; in production the publish job fills that file with approved records only.
