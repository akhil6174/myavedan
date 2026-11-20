/**
 * Official links found by the reader (apply page, admit card, answer key, result, cut-off, corrigendum),
 * matched to a published recruitment without any AI, then attached by a reviewer.
 *
 *   POST /api/ingest/links             reader sends a batch (HMAC-signed)
 *   GET  /api/admin/links              open links with suggested recruitments
 *   GET  /api/admin/opportunities      published recruitments, for manual matching
 *   POST /api/admin/links/:id          { action: attach, opportunity_id, title?, date? } | { action: dismiss }
 */
import { z } from "zod";
import { Opportunity } from "@myavedan/schema";
import type { Env } from "./env";
import type { Reviewer } from "./access";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, istNow, verifySignature } from "./crypto";
import { json, problem, readBody } from "./http";

export const LINK_KINDS = ["apply_link", "corrigendum", "admit_card", "answer_key", "result", "cutoff"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

// ------------------------------------------------------------------ matching (pure, tested)

const STOP = new Set(["the", "of", "for", "and", "in", "to", "on", "a", "an", "recruitment", "notice", "notification", "advertisement", "advt", "exam", "examination", "post", "posts", "pdf", "download", "click", "here", "new", "2025", "2026", "2027", "dated", "no"]);

export function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFKC")
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !STOP.has(t)),
  );
}

/** Advertisement-number-like codes in a text: "CEN 08/2026", "A-4/E-1/2026", "CRPD/SCO/2026-27/36". */
export function advtCodes(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/[A-Z0-9]{1,8}(?:[\s./_-]+[A-Z0-9]{1,8}){1,5}/gi)) {
    const code = m[0].toUpperCase().replace(/[\s._-]+/g, "/");
    if (/\d/.test(code) && /[A-Z]/.test(code)) out.add(code);
  }
  return out;
}

export interface Candidate {
  id: string;
  slug: string;
  title: string;
  advt_no: string | null;
  organization_id: string;
}

export interface Suggestion {
  id: string;
  slug: string;
  title: string;
  score: number;
  why: string;
}

/** Rank recruitments for a found link. Same organisation and a matching advertisement number count most. */
export function suggest(linkText: string, url: string, sourceOrgId: string | null, candidates: Candidate[], limit = 3): Suggestion[] {
  const hay = `${linkText} ${decodeURIComponent(url).replace(/[_/.-]+/g, " ")}`;
  const linkTokens = tokens(hay);
  const linkCodes = advtCodes(hay.toUpperCase());
  const scored = candidates.map((c) => {
    let score = 0;
    const why: string[] = [];
    if (sourceOrgId && c.organization_id === sourceOrgId) {
      score += 2;
      why.push("same organisation");
    }
    if (c.advt_no) {
      const code = c.advt_no.toUpperCase().replace(/[\s._-]+/g, "/");
      if ([...linkCodes].some((x) => x.includes(code) || code.includes(x)) || hay.toUpperCase().replace(/[\s._-]+/g, "/").includes(code)) {
        score += 6;
        why.push(`advt. ${c.advt_no}`);
      }
    }
    const titleTokens = tokens(c.title);
    const overlap = [...titleTokens].filter((t) => linkTokens.has(t));
    if (overlap.length) {
      score += Math.min(4, overlap.length * 1.2);
      why.push(`title words: ${overlap.slice(0, 4).join(", ")}`);
    }
    return { id: c.id, slug: c.slug, title: c.title, score: Math.round(score * 10) / 10, why: why.join("; ") };
  });
  return scored.filter((s) => s.score >= 2).sort((a, b) => b.score - a.score).slice(0, limit);
}

// ------------------------------------------------------------------ reader → API

const IncomingLinks = z.object({
  links: z
    .array(
      z.object({
        source_url: z.string().url(),
        url: z.string().url(),
        kind: z.enum(LINK_KINDS),
        link_text: z.string().max(400),
      }),
    )
    .max(300),
});

export async function receiveLinks(request: Request, env: Env): Promise<Response> {
  if (!env.INGEST_HMAC_SECRET) return problem(503, "ingest is not configured");
  const raw = await readBody(request, 512 * 1024);
  if (raw === null) return problem(413, "body too large");
  const check = await verifySignature(env.INGEST_HMAC_SECRET, raw, request.headers.get(TIMESTAMP_HEADER), request.headers.get(SIGNATURE_HEADER));
  if (!check.ok) return problem(401, check.reason);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return problem(400, "body is not JSON");
  }
  const parsed = IncomingLinks.safeParse(body);
  if (!parsed.success) return problem(422, "invalid links", { issues: parsed.error.issues.slice(0, 10) });
  if (parsed.data.links.length === 0) return json({ received: 0, new: 0 });

  // One read of sources and published recruitments for the whole batch.
  const sources = await env.DB.prepare("SELECT s.id, s.url, s.organization_id, o.domains_json FROM source s JOIN organization o ON o.id = s.organization_id WHERE s.active = 1").all<{
    id: string;
    url: string;
    organization_id: string;
    domains_json: string;
  }>();
  const byUrl = new Map(sources.results.map((s) => [s.url, s]));
  const candidates = (
    await env.DB.prepare("SELECT id, slug, title, advt_no, organization_id FROM opportunity WHERE publish_state = 'published'").all<Candidate>()
  ).results;

  const now = istNow();
  const statements: D1PreparedStatement[] = [];
  let rejected = 0;
  for (const l of parsed.data.links) {
    const source = byUrl.get(l.source_url);
    const host = new URL(l.url).hostname.replace(/^www\./, "");
    const domains: string[] = source ? JSON.parse(source.domains_json) : [];
    if (!source || !domains.some((d) => host === d || host.endsWith(`.${d}`))) {
      rejected++;
      continue; // only official hosts of a registered source
    }
    const suggestions = suggest(l.link_text, l.url, source.organization_id, candidates);
    statements.push(
      env.DB.prepare(
        "INSERT INTO found_link (id, source_id, url, kind, link_text, found_at, suggestions_json) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(url) DO NOTHING",
      ).bind(crypto.randomUUID(), source.id, l.url, l.kind, l.link_text || l.url, now, JSON.stringify(suggestions)),
    );
  }
  let added = 0;
  if (statements.length) {
    const results = await env.DB.batch(statements);
    added = results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  }
  return json({ received: parsed.data.links.length, new: added, rejected });
}

