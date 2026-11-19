import { describe, expect, it } from "vitest";
import { computeStatus, describeStatus } from "./status";

const at = (iso: string) => Date.parse(iso);
const dates = [
  { kind: "notification" as const, value: "2026-11-10" },
  { kind: "apply_start" as const, value: "2026-11-16" },
  { kind: "apply_end" as const, value: "2026-12-15T23:59:00+05:30" },
];

describe("computeStatus", () => {
  it("is upcoming before applications open", () => {
    const s = computeStatus({ dates, events: [] }, at("2026-11-14T10:00:00+05:30"));
    expect(s.status).toBe("upcoming");
    expect(s.daysToOpen).toBe(2);
    expect(describeStatus(s)).toBe("Upcoming · opens in 2 days");
  });

  it("opens at 00:00 IST on the start date", () => {
    expect(computeStatus({ dates, events: [] }, at("2026-11-15T23:59:00+05:30")).status).toBe("upcoming");
    expect(computeStatus({ dates, events: [] }, at("2026-11-16T00:00:00+05:30")).status).toBe("open");
  });

  it("counts days left in IST and flags closing soon", () => {
    const s = computeStatus({ dates, events: [] }, at("2026-11-17T09:00:00+05:30"));
    expect(s).toMatchObject({ status: "open", daysLeft: 28, closingSoon: false });
    expect(describeStatus(s)).toBe("Open · closes in 28 days");
    expect(computeStatus({ dates, events: [] }, at("2026-12-08T09:00:00+05:30")).closingSoon).toBe(true);
  });

  it("says closes today with the stated time", () => {
    const s = computeStatus({ dates, events: [] }, at("2026-12-15T22:00:00+05:30"));
    expect(describeStatus(s)).toBe("Open · closes today, 23:59 IST");
  });

  it("closes exactly after the stated time", () => {
    expect(computeStatus({ dates, events: [] }, at("2026-12-15T23:59:00+05:30")).status).toBe("open");
    expect(computeStatus({ dates, events: [] }, at("2026-12-15T23:59:01+05:30")).status).toBe("closed");
  });

  it("uses later documents once they exist", () => {
    const events = [
      { kind: "admit_card" as const, date: "2027-01-20" },
      { kind: "answer_key" as const, date: "2027-02-20" },
    ];
    expect(computeStatus({ dates, events }, at("2027-02-21T09:00:00+05:30")).status).toBe("answer_key_out");
  });

  it("archives 90 days after the result", () => {
    const events = [{ kind: "result" as const, date: "2027-03-01" }];
    expect(computeStatus({ dates, events }, at("2027-05-30T09:00:00+05:30")).status).toBe("result_out");
    expect(computeStatus({ dates, events }, at("2027-05-31T09:00:00+05:30")).status).toBe("archived");
  });

  it("treats cancellation as final", () => {
    const events = [
      { kind: "result" as const, date: "2027-03-01" },
      { kind: "cancelled" as const, date: "2027-03-05" },
    ];
    expect(computeStatus({ dates, events }, at("2027-03-06T09:00:00+05:30")).status).toBe("cancelled");
  });
});
