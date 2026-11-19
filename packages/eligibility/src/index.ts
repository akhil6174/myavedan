/**
 * Deterministic eligibility engine.
 *
 * approved rules + applicant inputs → a result per condition → one verdict.
 * AI may help draft rules during extraction; it never makes this decision.
 * Pure functions only: the same code runs in the browser (so date of birth and
 * category never leave the device), in the Worker and in tests.
 */
import type {
  AgeRule,
  Category,
  Evidence,
  OtherRule,
  Post,
  QualificationLevel,
  QualificationRule,
  Relaxation,
  RelaxationGroup,
} from "@myavedan/schema/types";
import { formatDate, shiftYears } from "@myavedan/schema/dates";

export interface Applicant {
  /** YYYY-MM-DD */
  dob?: string | null;
  category?: Category | null;
  pwbd?: boolean;
  exServiceman?: boolean;
  /** Highest qualification, finished or in its final year. */
  qualification?: QualificationLevel | null;
  /** The highest qualification's result is still awaited. */
  resultAwaited?: boolean;
}

export type ConditionState = "met" | "not_met" | "unknown" | "info";
/**
 * Why a condition is unknown:
 * - input: the applicant left something blank
 * - rule:  the notice is silent or vague, so the engine will not guess
 * - check: the applicant must confirm or prove it themselves (domicile, subject, result date)
 */
export type UnknownReason = "input" | "rule" | "check";

export interface ConditionResult {
  key: string;
  label: string;
  state: ConditionState;
  reason?: UnknownReason;
  message: string;
  /** The notice's own wording. */
  stated: string;
  evidence: Evidence[];
}

export type Verdict = "likely_eligible" | "potentially_eligible" | "not_eligible" | "cannot_determine";

export interface PostResult {
  postId: string;
  postName: string;
  verdict: Verdict;
  conditions: ConditionResult[];
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  likely_eligible: "Likely eligible",
  potentially_eligible: "Potentially eligible",
  not_eligible: "Not eligible based on provided details",
  cannot_determine: "Cannot determine",
};

export const VERDICT_HELP: Record<Verdict, string> = {
  likely_eligible: "All stated conditions appear to match. Confirm in the official notification before applying.",
  potentially_eligible: "Everything known matches. At least one condition is something you need to confirm or prove.",
  not_eligible: "At least one stated condition is not met. The rule is shown below.",
  cannot_determine: "The notice or your inputs do not settle at least one condition.",
};

export const QUALIFICATION_RANK: Record<QualificationLevel, number> = {
  "10th": 1,
  "12th": 2,
  iti: 2,
  diploma: 3,
  graduate: 4,
  postgraduate: 5,
  doctorate: 6,
};

const QUAL_LABEL: Record<QualificationLevel, string> = {
  "10th": "10th pass",
  "12th": "12th pass",
  iti: "ITI",
  diploma: "a diploma",
  graduate: "a bachelor's degree",
  postgraduate: "a postgraduate degree",
  doctorate: "a doctorate",
};

// ---------------------------------------------------------------- age

interface RelaxationPick {
  years: number;
  parts: string[];
  used: Relaxation[];
  /** Relaxations that apply to the applicant but whose figure the notice does not give. */
  unspecified: Relaxation[];
  /** The applicant has not chosen a category, and the notice has category relaxations. */
  categoryMissing: boolean;
}

function pickRelaxation(rule: AgeRule, a: Applicant): RelaxationPick {
  const find = (g: RelaxationGroup) => rule.relaxations.find((r) => r.applies_to === g);
  const pick: RelaxationPick = { years: 0, parts: [], used: [], unspecified: [], categoryMissing: false };

  const categoryGroups: RelaxationGroup[] = ["EWS", "OBC", "SC", "ST"];
  let categoryYears = 0;
  if (!a.category) {
    pick.categoryMissing = rule.relaxations.some((r) => categoryGroups.includes(r.applies_to));
  } else if (a.category !== "UR") {
    const r = find(a.category);
    if (r && r.years === null) pick.unspecified.push(r);
    else if (r && r.years) {
      categoryYears = r.years;
      pick.used.push(r);
      pick.parts.push(`${a.category} +${r.years}`);
    }
  }

  let total = categoryYears;
  if (a.pwbd) {
    const r = find("PwBD");
    if (r && r.years === null) pick.unspecified.push(r);
    else if (r && r.years) {
      pick.used.push(r);
      pick.parts.push(`PwBD +${r.years}`);
      total = r.cumulative ? total + r.years : Math.max(total, r.years);
    }
  }
  if (a.exServiceman) {
    const r = find("ESM");
    if (r && r.years === null) pick.unspecified.push(r);
    else if (r && r.years) {
      pick.used.push(r);
      pick.parts.push(`ex-serviceman +${r.years}`);
      total = Math.max(total, r.years);
    }
  }
  pick.years = total;
  return pick;
}