// ------------------------------------------------------------------ console

export async function listLinks(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT f.id, f.url, f.kind, f.link_text, f.found_at, f.suggestions_json, o.name AS organization
       FROM found_link f LEFT JOIN source s ON s.id = f.source_id LEFT JOIN organization o ON o.id = s.organization_id
      WHERE f.status = 'open' ORDER BY f.found_at DESC LIMIT 300`,
  ).all<{ id: string; url: string; kind: string; link_text: string; found_at: string; suggestions_json: string; organization: string | null }>();
  return json({ items: rows.results.map((r) => ({ ...r, suggestions: JSON.parse(r.suggestions_json), suggestions_json: undefined })) });
}

export async function listOpportunities(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    "SELECT o.id, o.slug, o.title, o.advt_no, g.name AS organization FROM opportunity o LEFT JOIN organization g ON g.id = o.organization_id WHERE o.publish_state = 'published' ORDER BY o.updated_at DESC LIMIT 1000",
  ).all();
  return json({ items: rows.results });
}

const EVENT_FOR: Record<LinkKind, string | null> = {
  apply_link: null,
  corrigendum: "corrigendum",
  admit_card: "admit_card",
  answer_key: "answer_key",
  result: "result",
  cutoff: "cutoff",
};

const Decision = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("attach"),
    opportunity_id: z.string().min(1),
    title: z.string().min(3).max(200).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  z.object({ action: z.literal("dismiss") }),
]);

export async function decideLink(request: Request, env: Env, id: string, reviewer: Reviewer): Promise<Response> {
  const raw = await readBody(request, 8 * 1024);
  if (raw === null) return problem(413, "body too large");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return problem(400, "body is not JSON");
  }
  const parsed = Decision.safeParse(body);
  if (!parsed.success) return problem(422, "invalid decision", { issues: parsed.error.issues.slice(0, 5) });
  const link = await env.DB.prepare("SELECT * FROM found_link WHERE id = ? AND status = 'open'").bind(id).first<{
    id: string;
    url: string;
    kind: LinkKind;
    link_text: string;
  }>();
  if (!link) return problem(404, "link not found or already handled");
  const decidedAt = istNow();

  if (parsed.data.action === "dismiss") {
    await env.DB.prepare("UPDATE found_link SET status = 'dismissed', decided_by = ?, decided_at = ? WHERE id = ?").bind(reviewer.email, decidedAt, id).run();
    return json({ ok: true, status: "dismissed" });
  }

  const opp = await env.DB.prepare("SELECT id, slug, published_json, current_version_id FROM opportunity WHERE id = ? AND publish_state = 'published'")
    .bind(parsed.data.opportunity_id)
    .first<{ id: string; slug: string; published_json: string; current_version_id: string | null }>();
  if (!opp) return problem(404, "recruitment not found");

  const record = JSON.parse(opp.published_json);
  const eventKind = EVENT_FOR[link.kind];
  if (eventKind === null) {
    record.links = { ...record.links, apply: link.url };
  } else {
    const date = parsed.data.date ?? decidedAt.slice(0, 10);
    const events = (record.events ?? []).filter((e: { link: string }) => e.link !== link.url);
    events.push({ kind: eventKind, date, title: (parsed.data.title ?? link.link_text).slice(0, 200), link: link.url, evidence: null });
    record.events = events;
  }
  record.provenance = { ...record.provenance, last_checked_at: decidedAt };

  // Same rules as every other published record: official hosts, dates in order, and so on.
  const check = Opportunity.safeParse(record);
  if (!check.success) return problem(422, "the recruitment would no longer pass validation", { issues: check.error.issues.slice(0, 10) });

  await env.DB.batch([
    env.DB.prepare("UPDATE opportunity SET published_json = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").bind(
      JSON.stringify(check.data),
      opp.id,
    ),
    env.DB.prepare("UPDATE found_link SET status = 'attached', opportunity_id = ?, decided_by = ?, decided_at = ? WHERE id = ?").bind(
      opp.id,
      reviewer.email,
      decidedAt,
      id,
    ),
    ...(opp.current_version_id
      ? [env.DB.prepare("INSERT INTO publish_queue (document_version_id, queued_at, urgent) VALUES (?, ?, 0) ON CONFLICT DO NOTHING").bind(opp.current_version_id, decidedAt)]
      : []),
  ]);
  return json({ ok: true, status: "attached", opportunity: opp.slug });
}
