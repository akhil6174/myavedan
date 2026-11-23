/**
 * The signed-in visitor's own data on myavedan.in (cookie session from siteAuth):
 *
 *   GET /api/me                 { user, profile, applied, saved } or { user: null }
 *   PUT /api/me                 { profile?, applied?, saved? }  (each replaces the stored value)
 *   DELETE /api/me              forget everything stored for this visitor (keeps the sign-in)
 *
 * Only the visitor's own row is ever read or written. Called from the site with credentials, so
 * every response carries CORS headers for the site's origins.
 */
import { z } from "zod";
import type { Env } from "./env";
import { siteAuth } from "./auth";
import { json, problem, readBody } from "./http";

export function siteCors(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin");
  const list = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!origin || !list.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function withCors(res: Response, request: Request, env: Env): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(siteCors(request, env))) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

const Education = z
  .object({
    class12_stream: z.string().max(40).nullable().optional(),
    diploma: z.string().max(80).nullable().optional(),
    iti_trade: z.string().max(80).nullable().optional(),
    bachelor: z.string().max(40).nullable().optional(),
    bachelor_subject: z.string().max(80).nullable().optional(),
    master: z.string().max(40).nullable().optional(),
    master_subject: z.string().max(80).nullable().optional(),
    phd_subject: z.string().max(80).nullable().optional(),
  })
  .partial();

const Profile = z.object({
  dob: z.string().max(10),
  qualification: z.string().max(20).nullable(),
  category: z.string().max(10).nullable(),
  pwbd: z.boolean(),
  exServiceman: z.boolean(),
  resultAwaited: z.boolean(),
  state: z.string().max(60),
  education: Education.optional(),
});
const Update = z.object({
  profile: Profile.nullable().optional(),
  applied: z.record(z.object({ at: z.string().max(10), seen: z.array(z.string().max(600)).max(200) })).optional(),
  saved: z.array(z.string().max(200)).max(1000).optional(),
});

async function user(request: Request, env: Env) {
  const session = await siteAuth(env).api.getSession({ headers: request.headers });
  return session?.user ?? null;
}

export async function me(request: Request, env: Env): Promise<Response> {
  const u = await user(request, env);
  if (request.method === "GET") {
    if (!u) return json({ user: null });
    const row = await env.DB.prepare("SELECT profile_json, applied_json, saved_json FROM visitor_profile WHERE user_id = ?")
      .bind(u.id)
      .first<{ profile_json: string; applied_json: string; saved_json: string }>();
    const profile = row ? JSON.parse(row.profile_json) : null;
    return json({
      user: { name: u.name, email: u.email, image: u.image ?? null },
      profile: profile && Object.keys(profile).length ? profile : null,
      applied: row ? JSON.parse(row.applied_json) : {},
      saved: row ? JSON.parse(row.saved_json) : [],
    });
  }
  if (!u) return problem(401, "sign in first");
  if (request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM visitor_profile WHERE user_id = ?").bind(u.id).run();
    return json({ ok: true });
  }
  if (request.method !== "PUT") return problem(405, "method not allowed");
  const raw = await readBody(request, 256 * 1024);
  if (raw === null) return problem(413, "body too large");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return problem(400, "body is not JSON");
  }
  const parsed = Update.safeParse(body);
  if (!parsed.success) return problem(422, "invalid data", { issues: parsed.error.issues.slice(0, 5) });
  const d = parsed.data;
  await env.DB.prepare(
    `INSERT INTO visitor_profile (user_id, profile_json, applied_json, saved_json) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       profile_json = CASE WHEN ?5 THEN excluded.profile_json ELSE profile_json END,
       applied_json = CASE WHEN ?6 THEN excluded.applied_json ELSE applied_json END,
       saved_json   = CASE WHEN ?7 THEN excluded.saved_json ELSE saved_json END,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  )
    .bind(
      u.id,
      JSON.stringify(d.profile ?? {}),
      JSON.stringify(d.applied ?? {}),
      JSON.stringify(d.saved ?? []),
      d.profile !== undefined ? 1 : 0,
      d.applied !== undefined ? 1 : 0,
      d.saved !== undefined ? 1 : 0,
    )
    .run();
  return json({ ok: true });
}
