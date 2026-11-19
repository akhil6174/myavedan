/**
 * The snapshot contract.
 *
 * The public site builds only from a Snapshot. In production the publish job
 * fills it with approved records; in development it holds sample notices.
 * Anything here that a reviewer must check carries Evidence (page, section, snippet).
 */
import { z } from "zod";

// ---------- primitives ----------

export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const IsoDateTimeIst = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?\+05:30$/, "Use YYYY-MM-DDTHH:mm+05:30 (IST)");
export const DateValue = z.union([IsoDate, IsoDateTimeIst]);

export const Evidence = z.object({
  page: z.number().int().positive(),
  section: z.string().min(1).optional(),
  snippet: z.string().min(1),
});

export const Jurisdiction = z.enum(["central", "state", "ut"]);
export const Category = z.enum(["UR", "EWS", "OBC", "SC", "ST"]);
export const QualificationLevel = z.enum([
  "10th",
  "12th",
  "iti",
  "diploma",
  "graduate",
  "postgraduate",
  "doctorate",
]);

// ---------- dates and events ----------

export const DateKind = z.enum([
  "notification",
  "apply_start",
  "apply_end",
  "fee_end",
  "correction_start",
  "correction_end",
  "exam",
  "admit_card",
  "result",
]);

/** Dates whose value must carry evidence before publishing. */
export const CRITICAL_DATE_KINDS = ["apply_start", "apply_end", "correction_start", "correction_end", "exam"] as const;

export const ImportantDate = z.object({
  kind: DateKind,
  label: z.string().optional(),
  /** null when the notice says "to be announced". */
  value: DateValue.nullable(),
  /** Free text when the notice is vague, e.g. "February 2027". */
  approx: z.string().optional(),
  tentative: z.boolean().default(false),
  evidence: Evidence.nullable(),
});

export const EventKind = z.enum([
  "corrigendum",
  "admit_card",
  "answer_key",
  "result",
  "cutoff",
  "postponed",
  "cancelled",
]);

/** A later official document about the same opportunity. */
export const OpportunityEvent = z.object({
  kind: EventKind,
  date: IsoDate,
  title: z.string().min(1),
  link: z.string().url(),
  evidence: Evidence.nullable(),
});

// ---------- eligibility rules ----------

export const RelaxationGroup = z.enum(["EWS", "OBC", "SC", "ST", "PwBD", "ESM"]);

export const Relaxation = z.object({
  applies_to: RelaxationGroup,
  /** null when the notice gives no figure, e.g. "as per Government rules". */
  years: z.number().nonnegative().nullable(),
  /** true when it adds on top of the category relaxation (PwBD usually does). */
  cumulative: z.boolean().default(false),
  evidence: Evidence.nullable(),
});

/** Age limit stored as a date-of-birth window, the way most notices state it. */
export const AgeRule = z.object({
  kind: z.literal("dob_window"),
  born_on_or_after: IsoDate,
  born_on_or_before: IsoDate,
  /** Age cut-off date stated in the notice, for display. */
  as_on: IsoDate.optional(),
  /** The notice's own wording, e.g. "18–27 years as on 01.01.2027". */
  stated: z.string().min(1),
  relaxations: z.array(Relaxation).default([]),
  evidence: Evidence,
});

export const QualificationRule = z.object({
  kind: z.literal("qualification"),
  min_level: QualificationLevel,
  /** Date by which the qualification must be held. */
  held_by: IsoDate.nullable(),
  /** true / false when the notice says so; null when it is silent. */
  final_year_allowed: z.boolean().nullable(),
  /** Required subjects or disciplines; empty when any is accepted. */
  subjects: z.array(z.string()).default([]),
  stated: z.string().min(1),
  evidence: Evidence,
});

/** Any condition the engine cannot evaluate yet (domicile, physical standards, experience). */
export const OtherRule = z.object({
  kind: z.literal("other"),
  label: z.string().min(1),
  stated: z.string().min(1),
  /** true when failing it would make the applicant ineligible. */
  blocking: z.boolean(),
  evidence: Evidence,
});

export const Rule = z.discriminatedUnion("kind", [AgeRule, QualificationRule, OtherRule]);

export const Post = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  vacancies: z.number().int().nonnegative().nullable(),
  location: z.string().optional(),
  pay: z.string().optional(),
  rules: z.array(Rule),
  evidence: Evidence.nullable(),
});

export const Fee = z.object({
  applies_to: z.string().min(1),
  amount_inr: z.number().nonnegative(),
  evidence: Evidence.nullable(),
});

// ---------- opportunity ----------

export const Organization = z.object({
  name: z.string().min(1),
  short: z.string().optional(),
  jurisdiction: Jurisdiction,
  /** State or UT name for state/ut jurisdiction; null for central. */
  state: z.string().nullable(),
  /** Official host, shown on every record. */
  domain: z.string().min(3),
});

export const Provenance = z.object({
  version: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  retrieved_at: IsoDateTimeIst,
  reviewed_at: IsoDateTimeIst,
  last_checked_at: IsoDateTimeIst,
  change_note: z.string().optional(),
});

