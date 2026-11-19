/**
 * Review console API. Every route here requires a verified reviewer (see access.ts).
 *
 *   GET  /api/admin/me
 *   GET  /api/admin/queue
 *   GET  /api/admin/versions/:id
 *   POST /api/admin/versions/:id/fields     { key, action: approve|edit|reject, value?, reason? }
 *   POST /api/admin/versions/:id/bulk       { keys }            approve several non-critical fields
 *   POST /api/admin/versions/:id/decision   { action: approve|reject|reprocess, reason?, urgent? }
 *   GET  /api/admin/corrections
 *   POST /api/admin/corrections/:id         { status }
 */
import { z } from "zod";
import type { Env } from "./env";
import type { Reviewer } from "./access";
import { istNow } from "./crypto";
import { json, problem, readBody } from "./http";
import {
  approvalCheck,
  buildRecord,
  fieldStates,
  priority,
  reviewFields,
  stateOf,
  type FieldDecision,
  type Flag,
} from "./review";

const REVIEWABLE = ["needs_review", "validation_failed"];

interface VersionRow {
  id: string;
  document_id: string;
  sha256: string;
  r2_key: string;
  pages: number | null;
  retrieved_at: string;
  state: string;
  draft_json: string | null;
  flags_json: string;
  version_no: number;
  change_note: string | null;
  created_at: string;
  doc_url: string;
  doc_kind: string;
  opportunity_id: string | null;
  source_id: string | null;
  organization_id: string | null;
  tier: number | null;
}

async function loadVersion(env: Env, id: string): Promise<VersionRow | null> {
  return env.DB.prepare(
    `SELECT v.*, d.url AS doc_url, d.kind AS doc_kind, d.opportunity_id, d.source_id, s.organization_id, s.tier
       FROM document_version v
       JOIN document d ON d.id = v.document_id
       LEFT JOIN source s ON s.id = d.source_id
      WHERE v.id = ?`,
  )
    .bind(id)
    .first<VersionRow>();
}

async function loadDecisions(env: Env, versionId: string): Promise<FieldDecision[]> {
  const rows = await env.DB.prepare(
    `SELECT field_key, action, new_value, reviewer, reason, created_at FROM review_event
      WHERE document_version_id = ? AND field_key IS NOT NULL AND action IN ('approve_field','edit_field','reject_field')`,
  )
    .bind(versionId)
    .all<{ field_key: string; action: string; new_value: string | null; reviewer: string; reason: string | null; created_at: string }>();
  return rows.results.map((r) => ({
    key: r.field_key,
    state: r.action === "approve_field" ? "approved" : r.action === "edit_field" ? "edited" : "rejected",
    value: r.new_value ? JSON.parse(r.new_value) : undefined,
    reviewer: r.reviewer,
    reason: r.reason,
    at: r.created_at,
  }));
}

function parseDraft(row: VersionRow): Record<string, any> {
  return row.draft_json ? JSON.parse(row.draft_json) : {};
}

async function body<T>(request: Request, schema: z.ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; res: Response }> {
  const raw = await readBody(request, 256 * 1024);
  if (raw === null) return { ok: false, res: problem(413, "body too large") };
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success) return { ok: false, res: problem(422, "invalid request", { issues: parsed.error.issues.slice(0, 10) }) };
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, res: problem(400, "body is not JSON") };
  }
}

// ------------------------------------------------------------------ queue

