import { z } from "zod";
import { Snapshot } from "@myavedan/schema";
import type { Env } from "./env";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, istNow, sha256Hex, timingSafeEqual, verifySignature } from "./crypto";
import { corsHeaders, json, problem, readBody } from "./http";

// ------------------------------------------------------------------ health

export async function health(env: Env): Promise<Response> {
  try {
    await env.DB.prepare("SELECT 1").first();
    return json({ ok: true, db: true, time: istNow() });
  } catch {
    return json({ ok: false, db: false, time: istNow() }, 503);
  }
}

// ------------------------------------------------------------------ ingest (pipeline → D1)

export const IngestDraft = z.object({
  source_url: z.string().url(),
  document_url: z.string().url(),
  document_kind: z.enum(["notice", "corrigendum", "admit_card", "answer_key", "result", "cutoff", "other"]),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  r2_key: z.string().min(1).max(512),
  content_type: z.string().max(100).optional(),
  bytes: z.number().int().nonnegative().optional(),
  pages: z.number().int().positive().optional(),
  retrieved_at: z.string().min(10),
  advt_no: z.string().max(200).nullable().optional(),
  /** Extraction with value + evidence per field; checked field by field in review, not here. */
  draft: z.record(z.unknown()),
  flags: z
    .array(z.object({ field: z.string(), code: z.string(), severity: z.enum(["error", "warning"]), message: z.string() }))
    .default([]),
  chunks: z
    .array(z.object({ page: z.number().int().positive(), section: z.string().nullable().optional(), text: z.string().min(1).max(8000) }))
    .max(2000)
    .default([]),
});
export type IngestDraft = z.infer<typeof IngestDraft>;

const MAX_INGEST_BYTES = 5 * 1024 * 1024;

