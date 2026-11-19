// Local development: send two sample drafts to the local Worker's Ingest API so the review
// console has something to show. Uses the sample notices in data/snapshot.json.
//   npm run dev:api            (in another terminal)
//   node apps/api/scripts/seed-review.mjs
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const vars = Object.fromEntries(
  readFileSync(new URL("apps/api/.dev.vars", root), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const base = process.env.API_BASE ?? "http://127.0.0.1:8787";
const snapshot = JSON.parse(readFileSync(new URL("data/snapshot.json", root), "utf8"));

/** Page text built from the cited snippets, so "show in notice" has something to highlight. */
function pagesFrom(o) {
  const pages = new Map();
  const add = (ev) => ev && pages.set(ev.page, [...(pages.get(ev.page) ?? []), ev.snippet.replace(/ \.\.\. /g, " and other conditions apply. ")]);
  o.dates.forEach((d) => add(d.evidence));
  o.posts.forEach((p) => {
    add(p.evidence);
    p.rules.forEach((r) => {
      add(r.evidence);
      (r.relaxations ?? []).forEach((x) => add(x.evidence));
    });
  });
  o.fees.forEach((f) => add(f.evidence));
  return [...pages.entries()].map(([page, lines]) => ({ page, section: null, text: [...new Set(lines)].join("\n") }));
}

async function send(o, { flags = [], grounding = {}, sourceUrl }) {
  const { provenance, sample, ...draft } = structuredClone(o);
  const sha = createHash("sha256").update(o.slug + "-draft").digest("hex");
  const payload = {
    source_url: sourceUrl,
    document_url: o.links.notice_pdf,
    document_kind: "notice",
    sha256: sha,
    r2_key: `raw/dev/${sha}.pdf`,
    pages: 8,
    retrieved_at: provenance.retrieved_at,
    advt_no: o.advt_no,
    draft: { ...draft, grounding },
    flags,
    chunks: pagesFrom(o),
  };
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  const res = await fetch(`${base}/api/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-MyAvedan-Timestamp": String(ts),
      "X-MyAvedan-Signature": createHmac("sha256", vars.INGEST_HMAC_SECRET).update(`${ts}.${body}`).digest("hex"),
    },
    body,
  });
  console.log(`${o.title}: ${res.status} ${await res.text()}`);
}

const [junior, constable] = snapshot.opportunities;

await send(junior, {
  sourceUrl: "https://example.org/recruitment",
  grounding: { "dates.1": { grounded: true }, "dates.2": { grounded: true }, "fees.0": { grounded: true }, "posts.0.rules.0": { grounded: true } },
  flags: [{ field: "dates.4", code: "tentative_date", severity: "warning", message: "Correction window is marked tentative in the notice" }],
});

// Second draft with an extraction error, to show how errors block publishing until fixed.
const broken = structuredClone(constable);
broken.total_vacancies = 2100;
await send(broken, {
  sourceUrl: "https://example.net/recruitment",
  grounding: { "total_vacancies": { grounded: false } },
  flags: [{ field: "total_vacancies", code: "vacancy_sum", severity: "error", message: "posts add up to 2000, total says 2100" }],
});
