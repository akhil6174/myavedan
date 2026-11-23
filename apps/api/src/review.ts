/**
 * Review rules, kept as pure functions so they can be tested without a database.
 *
 * A draft is an opportunity-shaped object produced by the pipeline (same shape as the
 * snapshot, minus provenance), optionally with `grounding` results per field key.
 * Reviewers act on fields addressed by path keys such as "dates.2" or "posts.0.rules.1".
 * Nothing can be approved until every critical field has been approved or edited.
 */
import { DATE_LABEL, Opportunity, type DateKind, type Evidence } from "@myavedan/schema";

export type FieldGroup = "overview" | "dates" | "posts" | "eligibility" | "fees" | "links" | "process";
export type FieldState = "pending" | "approved" | "edited" | "rejected";

export interface Flag {
  field: string;
  code: string;
  severity: "error" | "warning";
  message: string;
}

export interface ReviewField {
  key: string;
  group: FieldGroup;
  label: string;
  critical: boolean;
  value: unknown;
  evidence: Evidence | null;
  /** Result of the pipeline's grounding check; null when not checked. */
  grounded: boolean | null;
  flags: Flag[];
}

export interface FieldDecision {
  key: string;
  state: Exclude<FieldState, "pending">;
  /** Replacement value for edits. */
  value?: unknown;
  reviewer: string;
  at: string;
  reason?: string | null;
}

type Draft = Record<string, any>;

const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Every reviewable field in a draft, in the order the review screen shows them. */
export function reviewFields(draft: Draft, flags: Flag[] = []): ReviewField[] {
  const grounding: Record<string, { grounded?: boolean }> = draft.grounding ?? {};
  const out: ReviewField[] = [];
  const add = (key: string, group: FieldGroup, lbl: string, critical: boolean, value: unknown, evidence: Evidence | null = null) => {
    const g = grounding[key]?.grounded;
    out.push({
      key,
      group,
      label: lbl,
      critical,
      value,
      evidence,
      grounded: typeof g === "boolean" ? g : null,
      flags: flags.filter((f) => f.field === key || f.field.startsWith(`${key}.`)),
    });
  };

  add("title", "overview", "Title", false, draft.title);
  add("organization", "overview", "Organisation", false, draft.organization);
  add("advt_no", "overview", "Advertisement number", false, draft.advt_no ?? null);
  add("summary", "overview", "Plain-language summary", false, draft.summary);
  add("qualification_levels", "overview", "Qualification levels (for filters)", false, draft.qualification_levels);
  add("locations", "overview", "Locations (for filters)", false, draft.locations);
  add("total_vacancies", "posts", "Total vacancies", true, draft.total_vacancies ?? null);

  (draft.dates ?? []).forEach((d: any, i: number) => {
    add(`dates.${i}`, "dates", d.label ?? DATE_LABEL[d.kind as DateKind] ?? label(String(d.kind)), true, d, d.evidence ?? null);
  });
  (draft.posts ?? []).forEach((p: any, i: number) => {
    const { rules, evidence, seats, seats_evidence, ...post } = p;
    add(`posts.${i}`, "posts", `Post: ${p.name}`, true, post, evidence ?? null);
    if (Array.isArray(seats) && seats.length) {
      // Category-wise seats: wrong numbers here mislead candidates as much as a wrong total.
      add(`posts.${i}.seats`, "posts", `${p.name}: seats by category`, true, seats, seats_evidence ?? null);
    }
    (rules ?? []).forEach((r: any, j: number) => {
      const what = r.kind === "dob_window" ? "Age" : r.kind === "qualification" ? "Qualification" : r.label ?? "Other condition";
      add(`posts.${i}.rules.${j}`, "eligibility", `${p.name}: ${what}`, true, r, r.evidence ?? null);
    });
  });
  (draft.fees ?? []).forEach((f: any, i: number) => add(`fees.${i}`, "fees", `Fee: ${f.applies_to}`, true, f, f.evidence ?? null));

  add("links.notice_pdf", "links", "Official notice PDF", true, draft.links?.notice_pdf ?? null);
  add("links.official_page", "links", "Official recruitment page", false, draft.links?.official_page ?? null);
  add("links.apply", "links", "Official application link", true, draft.links?.apply ?? null);

  add("selection_stages", "process", "Selection process", false, draft.selection_stages ?? []);
  add("documents_required", "process", "Documents to keep ready", false, draft.documents_required ?? []);
  add("events", "process", "Updates (admit card, results)", false, draft.events ?? []);
  return out;
}

