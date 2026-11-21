// Download the approved snapshot from the API and write data/snapshot.json for the site build.
//   API_BASE=https://api-staging.myavedan.in PUBLISH_TOKEN=... node scripts/fetch-snapshot.mjs staging
//
// Staging keeps the repository's sample notices until the first real notice is approved,
// so the staging site is never empty. Production never falls back to sample data.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const target = process.argv[2] ?? "staging";
const base = process.env.API_BASE;
const token = process.env.PUBLISH_TOKEN;
const out = new URL("../data/snapshot.json", import.meta.url);

function keepSample(reason) {
  if (target === "production") {
    console.error(`::error::${reason}. Production never builds from sample data.`);
    process.exit(1);
  }
  const sample = JSON.parse(readFileSync(out, "utf8"));
  console.log(`${reason}. Keeping the sample snapshot (${sample.opportunities.length} sample notices) for ${target}.`);
  process.exit(0);
}

if (!base || !token) keepSample("API_BASE or PUBLISH_TOKEN is not set");

const res = await fetch(`${base.replace(/\/$/, "")}/api/snapshot`, { headers: { Authorization: `Bearer ${token}` } });
const text = await res.text();
if (!res.ok) {
  console.error(`::error::Snapshot request failed (${res.status}): ${text.slice(0, 300)}`);
  process.exit(1);
}
const snapshot = JSON.parse(text);
if (!Array.isArray(snapshot.opportunities) || snapshot.opportunities.length === 0) {
  if (target === "production" && process.env.GITHUB_ENV) {
    // Nothing approved yet: skip this production build quietly instead of failing every night.
    console.log("No approved notices on production yet. Skipping the build; the live site is unchanged.");
    appendFileSync(process.env.GITHUB_ENV, "SKIP_DEPLOY=1" + String.fromCharCode(10));
    process.exit(0);
  }
  keepSample("No approved notices yet");
}

writeFileSync(out, JSON.stringify(snapshot, null, 2) + "\n");
console.log(`Wrote ${snapshot.opportunities.length} approved notices to data/snapshot.json (generated ${snapshot.generated_at}).`);
