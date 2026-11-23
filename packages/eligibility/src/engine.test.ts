import { describe, expect, it } from "vitest";
import type { AgeRule, OtherRule, QualificationRule } from "@myavedan/schema/types";
import { evaluateAge, evaluatePost, evaluateQualification, verdictOf, type Applicant } from "./index";

const ev = { page: 4, section: "5.1", snippet: "Age limit" };

/** 18–27 years as on 01.01.2027, the sample Junior Assistant notice. */
const age: AgeRule = {
  kind: "dob_window",
  born_on_or_after: "1999-01-02",
  born_on_or_before: "2009-01-01",
  as_on: "2027-01-01",
  stated: "18–27 years as on 01.01.2027",
  relaxations: [
    { applies_to: "OBC", years: 3, cumulative: false, evidence: ev },
    { applies_to: "SC", years: 5, cumulative: false, evidence: ev },
    { applies_to: "ST", years: 5, cumulative: false, evidence: ev },
    { applies_to: "PwBD", years: 10, cumulative: true, evidence: ev },
    { applies_to: "ESM", years: null, cumulative: false, evidence: ev },
  ],
  evidence: ev,
};

const graduate: QualificationRule = {
  kind: "qualification",
  min_level: "graduate",
  held_by: "2026-12-15",
  final_year_allowed: null,
  subjects: [],
  stated: "Bachelor's degree",
  evidence: ev,
};

const ur = (dob: string, extra: Partial<Applicant> = {}): Applicant => ({ dob, category: "UR", ...extra });

describe("age: date-of-birth window boundaries", () => {
  it.each([
    ["1999-01-01", "not_met"], // one day too old
    ["1999-01-02", "met"], // oldest allowed
    ["2005-06-15", "met"],
    ["2009-01-01", "met"], // youngest allowed
    ["2009-01-02", "not_met"], // one day too young
  ])("born %s → %s", (dob, state) => {
    expect(evaluateAge(age, ur(dob)).state).toBe(state);
  });

  it("asks for a date of birth when it is missing", () => {
    expect(evaluateAge(age, { category: "UR" })).toMatchObject({ state: "unknown", reason: "input" });
  });

  it("never lets relaxation lower the minimum age", () => {
    expect(evaluateAge(age, { dob: "2009-06-01", category: "SC", pwbd: true }).state).toBe("not_met");
  });
});

describe("age: relaxations", () => {
  it("applies the OBC relaxation exactly at its boundary", () => {
    expect(evaluateAge(age, { dob: "1996-01-02", category: "OBC" }).state).toBe("met");
    expect(evaluateAge(age, { dob: "1996-01-01", category: "OBC" }).state).toBe("not_met");
  });

  it("adds PwBD on top of the category when cumulative", () => {
    // SC 5 + PwBD 10 = 15 years → born on or after 02 Jan 1984
    expect(evaluateAge(age, { dob: "1984-01-02", category: "SC", pwbd: true }).state).toBe("met");
    expect(evaluateAge(age, { dob: "1984-01-01", category: "SC", pwbd: true }).state).toBe("not_met");
  });

  it("uses the larger figure when PwBD is not cumulative", () => {
    const rule: AgeRule = { ...age, relaxations: [{ applies_to: "OBC", years: 5, cumulative: false, evidence: ev }, { applies_to: "PwBD", years: 7, cumulative: false, evidence: ev }] };
    expect(evaluateAge(rule, { dob: "1992-01-02", category: "OBC", pwbd: true }).state).toBe("met");
    expect(evaluateAge(rule, { dob: "1992-01-01", category: "OBC", pwbd: true }).state).toBe("not_met");
  });

  it("does not guess an ex-servicemen relaxation the notice leaves unspecified", () => {
    expect(evaluateAge(age, ur("1990-05-05", { exServiceman: true }))).toMatchObject({ state: "unknown", reason: "rule" });
    // Within the general window, the missing figure does not matter.
    expect(evaluateAge(age, ur("2001-05-05", { exServiceman: true })).state).toBe("met");
  });

  it("asks for the category only when a relaxation could change the answer", () => {
    expect(evaluateAge(age, { dob: "1997-03-10" })).toMatchObject({ state: "unknown", reason: "input" });
    expect(evaluateAge(age, { dob: "2001-03-10" }).state).toBe("met");
  });

  it("gives EWS no age relaxation when the notice lists none", () => {
    expect(evaluateAge(age, { dob: "1998-06-01", category: "EWS" }).state).toBe("not_met");
  });

  it("handles a 29 February bound", () => {
    const leap: AgeRule = { ...age, born_on_or_after: "2000-02-29", born_on_or_before: "2008-02-29" };
    // OBC +3 → 29 Feb 1997 does not exist → 1 Mar 1997
    expect(evaluateAge(leap, { dob: "1997-03-01", category: "OBC" }).state).toBe("met");
    expect(evaluateAge(leap, { dob: "1997-02-28", category: "OBC" }).state).toBe("not_met");
  });

  it("cites the relaxation it used", () => {
    const r = evaluateAge(age, { dob: "1997-03-10", category: "OBC" });
    expect(r.state).toBe("met");
    expect(r.message).toContain("OBC +3");
    expect(r.message).toContain("02 Jan 1996");
  });
});

