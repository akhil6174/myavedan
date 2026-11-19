/**
 * Build-time access to the snapshot. Parsing here makes an invalid snapshot fail the build,
 * so a malformed or unreviewed record can never become a page.
 */
import raw from "../../../../data/snapshot.json";
import {
  Snapshot,
  computeStatus,
  dateValue,
  type EventKind,
  type Opportunity,
  type OpportunityEvent,
} from "@myavedan/schema";

export const snapshot = Snapshot.parse(raw);
export const opportunities: Opportunity[] = snapshot.opportunities;
export const isSample = snapshot.sample;

export function bySlug(slug: string): Opportunity | undefined {
  return opportunities.find((o) => o.slug === slug);
}

/** Compact status input, embedded in pages so the browser can recompute status on load. */
export function statusInput(o: Opportunity) {
  return {
    dates: o.dates.map(({ kind, value }) => ({ kind, value })),
    events: o.events.map(({ kind, date }) => ({ kind, date })),
  };
}

export function statusNow(o: Opportunity) {
  return computeStatus(o, Date.now());
}

const deadline = (o: Opportunity) => dateValue(o.dates, "apply_end") ?? "9999-12-31";
const notified = (o: Opportunity) => dateValue(o.dates, "notification") ?? o.provenance.reviewed_at;

/** Open now, soonest deadline first. */
export function closingSoon(limit = 6): Opportunity[] {
  return opportunities
    .filter((o) => statusNow(o).status === "open")
    .sort((a, b) => deadline(a).localeCompare(deadline(b)))
    .slice(0, limit);
}

/** Open or upcoming, newest notification first. */
export function latestOpenings(limit = 6): Opportunity[] {
  return opportunities
    .filter((o) => ["open", "upcoming"].includes(statusNow(o).status))
    .sort((a, b) => notified(b).localeCompare(notified(a)))
    .slice(0, limit);
}

export interface Update {
  event: OpportunityEvent;
  opportunity: Opportunity;
}

/** Later documents (admit cards, keys, results) across all opportunities, newest first. */
export function updates(kinds: EventKind[], limit?: number): Update[] {
  const list = opportunities
    .flatMap((opportunity) => opportunity.events.filter((e) => kinds.includes(e.kind)).map((event) => ({ event, opportunity })))
    .sort((a, b) => b.event.date.localeCompare(a.event.date));
  return limit ? list.slice(0, limit) : list;
}

/** Distinct states that appear in listings, for filters. */
export function statesInUse(): string[] {
  const set = new Set<string>();
  for (const o of opportunities) {
    if (o.organization.state) set.add(o.organization.state);
    for (const l of o.locations) if (l !== "All India") set.add(l);
  }
  return [...set].sort();
}

export function jurisdictionLabel(o: Opportunity): string {
  if (o.organization.jurisdiction === "central") return "Central government";
  return o.organization.state ? `${o.organization.state} (${o.organization.jurisdiction === "ut" ? "UT" : "state"})` : "State";
}

/** Link that opens the notice PDF at a given page. */
export function pdfAt(o: Opportunity, page: number): string {
  return `${o.links.notice_pdf}#page=${page}`;
}

export function inr(n: number): string {
  return n === 0 ? "No fee" : `₹${n.toLocaleString("en-IN")}`;
}
