import { describe, expect, it } from "vitest";
import { addDays, daysBetween, endInstant, formatDate, formatDateTime, istDate, shiftYears, startInstant } from "./dates";

describe("IST instants", () => {
  it("treats a date-only deadline as the end of that IST day", () => {
    expect(new Date(endInstant("2026-12-15")).toISOString()).toBe("2026-12-15T18:29:59.999Z");
  });
  it("treats a date-only start as 00:00 IST", () => {
    expect(new Date(startInstant("2026-11-16")).toISOString()).toBe("2026-11-15T18:30:00.000Z");
  });
  it("keeps a stated time", () => {
    expect(new Date(endInstant("2026-12-15T18:00:00+05:30")).toISOString()).toBe("2026-12-15T12:30:00.000Z");
  });
  it("gives the IST calendar date for an instant", () => {
    // 20:00 UTC on 14 Dec is 01:30 IST on 15 Dec.
    expect(istDate(Date.parse("2026-12-14T20:00:00Z"))).toBe("2026-12-15");
  });
});

describe("calendar arithmetic", () => {
  it("counts days between dates", () => {
    expect(daysBetween("2026-11-17", "2026-12-15")).toBe(28);
    expect(daysBetween("2026-12-15", "2026-12-15")).toBe(0);
    expect(daysBetween("2026-12-16", "2026-12-15")).toBe(-1);
  });
  it("adds days across months", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });
  it("shifts years and maps 29 Feb to 1 Mar in non-leap years", () => {
    expect(shiftYears("1999-01-02", -3)).toBe("1996-01-02");
    expect(shiftYears("2000-02-29", -3)).toBe("1997-03-01");
    expect(shiftYears("2000-02-29", -4)).toBe("1996-02-29");
  });
});

describe("formatting", () => {
  it("formats dates and times", () => {
    expect(formatDate("2026-12-15")).toBe("15 Dec 2026");
    expect(formatDateTime("2026-12-15T23:59:00+05:30")).toBe("15 Dec 2026, 23:59 IST");
    expect(formatDateTime("2026-12-15")).toBe("15 Dec 2026");
  });
});
