/** Small WebCrypto helpers shared by the Worker and the pipeline contract tests. */

const enc = new TextEncoder();

export function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

/** Compare two strings without leaking where they differ. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const SIGNATURE_HEADER = "X-MyAvedan-Signature";
export const TIMESTAMP_HEADER = "X-MyAvedan-Timestamp";
export const MAX_SKEW_SECONDS = 300;

/**
 * Verify a pipeline request. The pipeline signs `${timestamp}.${rawBody}` with HMAC-SHA256
 * and sends the hex digest; requests older than five minutes are refused to stop replays.
 */
export async function verifySignature(
  secret: string,
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!timestamp || !signature) return { ok: false, reason: "missing signature headers" };
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || Math.abs(nowSeconds - ts) > MAX_SKEW_SECONDS) return { ok: false, reason: "stale or invalid timestamp" };
  const expected = await hmacHex(secret, `${timestamp}.${rawBody}`);
  return timingSafeEqual(expected, signature.toLowerCase()) ? { ok: true } : { ok: false, reason: "bad signature" };
}

/** Current time as an IST date-time string, the format the snapshot uses. */
export function istNow(ms = Date.now()): string {
  return new Date(ms + 330 * 60_000).toISOString().slice(0, 19) + "+05:30";
}
