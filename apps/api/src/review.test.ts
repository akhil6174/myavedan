import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyEdits, approvalCheck, buildRecord, fieldStates, priority, reviewFields, type FieldDecision } from "./review";

const snapshot = JSON.parse(readFileSync(new URL("../../../data/snapshot.json", import.meta.url), "utf8"));
const draftFrom = () => {
  const { provenance, ...rest } = structuredClone(snapshot.opportunities[0]);
  return { ...rest, grounding: { "dates.2": { grounded: true }, "fees.0": { grounded: false } } };
};
const meta = { version_no: 1, sha256: "a".repeat(64), retrieved_at: "2026-11-16T09:10:00+05:30" };
const at = (n: number) => `2026-11-20T10:${String(n).padStart(2, "0")}:00Z`;
const approveAll = (keys: string[]): FieldDecision[] => keys.map((key, i) => ({ key, state: "approved", reviewer: "r@x", at: at(i % 60) }));

describe("reviewFields", () => {
  const fields = reviewFields(draftFrom(), [{ field: "dates.2", code: "x", severity: "warning", message: "m" }]);

  it("lists every date, post, rule, fee and the key links as critical", () => {
    const critical = fields.filter((f) => f.critical).map((f) => f.key);
    expect(critical).toContain("dates.2");
    expect(critical).toContain("posts.0");
    expect(critical).toContain("posts.2.rules.2");
    expect(critical).toContain("fees.1");
    expect(critical).toContain("links.apply");
    expect(critical).not.toContain("summary");
  });

  it("carries grounding results and flags to the field", () => {
    const end = fields.find((f) => f.key === "dates.2")!;
    expect(end.grounded).toBe(true);
    expect(end.flags).toHaveLength(1);
    expect(fields.find((f) => f.key === "fees.0")!.grounded).toBe(false);
    expect(fields.find((f) => f.key === "fees.1")!.grounded).toBeNull();
  });
});

describe("approval", () => {
  const draft = draftFrom();
  const fields = reviewFields(draft);
  const critical = fields.filter((f) => f.critical).map((f) => f.key);

  it("blocks approval while a critical field is pending", () => {
    const check = approvalCheck(fields, fieldStates(approveAll(critical.slice(1))));
    expect(check.ok).toBe(false);
    expect(check.pending).toEqual([critical[0]]);
  });

  it("blocks approval when a field is rejected", () => {
    const decisions = [...approveAll(critical), { key: "summary", state: "rejected" as const, reviewer: "r", at: at(59) }];
    expect(approvalCheck(fields, fieldStates(decisions)).rejected).toEqual(["summary"]);
  });

  it("uses the latest decision for a field", () => {
    const decisions: FieldDecision[] = [
      ...approveAll(critical),
      { key: "fees.0", state: "rejected", reviewer: "r", at: "2026-11-20T09:00:00Z" }, // earlier, superseded
    ];
    expect(approvalCheck(fields, fieldStates(decisions)).ok).toBe(true);
  });

  it("blocks approval while an error flag sits on an unreviewed field", () => {
    const flagged = reviewFields(draft, [{ field: "summary", code: "x", severity: "error", message: "m" }]);
    expect(approvalCheck(flagged, fieldStates(approveAll(critical))).errors).toEqual(["summary"]);
  });
});

describe("edits and the public record", () => {
  it("applies a date edit", () => {
    const draft = draftFrom();
    const edited = { ...draft.dates[2], value: "2026-12-18T23:59:00+05:30" };
    const out = applyEdits(draft, fieldStates([{ key: "dates.2", state: "edited", value: edited, reviewer: "r", at: at(1) }]));
    expect(out.dates[2].value).toBe("2026-12-18T23:59:00+05:30");
    expect(draft.dates[2].value).toBe("2026-12-15T23:59:00+05:30"); // original untouched
  });

  it("keeps a post's rules when the post itself is edited", () => {
    const draft = draftFrom();
    const out = applyEdits(draft, fieldStates([{ key: "posts.0", state: "edited", value: { id: "junior-assistant", name: "Junior Assistant", vacancies: 840, pay: "Level 4" }, reviewer: "r", at: at(1) }]));
    expect(out.posts[0].rules).toHaveLength(2);
    expect(out.posts[0].pay).toBe("Level 4");
  });

  it("builds a record the site accepts, without grounding data", () => {
    const draft = draftFrom();
    const result = buildRecord(draft, fieldStates([]), meta, "2026-11-20T15:00:00+05:30");
    if (!result.success) console.error(result.error.issues);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provenance.reviewed_at).toBe("2026-11-20T15:00:00+05:30");
      expect("grounding" in result.data).toBe(false);
      expect(result.data.sample).toBe(false);
    }
  });

  it("refuses an edit that breaks the schema rules", () => {
    const draft = draftFrom();
    const decisions: FieldDecision[] = [{ key: "total_vacancies", state: "edited", value: 9999, reviewer: "r", at: at(1) }];
    expect(buildRecord(draft, fieldStates(decisions), meta, "2026-11-20T15:00:00+05:30").success).toBe(false);
  });
});

describe("queue priority", () => {
  it("puts the soonest open deadline first and closed ones after", () => {
    const today = "2026-11-20";
    const soon = priority("2026-11-22", 2, today);
    const later = priority("2026-12-15", 1, today);
    const closed = priority("2026-11-01", 1, today);
    const unknown = priority(null, 1, today);
    expect([closed, unknown, later, soon].sort((a, b) => a - b)).toEqual([soon, later, closed, unknown]);
  });
});