export async function ingest(request: Request, env: Env): Promise<Response> {
  if (!env.INGEST_HMAC_SECRET) return problem(503, "ingest is not configured");
  const raw = await readBody(request, MAX_INGEST_BYTES);
  if (raw === null) return problem(413, "body too large");

  const check = await verifySignature(env.INGEST_HMAC_SECRET, raw, request.headers.get(TIMESTAMP_HEADER), request.headers.get(SIGNATURE_HEADER));
  if (!check.ok) return problem(401, check.reason);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return problem(400, "body is not JSON");
  }
  const parsed = IngestDraft.safeParse(body);
  if (!parsed.success) return problem(422, "invalid draft", { issues: parsed.error.issues.slice(0, 20) });
  const d = parsed.data;

  // The source must be registered, and the document must sit on one of its organisation's official hosts.
  const source = await env.DB.prepare(
    "SELECT s.id, s.organization_id, o.domains_json FROM source s JOIN organization o ON o.id = s.organization_id WHERE s.url = ? AND s.active = 1",
  )
    .bind(d.source_url)
    .first<{ id: string; organization_id: string; domains_json: string }>();
  if (!source) return problem(422, "unknown or inactive source");
  const domains: string[] = JSON.parse(source.domains_json);
  const host = new URL(d.document_url).hostname.replace(/^www\./, "");
  if (!domains.some((dom) => host === dom || host.endsWith(`.${dom}`))) {
    return problem(422, `document host ${host} is not an official host for this source`);
  }

  const existing = await env.DB.prepare("SELECT id, state FROM document_version WHERE sha256 = ?").bind(d.sha256).first<{ id: string; state: string }>();
  if (existing) return json({ status: "duplicate", document_version_id: existing.id, state: existing.state });

  let doc = await env.DB.prepare("SELECT id FROM document WHERE url = ?").bind(d.document_url).first<{ id: string }>();
  const statements: D1PreparedStatement[] = [];
  const documentId = doc?.id ?? crypto.randomUUID();
  if (!doc) {
    statements.push(
      env.DB.prepare("INSERT INTO document (id, source_id, kind, url, advt_no) VALUES (?, ?, ?, ?, ?)").bind(
        documentId,
        source.id,
        d.document_kind,
        d.document_url,
        d.advt_no ?? null,
      ),
    );
  }
  const versionNo =
    ((await env.DB.prepare("SELECT MAX(version_no) AS n FROM document_version WHERE document_id = ?").bind(documentId).first<{ n: number | null }>())
      ?.n ?? 0) + 1;
  const versionId = crypto.randomUUID();
  const state = d.flags.some((f) => f.severity === "error") ? "validation_failed" : "needs_review";
  statements.push(
    env.DB.prepare(
      `INSERT INTO document_version (id, document_id, sha256, r2_key, content_type, bytes, pages, retrieved_at, state, draft_json, flags_json, version_no)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      versionId,
      documentId,
      d.sha256,
      d.r2_key,
      d.content_type ?? null,
      d.bytes ?? null,
      d.pages ?? null,
      d.retrieved_at,
      state,
      JSON.stringify(d.draft),
      JSON.stringify(d.flags),
      versionNo,
    ),
  );
  for (const c of d.chunks) {
    statements.push(
      env.DB.prepare("INSERT INTO chunk (document_version_id, page, section, text) VALUES (?, ?, ?, ?)").bind(versionId, c.page, c.section ?? null, c.text),
    );
  }
  // D1 batches run as one transaction.
  await env.DB.batch(statements);
  doc = { id: documentId };
  return json({ status: state, document_id: doc.id, document_version_id: versionId, version_no: versionNo }, 201);
}

// ------------------------------------------------------------------ corrections (public)

export const CorrectionInput = z.object({
  opportunity_slug: z.string().regex(/^[a-z0-9-]{3,120}$/),
  field_key: z.enum(["dates", "eligibility", "vacancies", "fees", "links", "other"]),
  message: z.string().trim().min(10).max(1000),
});

const CORRECTIONS_PER_HOUR = 5;

export async function correction(request: Request, env: Env): Promise<Response> {
  const cors = corsHeaders(request, env.ALLOWED_ORIGINS);
  const raw = await readBody(request, 8 * 1024);
  if (raw === null) return problem(413, "body too large", {}, cors);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return problem(400, "body is not JSON", {}, cors);
  }
  const parsed = CorrectionInput.safeParse(body);
  if (!parsed.success) return problem(422, "invalid report", { issues: parsed.error.issues.slice(0, 5) }, cors);

  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  const ipHash = await sha256Hex(`${env.IP_HASH_SALT ?? "dev-salt"}:${ip}`);
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM correction WHERE ip_hash = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')",
  )
    .bind(ipHash)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= CORRECTIONS_PER_HOUR) return problem(429, "too many reports, try again later", {}, cors);

  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO correction (id, opportunity_slug, field_key, message, ip_hash) VALUES (?, ?, ?, ?, ?)")
    .bind(id, parsed.data.opportunity_slug, parsed.data.field_key, parsed.data.message, ipHash)
    .run();
  return json({ status: "received", id }, 201, cors);
}

// ------------------------------------------------------------------ approved snapshot (publish workflow)

export async function snapshot(request: Request, env: Env): Promise<Response> {
  if (!env.PUBLISH_TOKEN) return problem(503, "snapshot export is not configured");
  const auth = request.headers.get("Authorization") ?? "";
  if (!timingSafeEqual(auth, `Bearer ${env.PUBLISH_TOKEN}`)) return problem(401, "unauthorised");

  const rows = await env.DB.prepare(
    "SELECT published_json FROM opportunity WHERE publish_state = 'published' AND published_json IS NOT NULL ORDER BY slug",
  ).all<{ published_json: string }>();
  const candidate = {
    generated_at: istNow(),
    sample: false,
    opportunities: rows.results.map((r) => JSON.parse(r.published_json)),
  };
  // Never hand the site a snapshot it would refuse to build.
  const result = Snapshot.safeParse(candidate);
  if (!result.success) return problem(500, "approved records do not form a valid snapshot", { issues: result.error.issues.slice(0, 20) });
  return json(result.data);
}
