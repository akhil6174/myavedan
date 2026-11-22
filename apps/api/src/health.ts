/**
 * Health report and the "Unsure" list.
 *
 *   POST /api/ingest/run            reader's report after each run (HMAC-signed)
 *   POST /api/ingest/queued         links a reviewer asked the reader to read; marks them taken (HMAC-signed)
 *   GET  /api/admin/health          recent runs and the state of every official site
 *   GET  /api/admin/unsure          open unsure links
 *   POST /api/admin/unsure/:id      { action: read, kind } | { action: dismiss }
 */
import { z } from "zod";
import type { Env } from "./env";
import type { Reviewer } from "./access";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, istNow, verifySignature } from "./crypto";
import { json, problem, readBody } from "./http";

const READ_KINDS = ["notice", "corrigendum", "admit_card", "answer_key", "result", "cutoff"] as const;

async function signedJson(request: Request, env: Env, max: number): Promise<{ ok: true; body: unknown } | { ok: false; res: Response }> {
  if (!env.INGEST_HMAC_SECRET) return { ok: false, res: problem(503, "ingest is not configured") };
  const raw = await readBody(request, max);
  if (raw === null) return { ok: false, res: problem(413, "body too large") };
  const check = await verifySignature(env.INGEST_HMAC_SECRET, raw, request.headers.get(TIMESTAMP_HEADER), request.headers.get(SIGNATURE_HEADER));
  if (!check.ok) return { ok: false, res: problem(401, check.reason) };
  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, res: problem(400, "body is not JSON") };
  }
}

// ------------------------------------------------------------------ reader → API

const RunReport = z.object({
  started_at: z.string().min(10),
  finished_at: z.string().min(10),
  host: z.string().max(100).optional(),
  counts: z.record(z.number()).default({}),
  errors: z.array(z.string().max(400)).max(100).default([]),
  sources: z
    .array(
      z.object({
        source_url: z.string().url(),
        result: z.string().max(40),
        links: z.number().int().nonnegative().optional(),
        new: z.number().int().nonnegative().default(0),
        error: z.string().max(300).optional(),
      }),
    )
    .max(500),
  unsure: z
    .array(z.object({ source_url: z.string().url(), url: z.string().url(), link_text: z.string().max(400) }))
    .max(500)
    .default([]),
});

export async function receiveRun(request: Request, env: Env): Promise<Response> {
  const got = await signedJson(request, env, 1024 * 1024);
  if (!got.ok) return got.res;
  const parsed = RunReport.safeParse(got.body);
  if (!parsed.success) return problem(422, "invalid run report", { issues: parsed.error.issues.slice(0, 10) });
  const r = parsed.data;

  const sources = await env.DB.prepare("SELECT s.id, s.url, o.domains_json FROM source s JOIN organization o ON o.id = s.organization_id").all<{
    id: string;
    url: string;
    domains_json: string;
  }>();
  const byUrl = new Map(sources.results.map((s) => [s.url, s]));
  const runId = crypto.randomUUID();
  const now = istNow();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      "INSERT INTO pipeline_run (id, started_at, finished_at, trigger, counts_json, ai_calls, errors_json, host) VALUES (?, ?, ?, 'schedule', ?, ?, ?, ?)",
    ).bind(runId, r.started_at, r.finished_at, JSON.stringify(r.counts), r.counts.gemini_calls ?? 0, JSON.stringify(r.errors), r.host ?? null),
  ];
  for (const s of r.sources) {
    const src = byUrl.get(s.source_url);
    if (!src) continue;
    statements.push(
      env.DB.prepare(
        "INSERT INTO source_check (id, source_id, pipeline_run_id, checked_at, links_found, new_documents, error, result) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(crypto.randomUUID(), src.id, runId, r.finished_at, s.links ?? null, s.new, s.error ?? null, s.result),
    );
  }
  let unsure = 0;
  for (const u of r.unsure) {
    const src = byUrl.get(u.source_url);
    const host = new URL(u.url).hostname.replace(/^www\./, "");
    const domains: string[] = src ? JSON.parse(src.domains_json) : [];
    if (!src || !domains.some((d) => host === d || host.endsWith(`.${d}`))) continue; // official hosts only
    unsure++;
    statements.push(
      env.DB.prepare("INSERT INTO unsure_link (id, source_id, url, link_text, found_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(url) DO NOTHING").bind(
        crypto.randomUUID(),
        src.id,
        u.url,
        u.link_text || u.url,
        now,
      ),
    );
  }
  await env.DB.batch(statements);
  return json({ ok: true, run_id: runId, unsure });
}

