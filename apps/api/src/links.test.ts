import { describe, expect, it } from "vitest";
import { advtCodes, suggest, type Candidate } from "./links";

const candidates: Candidate[] = [
  { id: "rrb-sm", slug: "rrb-station-master-2026", title: "Station Master Recruitment (CEN 08/2026)", advt_no: "CEN 08/2026", organization_id: "org_rrb-apply" },
  { id: "rrb-ntpc", slug: "rrb-ntpc-2026", title: "Non Technical Popular Categories (CEN 05/2026)", advt_no: "CEN 05/2026", organization_id: "org_rrb-apply" },
  { id: "uppsc-ae", slug: "uppsc-assistant-engineer-2026", title: "Assistant Engineer Examination 2026", advt_no: "A-4/E-1/2026", organization_id: "org_uppsc" },
  { id: "ssc-steno", slug: "ssc-stenographer-2026", title: "Stenographer Grade C and D Examination 2026", advt_no: null, organization_id: "org_ssc" },
];

describe("advertisement codes", () => {
  it("normalises the separators", () => {
    // Codes may run into neighbouring words; matching checks containment, so the number must be inside.
    expect([...advtCodes("Admit card for CEN 08/2026")].some((c) => c.includes("CEN/08/2026"))).toBe(true);
    expect([...advtCodes("RESULT_A-4_E-1_2026.pdf")].some((c) => c.includes("A/4/E/1/2026"))).toBe(true);
  });
});

describe("suggest", () => {
  it("picks the recruitment with the matching advertisement number", () => {
    const s = suggest("City intimation and e-Call Letter for CEN 08/2026 (Station Master)", "https://rrbapply.gov.in/x.pdf", "org_rrb-apply", candidates);
    expect(s[0]!.id).toBe("rrb-sm");
    expect(s[0]!.why).toContain("advt");
  });

  it("finds the advertisement number in the file name", () => {
    const s = suggest("Result", "https://uppsc.up.nic.in/RESULT_A-4_E-1_2026.pdf", "org_uppsc", candidates);
    expect(s[0]!.id).toBe("uppsc-ae");
  });

  it("falls back to title words within the same organisation", () => {
    const s = suggest("Tentative answer key: Stenographer Grade C and D 2026", "https://ssc.gov.in/k.pdf", "org_ssc", candidates);
    expect(s[0]!.id).toBe("ssc-steno");
  });

  it("suggests nothing for an unrelated link", () => {
    expect(suggest("Holiday list", "https://ssc.gov.in/h.pdf", "org_other", candidates)).toEqual([]);
  });
});

import { overlap, tokens as tk } from "./links";
import { flagTier } from "./admin";

describe("similar documents", () => {
  it("measures title-word overlap on the smaller title", () => {
    expect(overlap(tk("Junior Clerk Recruitment 2026 Detailed Notice"), tk("Detailed notice: Junior Clerk 2026"))).toBeGreaterThanOrEqual(0.9);
    expect(overlap(tk("Junior Clerk Recruitment"), tk("Constable Driver Recruitment"))).toBeLessThan(0.5);
    expect(overlap(new Set(), tk("anything"))).toBe(0);
  });
});

describe("flag tiers", () => {
  it("puts errors and second checks in red, the rest in yellow", () => {
    expect(flagTier({ field: "x", code: "value_differs_from_quote", severity: "error", message: "" })).toBe("red");
    expect(flagTier({ field: "x", code: "second_check_fee", severity: "warning", message: "" })).toBe("red");
    expect(flagTier({ field: "x", code: "lite_model", severity: "warning", message: "" })).toBe("yellow");
    expect(flagTier({ field: "x", code: "insecure_tls", severity: "warning", message: "" })).toBe("yellow");
  });
});
