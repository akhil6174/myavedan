import { describe, expect, it } from "vitest";
import { verifyAccessJwt } from "./access";

const team = "example-team.cloudflareaccess.com";
const aud = "aud-tag-123";
const now = 1_800_000_000;

const b64url = (data: Uint8Array | string) =>
  btoa(typeof data === "string" ? data : String.fromCharCode(...data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function setup() {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  const fetcher = (async () => new Response(JSON.stringify({ keys: [{ kid: "k1", kty: "RSA", n: jwk.n, e: jwk.e }] }))) as unknown as typeof fetch;
  const sign = async (claims: Record<string, unknown>, kid = "k1", key = pair.privateKey) => {
    const h = b64url(JSON.stringify({ alg: "RS256", kid }));
    const p = b64url(JSON.stringify(claims));
    const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${h}.${p}`)));
    return `${h}.${p}.${b64url(sig)}`;
  };
  return { sign, fetcher };
}

const good = { aud: [aud], iss: `https://${team}`, exp: now + 600, email: "Reviewer@Example.org" };

describe("Cloudflare Access token check", async () => {
  const { sign, fetcher } = await setup();

  it("accepts a valid token and returns the email in lower case", async () => {
    expect(await verifyAccessJwt(await sign(good), team, aud, fetcher, now)).toBe("reviewer@example.org");
  });

  it("rejects the wrong audience, issuer or an expired token", async () => {
    expect(await verifyAccessJwt(await sign({ ...good, aud: ["other"] }), team, aud, fetcher, now)).toBeNull();
    expect(await verifyAccessJwt(await sign({ ...good, iss: "https://evil.example" }), team, aud, fetcher, now)).toBeNull();
    expect(await verifyAccessJwt(await sign({ ...good, exp: now - 1 }), team, aud, fetcher, now)).toBeNull();
  });

  it("rejects a token signed with a different key", async () => {
    const other = await setup();
    // Same kid, different private key: the signature must not verify against the published key.
    expect(await verifyAccessJwt(await other.sign(good), team, aud, fetcher, now)).toBeNull();
  });

  it("rejects a tampered payload and garbage", async () => {
    const token = await sign(good);
    const [h, , s] = token.split(".");
    const forged = `${h}.${b64url(JSON.stringify({ ...good, email: "attacker@example.org" }))}.${s}`;
    expect(await verifyAccessJwt(forged, team, aud, fetcher, now)).toBeNull();
    expect(await verifyAccessJwt("not-a-token", team, aud, fetcher, now)).toBeNull();
  });
});
