/**
 * Runs on every page: eligibility labels on job cards (from the saved profile), the "I've applied"
 * checkbox on notice pages, and the count of new updates next to "My profile" in the menu.
 * All of it is computed in the browser from public data; nothing is sent anywhere.
 */
import { evaluatePosts } from "@myavedan/eligibility";
import { getApplied, getProfile, loadData, newUpdates, setApplied } from "./device";

const LABEL = {
  yes: { text: "✓ You can apply", cls: "elig-yes" },
  maybe: { text: "! Check one condition", cls: "elig-maybe" },
  no: { text: "✕ Not eligible", cls: "elig-no" },
  unknown: { text: "? Check the notice", cls: "elig-unknown" },
} as const;

async function paintEligibility() {
  const badges = [...document.querySelectorAll<HTMLElement>("[data-elig]")];
  if (!badges.length) return;
  const p = getProfile();
  if (!p) {
    for (const b of badges) b.hidden = true;
    return;
  }
  const data = new Map((await loadData()).map((d) => [d.slug, d]));
  for (const b of badges) {
    const d = data.get(b.dataset.elig!);
    if (!d) continue;
    const results = evaluatePosts(d.posts as any, { ...p, dob: p.dob || null });
    const v = results.some((r) => r.verdict === "likely_eligible")
      ? "yes"
      : results.some((r) => r.verdict === "potentially_eligible")
        ? "maybe"
        : results.length && results.every((r) => r.verdict === "not_eligible")
          ? "no"
          : "unknown";
    const fit = results.filter((r) => r.verdict === "likely_eligible" || r.verdict === "potentially_eligible").length;
    b.textContent = LABEL[v].text + (fit && results.length > 1 ? ` (${fit} of ${results.length} posts)` : "");
    b.className = `elig ${LABEL[v].cls}`;
    b.title = "Based on your saved profile (age, qualification, category). Always confirm in the official notice.";
    b.hidden = false;
  }
}

function wireApplied() {
  for (const box of document.querySelectorAll<HTMLInputElement>("[data-applied]")) {
    const slug = box.dataset.applied!;
    box.checked = Boolean(getApplied()[slug]);
    box.addEventListener("change", async () => {
      const a = getApplied();
      if (box.checked) {
        // Updates already out when you mark it are not "new"; only later ones are announced.
        const d = (await loadData()).find((x) => x.slug === slug);
        a[slug] = { at: new Date().toISOString().slice(0, 10), seen: d ? d.updates.map((u) => u.id) : [] };
      } else delete a[slug];
      setApplied(a);
    });
  }
}

async function paintUpdatesCount() {
  const n = (await newUpdates()).length;
  for (const el of document.querySelectorAll<HTMLElement>("[data-updates-count]")) {
    el.textContent = String(n);
    el.hidden = n === 0;
  }
}

paintEligibility();
wireApplied();
paintUpdatesCount();
document.addEventListener("myavedan:profile-changed", paintEligibility);
document.addEventListener("myavedan:applied-changed", paintUpdatesCount);