describe("qualification", () => {
  it("accepts the required level or higher", () => {
    expect(evaluateQualification(graduate, { qualification: "graduate" }).state).toBe("met");
    expect(evaluateQualification(graduate, { qualification: "postgraduate" }).state).toBe("met");
  });

  it("rejects a lower level", () => {
    expect(evaluateQualification(graduate, { qualification: "12th" }).state).toBe("not_met");
  });

  it("needs proof when the result is awaited and the notice is silent", () => {
    expect(evaluateQualification(graduate, { qualification: "graduate", resultAwaited: true })).toMatchObject({ state: "unknown", reason: "check" });
  });

  it("rejects awaited results when the notice says so", () => {
    expect(evaluateQualification({ ...graduate, final_year_allowed: false }, { qualification: "graduate", resultAwaited: true }).state).toBe("not_met");
  });

  it("ignores an awaited result for a higher qualification than required", () => {
    const twelfth = { ...graduate, min_level: "12th" as const, final_year_allowed: false };
    expect(evaluateQualification(twelfth, { qualification: "graduate", resultAwaited: true }).state).toBe("met");
  });

  it("asks the applicant to confirm required subjects", () => {
    expect(evaluateQualification({ ...graduate, subjects: ["Civil Engineering"] }, { qualification: "graduate" })).toMatchObject({ state: "unknown", reason: "check" });
  });

  it("does not assume ITI equals 12th", () => {
    expect(evaluateQualification({ ...graduate, min_level: "12th" }, { qualification: "iti" })).toMatchObject({ state: "unknown", reason: "rule" });
  });
});

describe("verdict", () => {
  const domicile: OtherRule = { kind: "other", label: "Domicile", stated: "Must be a domicile of the state", blocking: true, evidence: ev };
  const typing: OtherRule = { kind: "other", label: "Typing speed", stated: "35 wpm at skill test", blocking: false, evidence: ev };
  const post = (rules: (AgeRule | QualificationRule | OtherRule)[]) => ({ id: "p", name: "Post", rules });

  it("is likely eligible when everything matches", () => {
    expect(evaluatePost(post([age, graduate, typing]), { dob: "1997-03-10", category: "OBC", qualification: "graduate" }).verdict).toBe("likely_eligible");
  });

  it("is not eligible when any condition fails, even if others are unknown", () => {
    expect(evaluatePost(post([age, graduate, domicile]), { dob: "1990-01-01", category: "UR", qualification: "graduate" }).verdict).toBe("not_eligible");
  });

  it("is potentially eligible when only self-checks remain", () => {
    expect(evaluatePost(post([age, graduate, domicile]), { dob: "2001-01-01", category: "UR", qualification: "graduate" }).verdict).toBe("potentially_eligible");
  });

  it("cannot determine when the notice is vague or inputs are missing", () => {
    expect(evaluatePost(post([age, graduate]), { dob: "1990-01-01", category: "UR", exServiceman: true, qualification: "graduate" }).verdict).toBe("cannot_determine");
    expect(evaluatePost(post([age, graduate]), { category: "UR", qualification: "graduate" }).verdict).toBe("cannot_determine");
  });

  it("ranks not met above every unknown", () => {
    expect(verdictOf([
      { key: "a", label: "A", state: "unknown", reason: "rule", message: "", stated: "", evidence: [] },
      { key: "b", label: "B", state: "not_met", message: "", stated: "", evidence: [] },
    ])).toBe("not_eligible");
  });
});

import { matchSubject } from "./index";

describe("subjects", () => {
  it("matches the applicant's degree and subject against what the notice accepts", () => {
    expect(matchSubject(["Civil Engineering"], ["B.Tech", "Civil Engineering"])).not.toBeNull();
    expect(matchSubject(["B.E./B.Tech in Civil"], ["B.Tech", "Civil Engineering"])).not.toBeNull();
    expect(matchSubject(["Mathematics"], ["Science (Maths)"])).not.toBeNull();
    expect(matchSubject(["Civil Engineering"], ["B.Tech", "Mechanical Engineering"])).toBeNull();
    expect(matchSubject(["Biology"], ["Science (Maths)"])).toBeNull();
  });
});
