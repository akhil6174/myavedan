/**
 * Who is calling an admin route.
 *
 * In staging and production the admin host sits behind Cloudflare Access, which signs in the
 * reviewer and adds a signed JWT (Cf-Access-Jwt-Assertion) to every request. We verify that
 * token ourselves: issuer, audience, expiry and RS256 signature against Access's public keys.
 * Locally, ADMIN_DEV_EMAIL allows access from localhost only.
 */
import type { Env } from "./env";

export interface Reviewer {
  email: string;
}

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

let keyCache: { team: string; at: number; keys: Jwk[] } | null = null;
const KEY_TTL_MS = 60 * 60 * 1000;

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodePart<T>(part: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part))) as T;
}

async function accessKeys(team: string, fetcher: typeof fetch): Promise<Jwk[]> {
  if (keyCache && keyCache.team === team && Date.now() - keyCache.at < KEY_TTL_MS) return keyCache.keys;
  const res = await fetcher(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`could not load Access keys (${res.status})`);
  const body = (await res.json()) as { keys: Jwk[] };
  keyCache = { team, at: Date.now(), keys: body.keys };
  return body.keys;
}

interface Claims {
  aud: string | string[];
  iss: string;
  exp: number;
  nbf?: number;
  email?: string;
}

/** Verify a Cloudflare Access JWT. Returns the email, or null if anything is wrong. */
export async function verifyAccessJwt(
  token: string,
  team: string,
  audience: string,
  fetcher: typeof fetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  let header: { kid?: string; alg?: string };
  let claims: Claims;
  try {
    header = decodePart(h);
    claims = decodePart(p);
  } catch {
    return null;
  }
  if (header.alg !== "RS256" || !header.kid) return null;
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(audience)) return null;
  if (claims.iss !== `https://${team}`) return null;
  if (typeof claims.exp !== "number" || claims.exp < nowSeconds) return null;
  if (typeof claims.nbf === "number" && claims.nbf > nowSeconds + 60) return null;

  const jwk = (await accessKeys(team, fetcher)).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
  return ok && claims.email ? claims.email.toLowerCase() : null;
}

function isLocal(request: Request): boolean {
  const host = new URL(request.url).hostname;
  return host === "localhost" || host === "127.0.0.1";
}

export async function reviewerFor(request: Request, env: Env): Promise<Reviewer | null> {
  let email: string | null = null;
  if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    const token = request.headers.get("Cf-Access-Jwt-Assertion");
    if (token) email = await verifyAccessJwt(token, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);
  } else if (env.ADMIN_DEV_EMAIL && isLocal(request)) {
    email = env.ADMIN_DEV_EMAIL.toLowerCase();
  }
  if (!email) return null;
  // Optional second gate: an explicit list of reviewer emails.
  const allowed = (env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes(email)) return null;
  return { email };
}
