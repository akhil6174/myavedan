import { describe, expect, it } from "vitest";
import { shouldDispatch } from "./publish";

const now = Date.parse("2026-11-20T10:00:00Z");
const base = { waiting: 2, urgent: false, lastDispatchMs: now - 10 * 60_000, nowMs: now, minIntervalMinutes: 30 };

describe("shouldDispatch", () => {
  it("does nothing when the queue is empty, even if urgent", () => {
    expect(shouldDispatch({ ...base, waiting: 0, urgent: true })).toBe(false);
  });
  it("dispatches the very first batch at once", () => {
    expect(shouldDispatch({ ...base, lastDispatchMs: null })).toBe(true);
  });
  it("waits for the minimum interval for regular approvals", () => {
    expect(shouldDispatch(base)).toBe(false);
    expect(shouldDispatch({ ...base, lastDispatchMs: now - 30 * 60_000 })).toBe(true);
  });
  it("lets urgent approvals skip the wait", () => {
    expect(shouldDispatch({ ...base, urgent: true })).toBe(true);
  });
});
