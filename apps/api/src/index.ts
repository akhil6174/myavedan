/**
 * MyAvedan API Worker.
 *
 * Public and pipeline routes:
 *   GET  /api/health       database reachability
 *   POST /api/ingest       pipeline drafts → D1 (HMAC-signed; the only write path from the pipeline)
 *   POST /api/corrections  "Report an error" from the public site (CORS, rate-limited)
 *   GET  /api/snapshot     approved records for the site build (bearer token)
 *   POST /api/publish/complete  the Publish workflow reports a finished deploy (bearer token)
 *
 * Review console (admin host only):
 *   /api/auth/*            Better Auth: Google sign-in, sessions, sign-out
 *   /api/admin/*           review routes for signed-in reviewers (see admin.ts)
 *   everything else        the console's own files from apps/admin/dist
 */
import type { Env } from "./env";
import { reviewerFor } from "./access";
import { auth, isAuthConfigured, isDevLogin, isGoogleConfigured } from "./auth";
import { bulkApprove, corrections, decision, fieldDecision, queue, setRole, updateCorrection, users, version } from "./admin";
import { corsHeaders, json, problem } from "./http";
import { correction, health, ingest, snapshot } from "./routes";
import { publishComplete, publishStatus, runPublishTrigger } from "./publish";

function isAdminHost(request: Request, env: Env): boolean {
  const host = new URL(request.url).hostname;
  return host === env.ADMIN_HOST || host === "localhost" || host === "127.0.0.1";
}

async function admin(request: Request, env: Env, ctx: ExecutionContext, path: string): Promise<Response> {
  const method = request.method;
  const url = new URL(request.url);

  // Public to the console: how sign-in works here.
  if (path === "/api/admin/sign-in-options" && method === "GET") {
    return json({ configured: isAuthConfigured(env), google: isGoogleConfigured(env), dev: isDevLogin(env) });
  }

  const check = await reviewerFor(request, env);
  if (!check.ok) return problem(check.status, check.message, { signed_in: check.status === 403 });
  const reviewer = check.reviewer;

  if (path === "/api/admin/me" && method === "GET") return json({ email: reviewer.email, role: reviewer.role });
  if (path === "/api/admin/queue" && method === "GET") return queue(env);
  if (path === "/api/admin/corrections" && method === "GET") return corrections(env, url.searchParams.get("status"));

  let m = path.match(/^\/api\/admin\/corrections\/([\w-]+)$/);
  if (m && method === "POST") return updateCorrection(request, env, m[1]!);

  if (path === "/api/admin/users" || path.startsWith("/api/admin/users/")) {
    if (reviewer.role !== "admin") return problem(403, "only admins manage reviewers");
    if (path === "/api/admin/users" && method === "GET") return users(env);
    m = path.match(/^\/api\/admin\/users\/([\w-]+)\/role$/);
    if (m && method === "POST") return setRole(request, env, m[1]!, reviewer);
  }

  if (path === "/api/admin/publish" && method === "GET") return publishStatus(env);
  if (path === "/api/admin/publish" && method === "POST") return json(await runPublishTrigger(env, { force: true }));

  m = path.match(/^\/api\/admin\/versions\/([\w-]+)(?:\/(fields|bulk|decision))?$/);
  if (m) {
    const [, id, sub] = m as unknown as [string, string, string | undefined];
    if (!sub && method === "GET") return version(env, id);
    if (sub === "fields" && method === "POST") return fieldDecision(request, env, id, reviewer);
    if (sub === "bulk" && method === "POST") return bulkApprove(request, env, id, reviewer);
    if (sub === "decision" && method === "POST") {
      // An urgent approval publishes now instead of waiting for the next cron run.
      return decision(request, env, id, reviewer, (urgent) => {
        if (urgent) ctx.waitUntil(runPublishTrigger(env).then((r) => console.log(JSON.stringify({ job: "urgent-publish", ...r }))));
      });
    }
  }
  return problem(404, "not found");
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    const method = request.method;

    try {
      if (pathname.startsWith("/api/auth/")) {
        if (!isAdminHost(request, env)) return problem(404, "not found");
        if (!isAuthConfigured(env)) return problem(503, "sign-in is not configured");
        return await auth(env).handler(request);
      }
      if (pathname.startsWith("/api/admin/")) {
        if (!isAdminHost(request, env)) return problem(404, "not found");
        return await admin(request, env, ctx, pathname);
      }
      if (pathname === "/api/health" && method === "GET") return await health(env);
      if (pathname === "/api/ingest" && method === "POST") return await ingest(request, env);
      if (pathname === "/api/snapshot" && method === "GET") return await snapshot(request, env);
      if (pathname === "/api/publish/complete" && method === "POST") return await publishComplete(request, env);
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

  /** Every 30 minutes: dispatch a site rebuild if approved notices are waiting. */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runPublishTrigger(env).then((r) => console.log(JSON.stringify({ job: "publish-trigger", ...r }))));
  },
} satisfies ExportedHandler<Env>;
