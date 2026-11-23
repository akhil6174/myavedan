import { DATE_LABEL, QUALIFICATION_LABEL, type DateKind, type QualificationLevel } from "@myavedan/schema/types";
import { formatDate, formatDateTime } from "@myavedan/schema/dates";
import type { Field } from "./api";

export const SITE_URL = (import.meta.env.VITE_SITE_URL as string | undefined) ?? "https://staging.myavedan.in";

const inr = (n: number) => (n === 0 ? "No fee" : `₹${n.toLocaleString("en-IN")}`);

/** One readable line (or a few) describing a field's value, the way the public page will show it. */
export function describe(field: Pick<Field, "group" | "key">, value: unknown): string[] {
  if (value === null || value === undefined || value === "") return ["(empty)"];
  const v = value as any;
  switch (field.group) {
    case "dates": {
      const when = v.value ? formatDateTime(v.value) : (v.approx ?? "To be announced");
      return [`${v.label ?? DATE_LABEL[v.kind as DateKind] ?? v.kind}: ${when}${v.tentative ? " (tentative)" : ""}`];
    }
    case "posts":
      if (field.key === "total_vacancies") return [String(v)];
      if (field.key.endsWith(".seats") && Array.isArray(v)) {
        const main = v.filter((s: any) => !s.horizontal);
        const within = v.filter((s: any) => s.horizontal);
        return [
          main.map((s: any) => `${s.group} ${s.count}`).join(" · ") + (main.length ? ` (total ${main.reduce((n: number, s: any) => n + s.count, 0)})` : ""),
          within.length ? `Within these: ${within.map((s: any) => `${s.group} ${s.count}`).join(" · ")}` : "",
        ].filter(Boolean);
      }
      return [`${v.name} · ${v.vacancies ?? "vacancies not stated"} vacancies${v.pay ? ` · ${v.pay}` : ""}${v.location ? ` · ${v.location}` : ""}`];
    case "eligibility":
      if (v.kind === "dob_window") {
        const relax = (v.relaxations ?? [])
          .map((r: any) => `${r.applies_to} ${r.years === null ? "(no figure)" : `+${r.years}`}${r.cumulative ? " cumulative" : ""}`)
          .join(", ");
        return [
          `Born ${formatDate(v.born_on_or_after)} to ${formatDate(v.born_on_or_before)}${v.as_on ? ` (age as on ${formatDate(v.as_on)})` : ""}`,
          `Notice says: “${v.stated}”`,
          relax ? `Relaxations: ${relax}` : "No relaxations listed",
        ];
      }
      if (v.kind === "qualification") {
        const fy = v.final_year_allowed === null ? "not stated" : v.final_year_allowed ? "allowed" : "not allowed";
        return [
          `At least ${QUALIFICATION_LABEL[v.min_level as QualificationLevel] ?? v.min_level}${v.held_by ? `, held by ${formatDate(v.held_by)}` : ""}`,
          `Result awaited: ${fy}${v.subjects?.length ? ` · Subjects: ${v.subjects.join(", ")}` : ""}`,
          `Notice says: “${v.stated}”`,
        ];
      }
      return [`${v.label}: ${v.stated}`, v.blocking ? "Blocks eligibility if not met" : "Information only"];
    case "fees":
      return [`${v.applies_to}: ${inr(v.amount_inr)}`];
  }
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === "string" ? x : `${x.title ?? JSON.stringify(x)}`)) : ["(none)"];
  if (typeof v === "object") {
    if (field.key === "organization") return [`${v.name}${v.short ? ` (${v.short})` : ""} · ${v.jurisdiction}${v.state ? `, ${v.state}` : ""} · ${v.domain}`];
    if (field.key === "summary") return [v.en, v.reviewed ? "" : "(summary not yet reviewed)"].filter(Boolean);
    return [JSON.stringify(v)];
  }
  return [String(v)];
}

/** Value at a dotted path in the live record, shaped like the draft field for comparison. */
export function previousValue(previous: Record<string, unknown> | null, key: string): unknown {
  if (!previous) return undefined;
  let node: any = previous;
  for (const part of key.split(".")) {
    node = Array.isArray(node) ? node[Number(part)] : node?.[part];
    if (node === undefined) return undefined;
  }
  if (/^posts\.\d+$/.test(key) && node) {
    const { rules, evidence, ...post } = node;
    return post;
  }
  return node;
}

/** Compare values ignoring evidence, which changes with every new file. */
export function sameValue(a: unknown, b: unknown): boolean {
  const strip = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(strip);
    if (x && typeof x === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(x)) if (k !== "evidence") out[k] = strip(val);
      return out;
    }
    return x;
  };
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}
