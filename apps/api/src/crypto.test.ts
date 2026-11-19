import { describe, expect, it } from "vitest";
import { hmacHex, istNow, verifySignature } from "./crypto";

describe("pipeline request signatures", () => {
  const secret = "test-secret";
  const body = JSON.stringify({ hello: "world" });
  const now = 1_800_000_000;

  it("accepts a fresh, correct signature", async () => {
    const sig = await hmacHex(secret, `${now}.${body}`);
    expect(await verifySignature(secret, body, String(now), sig, now + 10)).toEqual({ ok: true });
  });

  it("rejects a tampered body", async () => {
    const sig = await hmacHex(secret, `${now}.${body}`);
    expect((await verifySignature(secret, body + " ", String(now), sig, now)).ok).toBe(false);
  });

  it("rejects a replay older than five minutes", async () => {
    const sig = await hmacHex(secret, `${now}.${body}`);
    expect((await verifySignature(secret, body, String(now), sig, now + 301)).ok).toBe(false);
  });

  it("rejects missing headers", async () => {
    expect((await verifySignature(secret, body, null, null, now)).ok).toBe(false);
  });

  it("matches the known HMAC-SHA256 test vector", async () => {
    // RFC 4231 test case 2
    expect(await hmacHex("Jefe", "what do ya want for nothing?")).toBe("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  });
});

describe("istNow", () => {
  it("formats an instant as IST", () => {
    expect(istNow(Date.parse("2026-11-17T00:30:00Z"))).toBe("2026-11-17T06:00:00+05:30");
  });
});
