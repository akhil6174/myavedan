/**
 * MyAvedan API Worker.
 *
 *   GET  /api/health       database reachability
 *   POST /api/ingest       pipeline drafts → D1 (HMAC-signed; the only write path from the pipeline)
 *   POST /api/corrections  "Report an error" from the public site (CORS, rate-limited)
 *   GET  /api/snapshot     approved records for the site build (bearer token)
 *
 * Coming next: admin review routes behind Cloudflare Access (M4), saved items and Q&A (M7).
 */
import type { Env } from "./env";
import { corsHeaders, problem } from "./http";
import { correction, health, ingest, snapshot } from "./routes";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const method = request.method;

    try {
      if (pathname === "/api/health" && method === "GET") return await health(env);
      if (pathname === "/api/ingest" && method === "POST") return await ingest(request, env);
      if (pathname === "/api/snapshot" && method === "GET") return await snapshot(request, env);
      if (pathname === "/api/corrections") {
        if (method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env.ALLOWED_ORIGINS) });
        if (method === "POST") return await correction(request, env);
      }
      return problem(404, "not found");
    } catch (err) {
      console.error(JSON.stringify({ route: pathname, error: (err as Error).message }));
      return problem(500, "internal error");
    }
  },

  /** Publish trigger. M4: batch the publish queue and dispatch the site build. */
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const waiting = await env.DB.prepare("SELECT COUNT(*) AS n FROM publish_queue WHERE batch_id IS NULL").first<{ n: number }>();
    console.log(JSON.stringify({ job: "publish-trigger", waiting: waiting?.n ?? 0 }));
  },
} satisfies ExportedHandler<Env>;
