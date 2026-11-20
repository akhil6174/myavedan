/**
 * Who is calling an admin route.
 *
 * Reviewers sign in with Google (Better Auth, see auth.ts) and need the reviewer or admin role.
 * Optionally, Cloudflare Access can also sit in front of the admin host; when ACCESS_TEAM_DOMAIN and
 * ACCESS_AUD are set, its signed JWT (Cf-Access-Jwt-Assertion) is verified here as well.
 */
import type { Env } from "./env";
import { currentUser, hasRole, type Role } from "./auth";

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

export type ReviewerCheck =
  | { ok: true; reviewer: Reviewer & { role: Role } }
  | { ok: false; status: 401 | 403; message: string };

/**
 * Who may use the review console. Default: Google sign-in with the reviewer or admin role (as on TrutiAI).
 * If Cloudflare Access is ever put in front, its token must also be valid.
 */
export async function reviewerFor(request: Request, env: Env): Promise<ReviewerCheck> {
  if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    const token = request.headers.get("Cf-Access-Jwt-Assertion");
    const email = token ? await verifyAccessJwt(token, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD) : null;
    if (!email) return { ok: false, status: 401, message: "Cloudflare Access sign-in required" };
  }
  const user = await currentUser(request, env);
  if (!user) return { ok: false, status: 401, message: "sign in to use the review console" };
  if (!hasRole(user, "reviewer")) {
    return { ok: false, status: 403, message: `${user.email} is not a reviewer yet. Ask an admin to give you the reviewer role.` };
  }
  return { ok: true, reviewer: { email: user.email, role: user.role } };
}