/** Latest decision per field wins. */
export function fieldStates(decisions: FieldDecision[]): Map<string, FieldDecision> {
  const latest = new Map<string, FieldDecision>();
  for (const d of [...decisions].sort((a, b) => a.at.localeCompare(b.at))) latest.set(d.key, d);
  return latest;
}

export function stateOf(key: string, states: Map<string, FieldDecision>): FieldState {
  return states.get(key)?.state ?? "pending";
}

/** Set a value at a dotted path ("posts.0.rules.1"), creating nothing new except the leaf. */
export function setPath(target: Draft, key: string, value: unknown): void {
  const parts = key.split(".");
  let node: any = target;
  for (const part of parts.slice(0, -1)) {
    const next = Array.isArray(node) ? node[Number(part)] : node?.[part];
    if (next === undefined || next === null) throw new Error(`path ${key} does not exist in the draft`);
    node = next;
  }
  const leaf = parts[parts.length - 1]!;
  if (Array.isArray(node)) node[Number(leaf)] = value;
  else node[leaf] = value;
}

/** The draft with every reviewer edit applied. Post edits keep the post's rules and evidence. */
export function applyEdits(draft: Draft, states: Map<string, FieldDecision>): Draft {
  const copy: Draft = structuredClone(draft);
  // Apply shallow keys before deep ones, so a post edit cannot overwrite a rule edit.
  const edits = [...states.values()].filter((d) => d.state === "edited").sort((a, b) => a.key.split(".").length - b.key.split(".").length);
  for (const e of edits) {
    if (/^posts\.\d+$/.test(e.key)) {
      const i = Number(e.key.split(".")[1]);
      const existing = copy.posts?.[i];
      if (!existing) throw new Error(`path ${e.key} does not exist in the draft`);
      copy.posts[i] = { ...existing, ...(e.value as object), rules: existing.rules, evidence: existing.evidence };
    } else {
      setPath(copy, e.key, e.value);
    }
  }
  return copy;
}

export interface ApprovalCheck {
  ok: boolean;
  pending: string[];
  rejected: string[];
  errors: string[];
}

/** Every critical field must be approved or edited, none rejected, and no error flags left unaddressed. */
export function approvalCheck(fields: ReviewField[], states: Map<string, FieldDecision>): ApprovalCheck {
  const pending: string[] = [];
  const rejected: string[] = [];
  const errors: string[] = [];
  for (const f of fields) {
    const s = stateOf(f.key, states);
    if (f.critical && s === "pending") pending.push(f.key);
    if (s === "rejected") rejected.push(f.key);
    if (s === "pending" && f.flags.some((fl) => fl.severity === "error")) errors.push(f.key);
  }
  return { ok: pending.length === 0 && rejected.length === 0 && errors.length === 0, pending, rejected, errors };
}

export interface VersionMeta {
  version_no: number;
  sha256: string;
  retrieved_at: string;
  change_note?: string | null;
}

/** Build the public record and validate it with the same schema the site uses. */
export function buildRecord(draft: Draft, states: Map<string, FieldDecision>, meta: VersionMeta, reviewedAt: string) {
  const applied = applyEdits(draft, states);
  delete applied.grounding;
  const record = {
    ...applied,
    sample: false,
    provenance: {
      version: meta.version_no,
      sha256: meta.sha256,
      retrieved_at: meta.retrieved_at,
      reviewed_at: reviewedAt,
      last_checked_at: reviewedAt,
      ...(meta.change_note ? { change_note: meta.change_note } : {}),
    },
  };
  return Opportunity.safeParse(record);
}

/** Queue priority: soonest deadline first, then tier, then age. Lower sorts first. */
export function priority(applyEnd: string | null, tier: number, todayIso: string): number {
  if (!applyEnd) return 10_000 + tier * 100;
  const days = Math.round((Date.parse(applyEnd.slice(0, 10)) - Date.parse(todayIso)) / 86_400_000);
  // Already-closed notices still need review, but after open ones.
  return (days < 0 ? 5_000 - days : days) + tier * 3;
}