export const Opportunity = z
  .object({
    id: z.string().min(1),
    slug: z.string().regex(/^[a-z0-9-]+$/),
    /** true for invented records used in development and demos. */
    sample: z.boolean().default(false),
    type: z.literal("job").default("job"),
    title: z.string().min(1),
    organization: Organization,
    advt_no: z.string().nullable(),
    /** Levels that appear across posts, used for filters. */
    qualification_levels: z.array(QualificationLevel).min(1),
    /** States where posts are located; "All India" for national postings. */
    locations: z.array(z.string()).min(1),
    total_vacancies: z.number().int().nonnegative().nullable(),
    summary: z.object({
      en: z.string().min(1),
      hi: z.string().optional(),
      reviewed: z.boolean(),
    }),
    dates: z.array(ImportantDate).min(1),
    posts: z.array(Post).min(1),
    fees: z.array(Fee),
    selection_stages: z.array(z.string()),
    documents_required: z.array(z.string()),
    events: z.array(OpportunityEvent).default([]),
    links: z.object({
      notice_pdf: z.string().url(),
      official_page: z.string().url(),
      apply: z.string().url().nullable(),
    }),
    provenance: Provenance,
  })
  .superRefine((o, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

    // Critical dates must carry evidence.
    o.dates.forEach((d, i) => {
      if (d.value && !d.evidence && (CRITICAL_DATE_KINDS as readonly string[]).includes(d.kind)) {
        issue(["dates", i, "evidence"], `${d.kind} has a value but no evidence`);
      }
    });

    // Application window in order.
    const start = o.dates.find((d) => d.kind === "apply_start")?.value;
    const end = o.dates.find((d) => d.kind === "apply_end")?.value;
    if (start && end && start.slice(0, 10) > end.slice(0, 10)) {
      issue(["dates"], "apply_start is after apply_end");
    }

    // Post ids unique; vacancies add up.
    const ids = new Set<string>();
    o.posts.forEach((p, i) => {
      if (ids.has(p.id)) issue(["posts", i, "id"], `duplicate post id ${p.id}`);
      ids.add(p.id);
      p.rules.forEach((r, j) => {
        if (r.kind === "dob_window" && r.born_on_or_after > r.born_on_or_before) {
          issue(["posts", i, "rules", j], "born_on_or_after is later than born_on_or_before");
        }
      });
    });
    const counted = o.posts.every((p) => p.vacancies !== null);
    if (counted && o.total_vacancies !== null) {
      const sum = o.posts.reduce((s, p) => s + (p.vacancies ?? 0), 0);
      if (sum !== o.total_vacancies) {
        issue(["total_vacancies"], `posts add up to ${sum}, total says ${o.total_vacancies}`);
      }
    }

    // Links must stay on the organisation's official host.
    const host = (u: string) => new URL(u).hostname.replace(/^www\./, "");
    const official = o.organization.domain.replace(/^www\./, "");
    const onHost = (u: string) => host(u) === official || host(u).endsWith(`.${official}`);
    (["notice_pdf", "official_page", "apply"] as const).forEach((k) => {
      const u = o.links[k];
      if (u && !onHost(u)) issue(["links", k], `${u} is not on ${official}`);
    });

    // Event dates cannot precede the notification.
    const notified = o.dates.find((d) => d.kind === "notification")?.value;
    o.events.forEach((e, i) => {
      if (notified && e.date < notified.slice(0, 10)) issue(["events", i, "date"], "event is before the notification date");
    });
  });

export const Snapshot = z.object({
  generated_at: IsoDateTimeIst,
  /** true while the site runs on invented data. */
  sample: z.boolean(),
  opportunities: z.array(Opportunity),
});

// ---------- inferred types ----------

export type Evidence = z.infer<typeof Evidence>;
export type Jurisdiction = z.infer<typeof Jurisdiction>;
export type Category = z.infer<typeof Category>;
export type QualificationLevel = z.infer<typeof QualificationLevel>;
export type DateKind = z.infer<typeof DateKind>;
export type ImportantDate = z.infer<typeof ImportantDate>;
export type EventKind = z.infer<typeof EventKind>;
export type OpportunityEvent = z.infer<typeof OpportunityEvent>;
export type RelaxationGroup = z.infer<typeof RelaxationGroup>;
export type Relaxation = z.infer<typeof Relaxation>;
export type AgeRule = z.infer<typeof AgeRule>;
export type QualificationRule = z.infer<typeof QualificationRule>;
export type OtherRule = z.infer<typeof OtherRule>;
export type Rule = z.infer<typeof Rule>;
export type Post = z.infer<typeof Post>;
export type Fee = z.infer<typeof Fee>;
export type Organization = z.infer<typeof Organization>;
export type Provenance = z.infer<typeof Provenance>;
export type Opportunity = z.infer<typeof Opportunity>;
export type Snapshot = z.infer<typeof Snapshot>;

/** Readable labels shared by the site and admin. */
export const QUALIFICATION_LABEL: Record<QualificationLevel, string> = {
  "10th": "10th pass",
  "12th": "12th pass",
  iti: "ITI",
  diploma: "Diploma",
  graduate: "Graduate",
  postgraduate: "Postgraduate",
  doctorate: "Doctorate",
};

export const DATE_LABEL: Record<DateKind, string> = {
  notification: "Notification",
  apply_start: "Apply from",
  apply_end: "Last date to apply",
  fee_end: "Last date for fee",
  correction_start: "Correction window opens",
  correction_end: "Correction window closes",
  exam: "Exam",
  admit_card: "Admit card",
  result: "Result",
};

export const EVENT_LABEL: Record<EventKind, string> = {
  corrigendum: "Corrigendum",
  admit_card: "Admit card",
  answer_key: "Answer key",
  result: "Result",
  cutoff: "Cut-off marks",
  postponed: "Postponed",
  cancelled: "Cancelled",
};
