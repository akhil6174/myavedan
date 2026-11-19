import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Opportunity, Snapshot } from "./types";
import { computeStatus } from "./status";

const raw = JSON.parse(readFileSync(new URL("../../../data/snapshot.json", import.meta.url), "utf8"));

describe("sample snapshot", () => {
  it("validates against the schema", () => {
    const result = Snapshot.safeParse(raw);
    if (!result.success) console.error(result.error.issues);
    expect(result.success).toBe(true);
  });

  it("covers every status the site shows on 17 Nov 2026", () => {
    const snap = Snapshot.parse(raw);
    const now = Date.parse("2026-11-17T10:00:00+05:30");
    const statuses = snap.opportunities.map((o) => computeStatus(o, now).status).sort();
    expect(statuses).toEqual(["admit_card_out", "open", "open", "result_out", "upcoming"]);
  });
});

describe("validation rules", () => {
  const base = () => structuredClone(raw.opportunities[0]);

  it("rejects a critical date without evidence", () => {
    const o = base();
    o.dates.find((d: { kind: string }) => d.kind === "apply_end").evidence = null;
    expect(Opportunity.safeParse(o).success).toBe(false);
  });

  it("rejects vacancies that do not add up", () => {
    const o = base();
    o.total_vacancies = 1000;
    expect(Opportunity.safeParse(o).success).toBe(false);
  });

  it("rejects an application link off the official host", () => {
    const o = base();
    o.links.apply = "https://apply-example-org.com/";
    expect(Opportunity.safeParse(o).success).toBe(false);
  });

  it("rejects an application window in the wrong order", () => {
    const o = base();
    o.dates.find((d: { kind: string }) => d.kind === "apply_start").value = "2026-12-20";
    expect(Opportunity.safeParse(o).success).toBe(false);
  });
});