export function evaluateAge(rule: AgeRule, a: Applicant): ConditionResult {
  const base = { key: "age", label: "Age", stated: rule.stated, evidence: [rule.evidence] };
  const latest = formatDate(rule.born_on_or_before);

  if (!a.dob) {
    return { ...base, state: "unknown", reason: "input", message: "Enter your date of birth to check the age limit." };
  }
  const born = formatDate(a.dob);

  if (a.dob > rule.born_on_or_before) {
    return {
      ...base,
      state: "not_met",
      message: `Born ${born}. The latest allowed date of birth is ${latest}, so you are under the minimum age. Relaxations do not lower the minimum age.`,
    };
  }
  if (a.dob >= rule.born_on_or_after) {
    return {
      ...base,
      state: "met",
      message: `Born ${born}. Allowed: born between ${formatDate(rule.born_on_or_after)} and ${latest}.`,
    };
  }

  // Older than the general limit: only a relaxation can help.
  const pick = pickRelaxation(rule, a);
  const bound = shiftYears(rule.born_on_or_after, -pick.years);
  const evidence = [rule.evidence, ...pick.used.map((r) => r.evidence), ...pick.unspecified.map((r) => r.evidence)].filter(
    (e): e is Evidence => e !== null,
  );
  const withRelax = pick.parts.length ? ` with relaxation (${pick.parts.join(", ")} years)` : "";

  if (pick.years > 0 && a.dob >= bound) {
    return { ...base, evidence, state: "met", message: `Born ${born}. Allowed${withRelax}: born on or after ${formatDate(bound)}.` };
  }
  if (pick.unspecified.length) {
    const groups = pick.unspecified.map((r) => (r.applies_to === "ESM" ? "ex-servicemen" : r.applies_to)).join(", ");
    return {
      ...base,
      evidence,
      state: "unknown",
      reason: "rule",
      message: `Born ${born}, before ${formatDate(bound)}. The notice gives the ${groups} relaxation without a figure, so the engine will not guess.`,
    };
  }
  if (pick.categoryMissing) {
    return {
      ...base,
      evidence,
      state: "unknown",
      reason: "input",
      message: `Born ${born}, before ${formatDate(rule.born_on_or_after)}. Choose your category: an age relaxation may apply.`,
    };
  }
  return {
    ...base,
    evidence,
    state: "not_met",
    message: `Born ${born}. Allowed${withRelax}: born on or after ${formatDate(bound)}.`,
  };
}

// ------------------------------------------------------- qualification

export function evaluateQualification(rule: QualificationRule, a: Applicant): ConditionResult {
  const base = { key: "qualification", label: "Qualification", stated: rule.stated, evidence: [rule.evidence] };
  const need = rule.min_level;
  const by = rule.held_by ? ` by ${formatDate(rule.held_by)}` : "";

  if (!a.qualification) {
    return { ...base, state: "unknown", reason: "input", message: "Choose your highest qualification." };
  }
  const have = a.qualification;
  const haveRank = QUALIFICATION_RANK[have];
  const needRank = QUALIFICATION_RANK[need];

  if (haveRank < needRank) {
    return { ...base, state: "not_met", message: `The post needs ${QUAL_LABEL[need]}; you selected ${QUAL_LABEL[have]}.` };
  }
  if (haveRank === needRank && have !== need) {
    return {
      ...base,
      state: "unknown",
      reason: "rule",
      message: `The post needs ${QUAL_LABEL[need]}. The notice does not say whether ${QUAL_LABEL[have]} counts as equivalent.`,
    };
  }
  if (a.resultAwaited && haveRank === needRank) {
    if (rule.final_year_allowed === false) {
      return { ...base, state: "not_met", message: "The notice does not accept candidates whose result is awaited." };
    }
    if (rule.final_year_allowed === null) {
      return {
        ...base,
        state: "unknown",
        reason: "check",
        message: `You must hold ${QUAL_LABEL[need]}${by}. You qualify only if your result is declared by then; keep proof of the result date.`,
      };
    }
  }
  if (rule.subjects.length) {
    return {
      ...base,
      state: "unknown",
      reason: "check",
      message: `Your qualification must be in: ${rule.subjects.join(", ")}. Confirm that yours matches.`,
    };
  }
  const provisional = a.resultAwaited && rule.final_year_allowed === true ? " Final-year candidates may apply provisionally." : "";
  return { ...base, state: "met", message: `You have ${QUAL_LABEL[have]}; the post needs ${QUAL_LABEL[need]}${by}.${provisional}` };
}

// --------------------------------------------------------------- other

export function evaluateOther(rule: OtherRule): ConditionResult {
  const base = { key: slug(rule.label), label: rule.label, stated: rule.stated, evidence: [rule.evidence] };
  if (!rule.blocking) return { ...base, state: "info", message: rule.stated };
  return { ...base, state: "unknown", reason: "check", message: `Confirm this yourself: ${rule.stated}` };
}

// -------------------------------------------------------------- verdict

export function verdictOf(conditions: ConditionResult[]): Verdict {
  if (conditions.some((c) => c.state === "not_met")) return "not_eligible";
  if (conditions.some((c) => c.state === "unknown" && (c.reason === "input" || c.reason === "rule"))) return "cannot_determine";
  if (conditions.some((c) => c.state === "unknown")) return "potentially_eligible";
  return "likely_eligible";
}

export function evaluatePost(post: Pick<Post, "id" | "name" | "rules">, a: Applicant): PostResult {
  const conditions = post.rules.map((rule) => {
    switch (rule.kind) {
      case "dob_window":
        return evaluateAge(rule, a);
      case "qualification":
        return evaluateQualification(rule, a);
      case "other":
        return evaluateOther(rule);
    }
  });
  return { postId: post.id, postName: post.name, verdict: verdictOf(conditions), conditions };
}

export function evaluatePosts(posts: Pick<Post, "id" | "name" | "rules">[], a: Applicant): PostResult[] {
  return posts.map((p) => evaluatePost(p, a));
}

/** Plain description of the inputs used, shown under every result. */
export function describeInputs(a: Applicant): string {
  const parts = [
    a.dob ? `born ${formatDate(a.dob)}` : "date of birth not given",
    a.category ?? "category not given",
    a.pwbd ? "PwBD" : null,
    a.exServiceman ? "ex-serviceman" : null,
    a.qualification ? QUAL_LABEL[a.qualification] + (a.resultAwaited ? " (result awaited)" : "") : "qualification not given",
  ];
  return parts.filter(Boolean).join(" · ");
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