export async function queue(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT v.id, v.state, v.version_no, v.created_at, v.flags_json, v.draft_json, d.kind AS doc_kind, d.url AS doc_url,
            d.opportunity_id, s.tier, o.name AS org_name
       FROM document_version v
       JOIN document d ON d.id = v.document_id
       LEFT JOIN source s ON s.id = d.source_id
       LEFT JOIN organization o ON o.id = s.organization_id
      WHERE v.state IN ('needs_review', 'validation_failed')`,
  ).all<Record<string, any>>();

  const today = istNow().slice(0, 10);
  const items = rows.results.map((r) => {
    const draft = r.draft_json ? JSON.parse(r.draft_json) : {};
    const flags: Flag[] = JSON.parse(r.flags_json ?? "[]");
    const applyEnd = (draft.dates ?? []).find((d: any) => d.kind === "apply_end" && d.value)?.value ?? null;
    return {
      id: r.id,
      state: r.state,
      title: draft.title ?? "(untitled draft)",
      organization: r.org_name ?? draft.organization?.name ?? null,
      document_kind: r.doc_kind,
      document_url: r.doc_url,
      update: Boolean(r.opportunity_id) || r.version_no > 1,
      apply_end: applyEnd,
      errors: flags.filter((f) => f.severity === "error").length,
      warnings: flags.filter((f) => f.severity === "warning").length,
      received_at: r.created_at,
      priority: priority(applyEnd, r.tier ?? 2, today) - (r.opportunity_id ? 2 : 0),
    };
  });
  items.sort((a, b) => a.priority - b.priority || a.received_at.localeCompare(b.received_at));

  const corrections = await env.DB.prepare("SELECT COUNT(*) AS n FROM correction WHERE status = 'open'").first<{ n: number }>();
  return json({ items, open_corrections: corrections?.n ?? 0 });
}

// ------------------------------------------------------------------ one version

export async function version(env: Env, id: string): Promise<Response> {
  const row = await loadVersion(env, id);
  if (!row) return problem(404, "version not found");
  const draft = parseDraft(row);
  const flags: Flag[] = JSON.parse(row.flags_json ?? "[]");
  const fields = reviewFields(draft, flags);
  const decisions = await loadDecisions(env, id);
  const states = fieldStates(decisions);

  const chunks = await env.DB.prepare("SELECT page, section, text FROM chunk WHERE document_version_id = ? ORDER BY page, id")
    .bind(id)
    .all<{ page: number; section: string | null; text: string }>();
  const pages: Record<number, string> = {};
  for (const c of chunks.results) pages[c.page] = pages[c.page] ? `${pages[c.page]}\n\n${c.text}` : c.text;

  // For updates: the record currently live, so the console can show what changed.
  let previous: unknown = null;
  const slug = typeof draft.slug === "string" ? draft.slug : null;
  type Live = { published_json: string | null; current_version_id: string | null };
  const live = row.opportunity_id
    ? await env.DB.prepare("SELECT published_json, current_version_id FROM opportunity WHERE id = ?").bind(row.opportunity_id).first<Live>()
    : slug
      ? await env.DB.prepare("SELECT published_json, current_version_id FROM opportunity WHERE slug = ?").bind(slug).first<Live>()
      : null;
  // Compare with what is live, unless what is live is this very version.
  if (live?.published_json && live.current_version_id !== id) previous = JSON.parse(live.published_json);

  const history = await env.DB.prepare(
    "SELECT action, field_key, reviewer, reason, created_at FROM review_event WHERE document_version_id = ? ORDER BY created_at DESC LIMIT 50",
  )
    .bind(id)
    .all();

  return json({
    version: {
      id: row.id,
      state: row.state,
      version_no: row.version_no,
      sha256: row.sha256,
      retrieved_at: row.retrieved_at,
      pages: row.pages,
      document_url: row.doc_url,
      document_kind: row.doc_kind,
      reviewable: REVIEWABLE.includes(row.state),
    },
    flags,
    fields: fields.map((f) => ({ ...f, state: stateOf(f.key, states), decision: states.get(f.key) ?? null })),
    approval: approvalCheck(fields, states),
    pages,
    previous,
    history: history.results,
  });
}

// ------------------------------------------------------------------ field decisions

const FieldAction = z.object({
  key: z.string().min(1).max(200),
  action: z.enum(["approve", "edit", "reject"]),
  value: z.unknown().optional(),
  reason: z.string().max(1000).optional(),
});

export async function fieldDecision(request: Request, env: Env, id: string, reviewer: Reviewer): Promise<Response> {
  const parsed = await body(request, FieldAction);
  if (!parsed.ok) return parsed.res;
  const { key, action, value, reason } = parsed.data;

  const row = await loadVersion(env, id);
  if (!row) return problem(404, "version not found");
  if (!REVIEWABLE.includes(row.state)) return problem(409, `version is ${row.state}, not open for review`);
  const field = reviewFields(parseDraft(row)).find((f) => f.key === key);
  if (!field) return problem(422, `no field ${key} in this draft`);
  if (action === "edit" && value === undefined) return problem(422, "an edit needs a value");
  if (action === "reject" && !reason) return problem(422, "say why the field is rejected");

  const actionName = action === "approve" ? "approve_field" : action === "edit" ? "edit_field" : "reject_field";
  await env.DB.prepare(
    "INSERT INTO review_event (id, document_version_id, reviewer, action, field_key, old_value, new_value, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      id,
      reviewer.email,
      actionName,
      key,
      JSON.stringify(field.value ?? null),
      action === "edit" ? JSON.stringify(value) : null,
      reason ?? null,
    )
    .run();
  return json({ ok: true, key, state: action === "approve" ? "approved" : action === "edit" ? "edited" : "rejected" });
}

const Bulk = z.object({ keys: z.array(z.string().min(1).max(200)).min(1).max(200) });

export async function bulkApprove(request: Request, env: Env, id: string, reviewer: Reviewer): Promise<Response> {
  const parsed = await body(request, Bulk);
  if (!parsed.ok) return parsed.res;
  const row = await loadVersion(env, id);
  if (!row) return problem(404, "version not found");
  if (!REVIEWABLE.includes(row.state)) return problem(409, `version is ${row.state}, not open for review`);
  const fields = new Map(reviewFields(parseDraft(row)).map((f) => [f.key, f]));
  const critical = parsed.data.keys.filter((k) => fields.get(k)?.critical);
  if (critical.length) return problem(422, "critical fields must be approved one at a time", { keys: critical });
  const unknown = parsed.data.keys.filter((k) => !fields.has(k));
  if (unknown.length) return problem(422, "unknown fields", { keys: unknown });

  await env.DB.batch(
    parsed.data.keys.map((key) =>
      env.DB.prepare(
        "INSERT INTO review_event (id, document_version_id, reviewer, action, field_key, old_value) VALUES (?, ?, ?, 'approve_field', ?, ?)",
      ).bind(crypto.randomUUID(), id, reviewer.email, key, JSON.stringify(fields.get(key)?.value ?? null)),
    ),
  );
  return json({ ok: true, approved: parsed.data.keys.length });
}

// ------------------------------------------------------------------ version decision

const Decision = z.object({
  action: z.enum(["approve", "reject", "reprocess"]),
  reason: z.string().max(1000).optional(),
  urgent: z.boolean().optional(),
  change_note: z.string().max(300).optional(),
});

export async function decision(request: Request, env: Env, id: string, reviewer: Reviewer): Promise<Response> {
  const parsed = await body(request, Decision);
  if (!parsed.ok) return parsed.res;
  const { action, reason, urgent, change_note } = parsed.data;

  const row = await loadVersion(env, id);
  if (!row) return problem(404, "version not found");
  if (!REVIEWABLE.includes(row.state)) return problem(409, `version is ${row.state}, not open for review`);
  const event = (name: string) =>
    env.DB.prepare("INSERT INTO review_event (id, document_version_id, reviewer, action, reason) VALUES (?, ?, ?, ?, ?)").bind(
      crypto.randomUUID(),
      id,
      reviewer.email,
      name,
      reason ?? null,
    );

  if (action === "reject" || action === "reprocess") {
    if (!reason) return problem(422, `say why you chose ${action}`);
    const next = action === "reject" ? "rejected" : "parsed"; // parsed = extraction runs again on the next pipeline run
    await env.DB.batch([env.DB.prepare("UPDATE document_version SET state = ? WHERE id = ?").bind(next, id), event(action)]);
    return json({ ok: true, state: next });
  }

  // Approve: every critical field checked, and the record must pass the public schema.
  const draft = parseDraft(row);
  const flags: Flag[] = JSON.parse(row.flags_json ?? "[]");
  const states = fieldStates(await loadDecisions(env, id));
  const check = approvalCheck(reviewFields(draft, flags), states);
  if (!check.ok) return problem(409, "some fields still need a decision", { approval: check });
  if (!row.organization_id) return problem(409, "this document has no registered source organisation");

  const reviewedAt = istNow();
  const result = buildRecord(draft, states, { version_no: row.version_no, sha256: row.sha256, retrieved_at: row.retrieved_at, change_note: change_note ?? row.change_note }, reviewedAt);
  if (!result.success) return problem(422, "the reviewed record does not pass validation", { issues: result.error.issues.slice(0, 20) });
  const record = result.data;

  const clash = await env.DB.prepare("SELECT id FROM opportunity WHERE slug = ? AND id != ?").bind(record.slug, record.id).first();
  if (clash) return problem(409, `slug ${record.slug} already belongs to another opportunity`);

  const applyEnd = record.dates.find((d) => d.kind === "apply_end")?.value ?? null;
  const previous = await env.DB.prepare("SELECT current_version_id FROM opportunity WHERE id = ?").bind(record.id).first<{ current_version_id: string | null }>();

  const statements = [
    env.DB.prepare(
      `INSERT INTO opportunity (id, slug, organization_id, title, advt_no, publish_state, current_version_id, published_json, apply_end)
       VALUES (?, ?, ?, ?, ?, 'published', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET slug = excluded.slug, title = excluded.title, advt_no = excluded.advt_no,
         publish_state = 'published', current_version_id = excluded.current_version_id, published_json = excluded.published_json,
         apply_end = excluded.apply_end, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    ).bind(record.id, record.slug, row.organization_id, record.title, record.advt_no, id, JSON.stringify(record), applyEnd),
    env.DB.prepare("UPDATE document SET opportunity_id = ? WHERE id = ?").bind(record.id, row.document_id),
    env.DB.prepare("UPDATE document_version SET state = 'approved', change_note = COALESCE(?, change_note) WHERE id = ?").bind(change_note ?? null, id),
    env.DB.prepare("INSERT INTO publish_queue (document_version_id, queued_at, urgent) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(
      id,
      reviewedAt,
      urgent ? 1 : 0,
    ),
    event("approve"),
  ];
  if (previous?.current_version_id && previous.current_version_id !== id) {
    statements.push(env.DB.prepare("UPDATE document_version SET state = 'superseded' WHERE id = ?").bind(previous.current_version_id));
  }
  await env.DB.batch(statements);
  return json({ ok: true, state: "approved", opportunity: { id: record.id, slug: record.slug }, urgent: Boolean(urgent) });
}

// ------------------------------------------------------------------ corrections

export async function corrections(env: Env, status: string | null): Promise<Response> {
  const want = ["open", "confirmed", "not_an_error", "fixed"].includes(status ?? "") ? status : "open";
  const rows = await env.DB.prepare(
    "SELECT id, opportunity_slug, field_key, message, status, created_at, resolved_at FROM correction WHERE status = ? ORDER BY created_at ASC LIMIT 200",
  )
    .bind(want)
    .all();
  return json({ items: rows.results });
}

const CorrectionUpdate = z.object({ status: z.enum(["confirmed", "not_an_error", "fixed"]) });

export async function updateCorrection(request: Request, env: Env, id: string): Promise<Response> {
  const parsed = await body(request, CorrectionUpdate);
  if (!parsed.ok) return parsed.res;
  const done = parsed.data.status !== "confirmed";
  const res = await env.DB.prepare(
    "UPDATE correction SET status = ?, resolved_at = CASE WHEN ? THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE NULL END WHERE id = ?",
  )
    .bind(parsed.data.status, done ? 1 : 0, id)
    .run();
  if (!res.meta.changes) return problem(404, "report not found");
  return json({ ok: true, status: parsed.data.status });
}
