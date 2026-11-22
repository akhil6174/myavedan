import { useEffect, useMemo, useState } from "preact/hooks";
import { formatDateTime } from "@myavedan/schema/dates";
import { api, ApiError, type Evidence, type Field, type VersionDetail } from "./api";
import { SITE_URL, describe, previousValue, sameValue } from "./format";

const GROUPS: { id: Field["group"]; title: string }[] = [
  { id: "dates", title: "Dates" },
  { id: "posts", title: "Posts and vacancies" },
  { id: "eligibility", title: "Eligibility rules" },
  { id: "fees", title: "Fees" },
  { id: "links", title: "Links" },
  { id: "overview", title: "Overview" },
  { id: "process", title: "Selection, documents, updates" },
];

const STATE_LABEL = { pending: "To check", approved: "Approved", edited: "Edited", rejected: "Rejected" } as const;

// ------------------------------------------------------------------ notice text pane

function highlight(text: string, snippet: string | null) {
  if (!snippet) return [text];
  const first = snippet.split(/\.\.\.|…/)[0]!.trim();
  const lower = text.toLowerCase();
  let at = lower.indexOf(first.toLowerCase());
  let len = first.length;
  if (at < 0 && first.length > 24) {
    at = lower.indexOf(first.slice(0, 24).toLowerCase());
    len = 24;
  }
  if (at < 0) return [text];
  return [text.slice(0, at), <mark class="cite" id="cite">{text.slice(at, at + len)}</mark>, text.slice(at + len)];
}

