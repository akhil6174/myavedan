/**
 * MyAvedan API Worker.
 *
 * Public and pipeline routes:
 *   GET  /api/health       database reachability
 *   POST /api/ingest       pipeline drafts → D1 (HMAC-signed; the only write path from the pipeline)
 *   POST /api/corrections  "Report an error" from the public site (CORS, rate-limited)
 *   GET  /api/snapshot     approved records for the site build (bearer token)
 *
 * Review console (admin host only, behind Cloudflare Access): /api/admin/* (see admin.ts),
 * plus the console's own files from apps/admin/dist.
 */
import type { Env } from "./env";
import { reviewerFor } from "./access";
import { bulkApprove, corrections, decision, fieldDecision, queue, updateCorrection, version } from "./admin";
import { corsHeaders, json, problem } from "./http";
import { correction, health, ingest, snapshot } from "./routes";

function isAdminHost(request: Request, env: Env): boolean {
  const host = new URL(request.url).hostname;
  return host === env.ADMIN_HOST || host === "localhost" || host === "127.0.0.1";
}

async function admin(request: Request, env: Env, path: string): Promise<Response> {
  if (!isAdminHost(request, env)) return problem(404, "not found");
  const reviewer = await reviewerFor(request, env);
  if (!reviewer) return problem(401, "sign in through Cloudflare Access to use the review console");
  const method = request.method;
  const url = new URL(request.url);

  if (path === "/api/admin/me" && method === "GET") return json({ email: reviewer.email });
  if (path === "/api/admin/queue" && method === "GET") return queue(env);
  if (path === "/api/admin/corrections" && method === "GET") return corrections(env, url.searchParams.get("status"));

  let m = path.match(/^\/api\/admin\/corrections\/([\w-]+)$/);
  if (m && method === "POST") return updateCorrection(request, env, m[1]!);

  m = path.match(/^\/api\/admin\/versions\/([\w-]+)(?:\/(fields|bulk|decision))?$/);
  if (m) {
    const [, id, sub] = m as unknown as [string, string, string | undefined];
    if (!sub && method === "GET") return version(env, id);
    if (sub === "fields" && method === "POST") return fieldDecision(request, env, id, reviewer);
    if (sub === "bulk" && method === "POST") return bulkApprove(request, env, id, reviewer);
    if (sub === "decision" && method === "POST") return decision(request, env, id, reviewer);
  }
  return problem(404, "not found");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const method = request.method;

    try {
      if (pathname.startsWith("/api/admin/")) return await admin(request, env, pathname);
      if (pathname === "/api/health" && method === "GET") return await health(env);
      if (pathname === "/api/ingest" && method === "POST") return await ingest(request, env);
      if (pathname === "/api/snapshot" && method === "GET") return await snapshot(request, env);
      if (pathname === "/api/corrections") {
        if (method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env.ALLOWED_ORIGINS) });
        if (method === "POST") return await correction(request, env);
      }
      if (pathname.startsWith("/api/")) return problem(404, "not found");

      // Anything else is the review console's own files, on the admin host only.
      if (env.ASSETS && isAdminHost(request, env)) return await env.ASSETS.fetch(request);
      return problem(404, "not found");
    } catch (err) {
      console.error(JSON.stringify({ route: pathname, error: (err as Error).message }));
      return problem(500, "internal error");
    }
  },

  /** Publish trigger. Next: batch the publish queue and dispatch the site build. */
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const waiting = await env.DB.prepare("SELECT COUNT(*) AS n FROM publish_queue WHERE batch_id IS NULL").first<{ n: number }>();
    console.log(JSON.stringify({ job: "publish-trigger", waiting: waiting?.n ?? 0 }));
  },
} satisfies ExportedHandler<Env>;