export async function takeQueued(request: Request, env: Env): Promise<Response> {
  const got = await signedJson(request, env, 4096);
  if (!got.ok) return got.res;
  const rows = await env.DB.prepare(
    `SELECT u.id, u.url, u.link_text, u.kind, s.url AS source_url FROM unsure_link u JOIN source s ON s.id = u.source_id
      WHERE u.status = 'queued' ORDER BY u.decided_at LIMIT 50`,
  ).all<{ id: string; url: string; link_text: string; kind: string; source_url: string }>();
  if (rows.results.length) {
    await env.DB.batch(rows.results.map((r) => env.DB.prepare("UPDATE unsure_link SET status = 'taken' WHERE id = ? AND status = 'queued'").bind(r.id)));
  }
  return json({ items: rows.results });
}

// ------------------------------------------------------------------ console

export async function healthReport(env: Env): Promise<Response> {
  const runs = await env.DB.prepare(
    "SELECT id, started_at, finished_at, host, counts_json, errors_json FROM pipeline_run ORDER BY started_at DESC LIMIT 14",
  ).all<{ id: string; started_at: string; finished_at: string | null; host: string | null; counts_json: string; errors_json: string }>();
  const sites = await env.DB.prepare(
    `SELECT s.id, s.url, o.name AS organization,
            (SELECT result FROM source_check c WHERE c.source_id = s.id ORDER BY checked_at DESC LIMIT 1) AS last_result,
            (SELECT error FROM source_check c WHERE c.source_id = s.id ORDER BY checked_at DESC LIMIT 1) AS last_error,
            (SELECT checked_at FROM source_check c WHERE c.source_id = s.id ORDER BY checked_at DESC LIMIT 1) AS last_checked,
            (SELECT MAX(checked_at) FROM source_check c WHERE c.source_id = s.id AND c.result IN ('ok', 'unchanged')) AS last_ok,
            (SELECT MAX(checked_at) FROM source_check c WHERE c.source_id = s.id AND c.new_documents > 0) AS last_new,
            (SELECT links_found FROM source_check c WHERE c.source_id = s.id AND c.links_found IS NOT NULL ORDER BY checked_at DESC LIMIT 1) AS links
       FROM source s JOIN organization o ON o.id = s.organization_id
      WHERE s.active = 1
      ORDER BY o.name`,
  ).all();
  const unsure = await env.DB.prepare("SELECT COUNT(*) AS n FROM unsure_link WHERE status = 'open'").first<{ n: number }>();
  return json({
    runs: runs.results.map((r) => ({ ...r, counts: JSON.parse(r.counts_json), errors: JSON.parse(r.errors_json), counts_json: undefined, errors_json: undefined })),
    sites: sites.results,
    open_unsure: unsure?.n ?? 0,
  });
}

export async function listUnsure(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT u.id, u.url, u.link_text, u.found_at, o.name AS organization
       FROM unsure_link u LEFT JOIN source s ON s.id = u.source_id LEFT JOIN organization o ON o.id = s.organization_id
      WHERE u.status = 'open' ORDER BY u.found_at DESC, o.name LIMIT 500`,
  ).all();
  return json({ items: rows.results });
}

const UnsureDecision = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read"), kind: z.enum(READ_KINDS) }),
  z.object({ action: z.literal("dismiss") }),
]);

export async function decideUnsure(request: Request, env: Env, id: string, reviewer: Reviewer): Promise<Response> {
  const raw = await readBody(request, 4096);
  if (raw === null) return problem(413, "body too large");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return problem(400, "body is not JSON");
  }
  const parsed = UnsureDecision.safeParse(body);
  if (!parsed.success) return problem(422, "invalid decision");
  const d = parsed.data;
  const res = await env.DB.prepare("UPDATE unsure_link SET status = ?, kind = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'open'")
    .bind(d.action === "read" ? "queued" : "dismissed", d.action === "read" ? d.kind : null, reviewer.email, istNow(), id)
    .run();
  if (!res.meta.changes) return problem(404, "link not found or already handled");
  return json({ ok: true, status: d.action === "read" ? "queued" : "dismissed" });
}
