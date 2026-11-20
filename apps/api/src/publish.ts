/**
 * Publish trigger: turns approvals into a site rebuild.
 *
 * Approvals land in publish_queue. On the cron (every 30 min), or immediately for an urgent approval,
 * waiting rows are grouped into a publish_batch and GitHub is asked to run the Publish workflow
 * (repository_dispatch). The workflow downloads the approved snapshot, builds and deploys the site,
 * then calls POST /api/publish/complete, which marks the batch deployed and its versions published.
 */
import type { Env } from "./env";
import { istNow, timingSafeEqual } from "./crypto";
import { json, problem, readBody } from "./http";

export const DEFAULT_MIN_INTERVAL_MINUTES = 30;

/** Pure decision, tested on its own: should waiting approvals be dispatched now? */
export function shouldDispatch(opts: {
  waiting: number;
  urgent: boolean;
  lastDispatchMs: number | null;
  nowMs: number;
  minIntervalMinutes: number;
}): boolean {
  if (opts.waiting === 0) return false;
  if (opts.urgent || opts.lastDispatchMs === null) return true;
  return opts.nowMs - opts.lastDispatchMs >= opts.minIntervalMinutes * 60_000;
}

export interface TriggerResult {
  dispatched: boolean;
  reason: string;
  batch_id?: string;
  versions?: number;
}

export async function runPublishTrigger(env: Env, opts: { force?: boolean; nowMs?: number } = {}): Promise<TriggerResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const waiting = await env.DB.prepare("SELECT document_version_id, urgent FROM publish_queue WHERE batch_id IS NULL").all<{
    document_version_id: string;
    urgent: number;
  }>();
  const rows = waiting.results;
  const last = await env.DB.prepare("SELECT MAX(dispatched_at) AS at FROM publish_batch").first<{ at: string | null }>();
  const lastMs = last?.at ? Date.parse(last.at) : null;
  const minInterval = Number(env.PUBLISH_MIN_INTERVAL_MINUTES ?? DEFAULT_MIN_INTERVAL_MINUTES);

  if (!shouldDispatch({ waiting: rows.length, urgent: Boolean(opts.force) || rows.some((r) => r.urgent === 1), lastDispatchMs: lastMs, nowMs, minIntervalMinutes: minInterval })) {
    return { dispatched: false, reason: rows.length ? "waiting for the minimum interval" : "nothing to publish" };
  }
  if (!env.GITHUB_DISPATCH_TOKEN || !env.GITHUB_REPO) return { dispatched: false, reason: "GitHub dispatch is not configured" };

  const batchId = crypto.randomUUID();
  const ids = rows.map((r) => r.document_version_id);
  const requestedAt = istNow(nowMs);

  // Claim the rows first so an overlapping cron run can't dispatch them twice.
  await env.DB.batch([
    env.DB.prepare("INSERT INTO publish_batch (id, requested_at, urgent, versions_json) VALUES (?, ?, ?, ?)").bind(
      batchId,
      requestedAt,
      rows.some((r) => r.urgent === 1) ? 1 : 0,
      JSON.stringify(ids),
    ),
    ...ids.map((id) => env.DB.prepare("UPDATE publish_queue SET batch_id = ? WHERE document_version_id = ? AND batch_id IS NULL").bind(batchId, id)),
  ]);

  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "MyAvedan-publish-trigger",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event_type: "publish", client_payload: { batch_id: batchId, environment: env.PUBLISH_ENV ?? "staging" } }),
  });

  if (res.status !== 204) {
    // Release the rows so the next run tries again.
    await env.DB.batch([
      env.DB.prepare("UPDATE publish_queue SET batch_id = NULL WHERE batch_id = ?").bind(batchId),
      env.DB.prepare("DELETE FROM publish_batch WHERE id = ?").bind(batchId),
    ]);
    const text = (await res.text()).slice(0, 200);
    console.error(JSON.stringify({ job: "publish-trigger", error: "dispatch failed", status: res.status, body: text }));
    return { dispatched: false, reason: `GitHub refused the dispatch (${res.status})` };
  }

  await env.DB.prepare("UPDATE publish_batch SET dispatched_at = ? WHERE id = ?").bind(new Date(nowMs).toISOString(), batchId).run();
  console.log(JSON.stringify({ job: "publish-trigger", dispatched: batchId, versions: ids.length }));
  return { dispatched: true, reason: "dispatched", batch_id: batchId, versions: ids.length };
}

/** Called by the Publish workflow after a successful deploy. */
export async function publishComplete(request: Request, env: Env): Promise<Response> {
  if (!env.PUBLISH_TOKEN) return problem(503, "publishing is not configured");
  if (!timingSafeEqual(request.headers.get("Authorization") ?? "", `Bearer ${env.PUBLISH_TOKEN}`)) return problem(401, "unauthorised");
  const raw = await readBody(request, 4096);
  let batchId: unknown;
  try {
    batchId = JSON.parse(raw ?? "{}").batch_id;
  } catch {
    return problem(400, "body is not JSON");
  }
  const deployedAt = istNow();

  if (typeof batchId !== "string" || !batchId) {
    // Scheduled or manual builds have no batch: still mark everything already approved as live.
    const [res] = await env.DB.batch([
      env.DB.prepare(
        "UPDATE document_version SET state = 'published' WHERE state = 'approved' AND id IN (SELECT current_version_id FROM opportunity WHERE publish_state = 'published')",
      ),
      // Those approvals are live now, so they no longer need a publish of their own.
      env.DB.prepare(
        "DELETE FROM publish_queue WHERE batch_id IS NULL AND document_version_id IN (SELECT id FROM document_version WHERE state = 'published')",
      ),
    ]);
    return json({ ok: true, published: res?.meta.changes ?? 0 });
  }

  const batch = await env.DB.prepare("SELECT versions_json FROM publish_batch WHERE id = ?").bind(batchId).first<{ versions_json: string }>();
  if (!batch) return problem(404, "batch not found");
  const ids: string[] = JSON.parse(batch.versions_json);
  await env.DB.batch([
    env.DB.prepare("UPDATE publish_batch SET deployed_at = ? WHERE id = ?").bind(deployedAt, batchId),
    ...ids.map((id) => env.DB.prepare("UPDATE document_version SET state = 'published' WHERE id = ? AND state = 'approved'").bind(id)),
    env.DB.prepare("DELETE FROM publish_queue WHERE batch_id = ?").bind(batchId),
  ]);
  return json({ ok: true, published: ids.length, batch_id: batchId });
}

/** Admin view: what is waiting and the last few publishes. */
export async function publishStatus(env: Env): Promise<Response> {
  const waiting = await env.DB.prepare("SELECT COUNT(*) AS n FROM publish_queue WHERE batch_id IS NULL").first<{ n: number }>();
  const batches = await env.DB.prepare(
    "SELECT id, requested_at, dispatched_at, deployed_at, urgent, versions_json FROM publish_batch ORDER BY requested_at DESC LIMIT 10",
  ).all<{ id: string; requested_at: string; dispatched_at: string | null; deployed_at: string | null; urgent: number; versions_json: string }>();
  return json({
    waiting: waiting?.n ?? 0,
    configured: Boolean(env.GITHUB_DISPATCH_TOKEN && env.GITHUB_REPO),
    batches: batches.results.map((b) => ({ ...b, versions: JSON.parse(b.versions_json).length, versions_json: undefined })),
  });
}