function NoticePane({ detail, focus, onPage }: { detail: VersionDetail; focus: Evidence | null; onPage: (p: number) => void }) {
  const pages = Object.keys(detail.pages).map(Number).sort((a, b) => a - b);
  const page = focus?.page ?? pages[0] ?? 1;
  const text = detail.pages[String(page)];
  useEffect(() => {
    document.getElementById("cite")?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focus]);

  return (
    <section class="flex min-h-0 flex-col rounded-xl border border-line bg-surface" aria-label="Notice text">
      <div class="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <span class="text-sm font-semibold">Notice text</span>
        <div class="flex flex-wrap gap-1">
          {pages.map((p) => (
            <button
              key={p}
              type="button"
              class={`btn btn-sm px-2 ${p === page ? "btn-primary" : ""}`}
              onClick={() => onPage(p)}
              aria-label={`Page ${p}`}
            >
              {p}
            </button>
          ))}
        </div>
        <a class="ml-auto text-sm" href={`${detail.version.document_url}#page=${page}`} target="_blank" rel="noopener">
          Open PDF at page {page} ↗
        </a>
      </div>
      <div class="min-h-0 flex-1 overflow-auto p-4">
        {text ? (
          <pre class="whitespace-pre-wrap font-sans text-[0.9rem] leading-relaxed text-ink">{highlight(text, focus?.page === page ? focus.snippet : null)}</pre>
        ) : (
          <p class="text-sm text-ink-3">
            No extracted text for page {page}. Check this page in the official PDF.
          </p>
        )}
      </div>
      {focus && (
        <p class="border-t border-line px-3 py-2 text-xs text-ink-2">
          Cited: p. {focus.page}
          {focus.section ? ` §${focus.section}` : ""} · “{focus.snippet}”
        </p>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ one field

function FieldCard({
  field,
  previous,
  isUpdate,
  editable,
  onShow,
  onAct,
}: {
  field: Field;
  previous: unknown;
  isUpdate: boolean;
  editable: boolean;
  onShow: (e: Evidence) => void;
  onAct: (action: "approve" | "edit" | "reject", extra?: { value?: unknown; reason?: string }) => Promise<void>;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "reject">("view");
  const [draft, setDraft] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = field.state === "edited" && field.decision?.value !== undefined ? field.decision.value : field.value;
  const primitive = typeof field.value !== "object" || field.value === null;
  const changed = isUpdate && previous !== undefined && !sameValue(previous, field.value);
  const isNew = isUpdate && previous === undefined;

  async function run(action: "approve" | "edit" | "reject", extra?: { value?: unknown; reason?: string }) {
    setBusy(true);
    setErr(null);
    try {
      await onAct(action, extra);
      setMode("view");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function saveEdit() {
    let value: unknown;
    if (primitive && typeof field.value !== "number") value = draft.trim() === "" ? null : draft;
    else {
      try {
        value = JSON.parse(draft);
      } catch {
        setErr("That isn't valid JSON. Check quotes and commas.");
        return;
      }
    }
    void run("edit", { value });
  }

  return (
    <article class={`card grid gap-2 ${field.state === "pending" && field.critical ? "border-line-2" : ""}`} id={`f-${field.key}`}>
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="text-[0.95rem] font-semibold" style="font-family:var(--font-sans);font-stretch:100%">
          {field.label}
        </h3>
        {field.critical && <span class="state state-pending">Critical</span>}
        <span class={`state state-${field.state}`}>{STATE_LABEL[field.state]}</span>
        {changed && <span class="state state-edited">Changed since live version</span>}
        {isNew && <span class="state state-edited">New in this version</span>}
      </div>

      <div class="text-[0.95rem] text-ink">
        {describe(field, shown).map((line, i) => (
          <p key={i} class={i ? "text-sm text-ink-2" : ""}>
            {line}
          </p>
        ))}
      </div>
      {field.state === "edited" && <p class="text-xs text-brand-ink">Edited by {field.decision?.reviewer}. The draft value was: {describe(field, field.value)[0]}</p>}
      {changed && <p class="text-xs text-ink-2">Live version: {describe(field, previous)[0]}</p>}
      {field.state === "rejected" && field.decision?.reason && <p class="text-xs text-bad">Rejected: {field.decision.reason}</p>}

      <div class="flex flex-wrap items-center gap-2 text-xs">
        {field.evidence ? (
          <button type="button" class="ev" onClick={() => onShow(field.evidence!)} title={field.evidence.snippet}>
            p. {field.evidence.page}
            {field.evidence.section ? ` §${field.evidence.section}` : ""} · show in notice
          </button>
        ) : (
          field.critical && <span class="text-warn">No evidence cited: check the PDF yourself</span>
        )}
        {field.grounded === true && <span class="text-ok">✓ quote found on that page</span>}
        {field.grounded === false && <span class="font-semibold text-bad">✕ quote not found on that page</span>}
      </div>
      {field.flags.map((f) => (
        <p key={f.code + f.field} class={`text-xs ${(f.tier ?? (f.severity === "error" ? "red" : "yellow")) === "red" ? "font-semibold text-bad" : "text-warn"}`}>
          {(f.tier ?? (f.severity === "error" ? "red" : "yellow")) === "red" ? "Check" : "Note"}: {f.message}
        </p>
      ))}

      {editable && mode === "view" && (
        <div class="flex flex-wrap gap-2 pt-1">
          <button type="button" class="btn btn-sm" disabled={busy} onClick={() => run("approve")}>
            Approve
          </button>
          <button
            type="button"
            class="btn btn-sm"
            disabled={busy}
            onClick={() => {
              setDraft(primitive ? String(shown ?? "") : JSON.stringify(shown, null, 2));
              setMode("edit");
            }}
          >
            Edit
          </button>
          <button type="button" class="btn btn-sm" disabled={busy} onClick={() => setMode("reject")}>
            Reject
          </button>
        </div>
      )}
      {mode === "edit" && (
        <div class="grid gap-2">
          {primitive ? (
            <input class="field" value={draft} onInput={(e) => setDraft((e.target as HTMLInputElement).value)} aria-label={`New value for ${field.label}`} />
          ) : (
            <textarea class="field min-h-40" value={draft} onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)} aria-label={`New value for ${field.label}`} />
          )}
          <div class="flex gap-2">
            <button type="button" class="btn btn-primary btn-sm" disabled={busy} onClick={saveEdit}>
              Save edit
            </button>
            <button type="button" class="btn btn-sm" onClick={() => setMode("view")}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {mode === "reject" && (
        <div class="grid gap-2">
          <input
            class="field"
            placeholder="Why is this wrong? (required)"
            value={reason}
            onInput={(e) => setReason((e.target as HTMLInputElement).value)}
            aria-label={`Reason for rejecting ${field.label}`}
          />
          <div class="flex gap-2">
            <button type="button" class="btn btn-sm" disabled={busy || !reason.trim()} onClick={() => run("reject", { reason: reason.trim() })}>
              Reject field
            </button>
            <button type="button" class="btn btn-sm" onClick={() => setMode("view")}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {err && (
        <p class="text-xs text-bad" role="alert">
          {err}
        </p>
      )}
    </article>
  );
}

// ------------------------------------------------------------------ decision bar

export const KIND_OPTIONS: [string, string][] = [
  ["notice", "New recruitment (opening)"],
  ["result", "Result / selection list"],
  ["admit_card", "Admit card"],
  ["answer_key", "Answer key"],
  ["cutoff", "Cut-off marks"],
  ["corrigendum", "Corrigendum / date change"],
  ["other", "Other (not for the site)"],
];
const UPDATE_KINDS = ["result", "admit_card", "answer_key", "cutoff", "corrigendum"];

type Opp = { id: string; slug: string; title: string; advt_no: string | null; organization: string | null };

function DecisionBar({ detail, id, onDone, onKind }: { detail: VersionDetail; id: string; onDone: (msg: string) => void; onKind: () => void }) {
  const kind = detail.version.document_kind;
  const isUpdate = UPDATE_KINDS.includes(kind);
  const [opps, setOpps] = useState<Opp[] | null>(null);
  const best = detail.suggestions?.[0];
  const [parent, setParent] = useState(best?.id ?? "");
  const [q, setQ] = useState("");
  useEffect(() => {
    if (isUpdate && opps === null) api.opportunities().then((r) => setOpps(r.items)).catch(() => setOpps([]));
  }, [isUpdate]);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (opps ?? []).filter((o) => !t || `${o.title} ${o.advt_no ?? ""} ${o.organization ?? ""}`.toLowerCase().includes(t)).slice(0, 50);
  }, [opps, q]);
  async function changeKind(next: string) {
    setErr(null);
    try {
      await api.setKind(id, next);
      onKind();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not change the type.");
    }
  }
  async function attach() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.decide(id, { action: "attach", opportunity_id: parent, urgent });
      onDone(`Attached. It shows on the recruitment page at the next publish: ${SITE_URL}/opportunity/${r.opportunity?.slug}/`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  }
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const a = detail.approval;
  const critical = detail.fields.filter((f) => f.critical);
  const checked = critical.filter((f) => f.state === "approved" || f.state === "edited").length;

  async function decide(action: "approve" | "reject" | "reprocess") {
    setBusy(true);
    setErr(null);
    setIssues([]);
    try {
      const r = await api.decide(id, { action, reason: reason.trim() || undefined, urgent, change_note: note.trim() || undefined });
      onDone(
        action === "approve"
          ? `Approved. It goes live at the next publish${urgent ? " (marked urgent)" : ""}: ${SITE_URL}/opportunity/${r.opportunity?.slug}/`
          : action === "reject"
            ? "Rejected. The document will not be published."
            : "Sent back. Extraction runs again on the next pipeline run.",
      );
    } catch (e) {
      if (e instanceof ApiError) {
        setErr(e.message);
        const list = (e.detail.issues as { path: (string | number)[]; message: string }[] | undefined) ?? [];
        setIssues(list.map((i) => `${i.path.join(".")}: ${i.message}`));
      } else setErr("Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="sticky bottom-0 z-10 border-t border-line-2 bg-surface/95 backdrop-blur">
      <div class="mx-auto grid max-w-[96rem] gap-3 px-4 py-3 2xl:grid-cols-[minmax(0,1fr)_auto] 2xl:items-center">
        <div class="text-sm">
          <label class="mb-1 flex flex-wrap items-center gap-2">
            <span class="font-semibold">This document is:</span>
            <select class="field w-64 py-1 text-sm" value={kind} onChange={(e) => changeKind((e.target as HTMLSelectElement).value)} aria-label="Document type">
              {KIND_OPTIONS.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {isUpdate ? (
            <p class="text-ink-3">
              An update, not a new opening: choose the recruitment it belongs to. It appears on that page and in Results / Admit cards.
              {best && (
                <span class="mt-1 block text-ok">
                  Suggested: <strong>{best.title}</strong> ({best.why}). Check it, then press Attach.
                </span>
              )}
            </p>
          ) : kind === "other" ? (
            <p class="text-ink-3">Not published on the site. Reject it, or change the type.</p>
          ) : (
          <>
          <p class="font-semibold">
            {checked} of {critical.length} critical fields checked
            {a.rejected.length > 0 && <span class="text-bad"> · {a.rejected.length} rejected</span>}
            {a.errors.length > 0 && <span class="text-bad"> · {a.errors.length} with unresolved errors</span>}
          </p>
          <p class="text-ink-3">
            {a.ok ? "Ready to approve." : "Approve or edit every critical field to enable publishing. Reject sends nothing live."}
          </p>
          </>
          )}
          {err && (
            <p class="mt-1 text-bad" role="alert">
              {err}
            </p>
          )}
          {issues.length > 0 && (
            <ul class="mt-1 list-disc pl-5 text-xs text-bad">
              {issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <input
            class="field w-56 py-1.5 text-sm"
            placeholder="Change note for readers (optional)"
            value={note}
            onInput={(e) => setNote((e.target as HTMLInputElement).value)}
            aria-label="Change note"
          />
          <label class="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={urgent} onChange={(e) => setUrgent((e.target as HTMLInputElement).checked)} /> Urgent
          </label>
          {isUpdate ? (
            <>
              <input class="field w-44 py-1.5 text-sm" placeholder="Search recruitments" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Search recruitments" />
              <select class="field w-72 py-1.5 text-sm" value={parent} onChange={(e) => setParent((e.target as HTMLSelectElement).value)} aria-label="Recruitment">
                <option value="">{opps === null ? "Loading…" : opps.length ? "Choose the recruitment…" : "No published recruitments yet"}</option>
                {(detail.suggestions ?? []).filter((s) => !matches.some((o) => o.id === s.id)).map((s) => (
                  <option key={s.id} value={s.id}>
                    ★ {s.title}
                  </option>
                ))}
                {matches.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title}
                    {o.advt_no ? ` (${o.advt_no})` : ""}
                  </option>
                ))}
              </select>
              <button type="button" class="btn btn-primary" disabled={!parent || busy} onClick={attach}>
                Attach and publish
              </button>
            </>
          ) : (
            <button type="button" class="btn btn-primary" disabled={!a.ok || busy || kind === "other"} onClick={() => decide("approve")}>
              Approve and publish
            </button>
          )}
          <input
            class="field w-48 py-1.5 text-sm"
            placeholder="Reason to reject or redo"
            value={reason}
            onInput={(e) => setReason((e.target as HTMLInputElement).value)}
            aria-label="Reason"
          />
          <button type="button" class="btn" disabled={!reason.trim() || busy} onClick={() => decide("reprocess")}>
            Send back
          </button>
          <button type="button" class="btn" disabled={!reason.trim() || busy} onClick={() => decide("reject")}>
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ page

export function Review({ id }: { id: string }) {
  const [detail, setDetail] = useState<VersionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<Evidence | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = () =>
    api
      .version(id)
      .then((d) => {
        setDetail(d);
        setError(null);
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    setDetail(null);
    setDone(null);
    setFocus(null);
    void load();
  }, [id]);

  const title = useMemo(() => {
    const t = detail?.fields.find((f) => f.key === "title")?.value;
    return typeof t === "string" ? t : "Draft";
  }, [detail]);

  if (error) return <p class="notice notice-warn mx-auto mt-8 max-w-2xl">{error}</p>;
  if (!detail) return <p class="px-4 py-12 text-center text-ink-3">Loading…</p>;

  const v = detail.version;
  const isUpdate = detail.previous !== null;
  const pendingNonCritical = detail.fields.filter((f) => !f.critical && f.state === "pending").map((f) => f.key);

  async function act(f: Field, action: "approve" | "edit" | "reject", extra?: { value?: unknown; reason?: string }) {
    await api.field(id, { key: f.key, action, ...extra });
    await load();
  }

  return (
    <div>
      <div class="mx-auto max-w-[96rem] px-4 pt-5">
        <a href="#/queue" class="text-sm">
          ← Queue
        </a>
        <div class="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 class="text-2xl">{title}</h1>
          <span class="text-sm text-ink-3">
            {v.document_kind} · version {v.version_no} · retrieved {formatDateTime(v.retrieved_at)} · {v.state.replace("_", " ")}
            {isUpdate && " · update to a live notice"}
          </span>
        </div>
        {done && (
          <div class="notice mt-4 border-ok bg-ok-soft text-ink" role="status">
            {done} <a href="#/queue">Back to the queue</a>
          </div>
        )}
        {!v.reviewable && !done && <p class="notice mt-4">This version is {v.state.replace("_", " ")} and no longer open for review.</p>}
      </div>

      <div class="mx-auto grid max-w-[96rem] gap-4 px-4 py-4 lg:h-[calc(100vh-15rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <NoticePane detail={detail} focus={focus} onPage={(p) => setFocus({ page: p, snippet: "" })} />

        <div class="min-h-0 overflow-auto pr-1">
          {(["red", "yellow"] as const).map((tier) => {
            const list = detail.flags.filter((f) => (f.tier ?? (f.severity === "error" ? "red" : "yellow")) === tier);
            if (!list.length) return null;
            return (
              <div key={tier} class={`notice mb-4 ${tier === "red" ? "border-bad bg-bad-soft" : ""}`}>
                <p class="font-semibold text-ink">
                  {tier === "red"
                    ? `Must check against the PDF (${list.length})`
                    : `For information (${list.length})`}
                </p>
                <ul class="mt-1 list-disc pl-5 text-sm">
                  {list.map((f) => (
                    <li key={f.field + f.code + f.message} class={tier === "red" ? "text-bad" : ""}>
                      <a href={`#/review/${id}`} onClick={(e) => (e.preventDefault(), document.getElementById(`f-${f.field}`)?.scrollIntoView({ block: "center" }))}>
                        {f.field}
                      </a>
                      : {f.message}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {detail.flags.length > 0 && !detail.flags.some((f) => (f.tier ?? (f.severity === "error" ? "red" : "yellow")) === "red") && (
            <p class="mb-4 text-sm text-ok">No red flags: only information notes. Check the critical fields and approve.</p>
          )}
          {GROUPS.map((g) => {
            const fields = detail.fields.filter((f) => f.group === g.id);
            if (!fields.length) return null;
            const bulk = fields.filter((f) => pendingNonCritical.includes(f.key)).map((f) => f.key);
            return (
              <section key={g.id} class="mb-6" aria-labelledby={`g-${g.id}`}>
                <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h2 id={`g-${g.id}`} class="text-lg">
                    {g.title}
                  </h2>
                  {v.reviewable && bulk.length > 1 && (
                    <button type="button" class="btn btn-sm" onClick={() => api.bulk(id, bulk).then(load)}>
                      Approve {bulk.length} non-critical fields
                    </button>
                  )}
                </div>
                <div class="grid gap-3">
                  {fields.map((f) => (
                    <FieldCard
                      key={f.key}
                      field={f}
                      previous={previousValue(detail.previous, f.key)}
                      isUpdate={isUpdate}
                      editable={v.reviewable}
                      onShow={setFocus}
                      onAct={(action, extra) => act(f, action, extra)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {v.reviewable && !done && <DecisionBar detail={detail} id={id} onDone={(m) => (setDone(m), void load())} onKind={() => void load()} />}
    </div>
  );
}
