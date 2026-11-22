import { useEffect, useState } from "preact/hooks";
import { formatDateTime } from "@myavedan/schema/dates";
import { api, ApiError, type HealthReport, type UnsureLink } from "./api";

const RESULT: Record<string, { label: string; cls: string }> = {
  ok: { label: "Checked", cls: "state-approved" },
  unchanged: { label: "No change", cls: "state-approved" },
  js_page: { label: "Needs custom reader", cls: "state-pending" },
  paused: { label: "Paused (keeps failing)", cls: "state-rejected" },
  failed: { label: "Failed", cls: "state-rejected" },
  blocked: { label: "Blocks the reader", cls: "state-rejected" },
};

const DAY = 86_400_000;
function daysSince(iso: string | null): number | null {
  return iso ? Math.floor((Date.now() - Date.parse(iso)) / DAY) : null;
}

/** What needs attention on a site, in plain words. */
function attention(s: HealthReport["sites"][number]): string | null {
  if (!s.last_checked) return "Never checked yet";
  if (s.last_result === "js_page") return "The page is built by JavaScript: notices can be missed until a custom reader exists";
  if (["failed", "blocked", "paused"].includes(s.last_result ?? "")) {
    const d = daysSince(s.last_ok);
    return d === null ? "Has never answered the reader" : `Not reachable for ${d} day${d === 1 ? "" : "s"}`;
  }
  const quiet = daysSince(s.last_new);
  if (quiet !== null && quiet > 45) return `Nothing new for ${quiet} days: check the site still lists notices here`;
  return null;
}

function Runs({ runs }: { runs: HealthReport["runs"] }) {
  if (!runs.length) return <p class="notice">No reader runs reported yet. The next 11:00 or 19:00 run sends the first report.</p>;
  return (
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Run</th>
            <th>Sites checked</th>
            <th>Failed</th>
            <th>New links</th>
            <th>Drafts sent</th>
            <th>Outdated skipped</th>
            <th>Unsure</th>
            <th>Problems</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td class="num whitespace-nowrap">{formatDateTime(r.started_at)}</td>
              <td class="num">{r.counts.sites ?? "–"}</td>
              <td class={`num ${r.counts.sites_failed ? "text-bad font-semibold" : ""}`}>{r.counts.sites_failed ?? 0}</td>
              <td class="num">{r.counts.new_found ?? 0}</td>
              <td class="num font-semibold">{r.counts.drafts_sent ?? 0}</td>
              <td class="num">{(r.counts.outdated_skipped ?? 0) + (r.counts.outdated_after_reading ?? 0)}</td>
              <td class="num">{r.counts.unsure ?? 0}</td>
              <td class="text-sm">
                {r.errors.length ? (
                  <details>
                    <summary class="cursor-pointer text-bad">{r.errors.length} error{r.errors.length === 1 ? "" : "s"}</summary>
                    <ul class="mt-1 list-disc pl-4 text-xs text-ink-2">
                      {r.errors.map((e, i) => (
                        <li key={i} class="break-all">
                          {e}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : (r.counts.deferred ?? 0) > 0 ? (
                  <span class="text-ink-3">{r.counts.deferred} left for next run (Google busy)</span>
                ) : (
                  <span class="text-ink-3">None</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Sites({ sites }: { sites: HealthReport["sites"] }) {
  const rows = [...sites].sort((a, b) => Number(!attention(a)) - Number(!attention(b)) || a.organization.localeCompare(b.organization));
  const flagged = rows.filter((s) => attention(s)).length;
  return (
    <>
      <p class="mb-3 text-sm text-ink-2">
        {flagged ? (
          <>
            <strong class="text-bad">{flagged}</strong> of {sites.length} official sites need attention. Notices on these sites can be missed.
          </>
        ) : (
          <>All {sites.length} official sites answered the last run.</>
        )}
      </p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Organisation</th>
              <th>Last result</th>
              <th>Last checked</th>
              <th>Last new item</th>
              <th>Needs attention</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const r = RESULT[s.last_result ?? ""];
              const why = attention(s);
              return (
                <tr key={s.id}>
                  <td>
                    <span class="font-medium">{s.organization}</span>
                    <a class="block break-all text-xs" href={s.url} target="_blank" rel="noopener">
                      {s.url} ↗
                    </a>
                  </td>
                  <td>{r ? <span class={`state ${r.cls}`}>{r.label}</span> : <span class="text-ink-3">–</span>}</td>
                  <td class="num whitespace-nowrap text-sm">{s.last_checked ? formatDateTime(s.last_checked) : "–"}</td>
                  <td class="num whitespace-nowrap text-sm">{s.last_new ? formatDateTime(s.last_new) : "–"}</td>
                  <td class={`text-sm ${why ? "text-bad" : "text-ink-3"}`}>
                    {why ?? "OK"}
                    {s.last_error && why && <span class="block text-xs text-ink-3">{s.last_error}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

const READ_AS: [string, string][] = [
  ["notice", "Job notice"],
  ["result", "Result"],
  ["admit_card", "Admit card"],
  ["answer_key", "Answer key"],
  ["cutoff", "Cut-off"],
  ["corrigendum", "Corrigendum"],
];

function UnsureRow({ link, onDone }: { link: UnsureLink; onDone: (id: string) => void }) {
  const [kind, setKind] = useState("notice");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function act(action: "read" | "dismiss") {
    setBusy(true);
    setErr(null);
    try {
      await (action === "read" ? api.unsureRead(link.id, kind) : api.unsureDismiss(link.id));
      onDone(link.id);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save. Try again.");
      setBusy(false);
    }
  }
  return (
    <li class="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div class="min-w-0">
        <p class="font-medium">{link.link_text}</p>
        <p class="text-xs text-ink-3">
          {link.organization ?? "Unknown source"} · found {formatDateTime(link.found_at)} ·{" "}
          <a class="break-all" href={link.url} target="_blank" rel="noopener">
            open ↗
          </a>
        </p>
        {err && <p class="text-xs text-bad">{err}</p>}
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <select class="field w-36 py-1 text-sm" value={kind} onChange={(e) => setKind((e.target as HTMLSelectElement).value)} aria-label="What it is">
          {READ_AS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <button type="button" class="btn btn-primary btn-sm" disabled={busy} onClick={() => act("read")}>
          Read it
        </button>
        <button type="button" class="btn btn-sm" disabled={busy} onClick={() => act("dismiss")}>
          Not needed
        </button>
      </div>
    </li>
  );
}

export function Health() {
  const [data, setData] = useState<HealthReport | null>(null);
  const [unsure, setUnsure] = useState<UnsureLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.health().then(setData).catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the report."));
    api.unsure().then((r) => setUnsure(r.items)).catch(() => setUnsure([]));
  }, []);
  if (error) return <p class="notice text-bad">{error}</p>;
  if (!data) return <p class="text-ink-3">Loading…</p>;
  return (
    <div class="grid gap-10">
      <section>
        <h1 class="text-2xl font-semibold">Reader health</h1>
        <p class="mt-1 text-sm text-ink-2">What each run of the notice reader did, and which official sites may be hiding notices from it.</p>
        <h2 class="mb-2 mt-6 text-lg font-semibold">Recent runs</h2>
        <Runs runs={data.runs} />
      </section>

      <section id="unsure">
        <h2 class="text-lg font-semibold">
          Unsure links {unsure && unsure.length > 0 && <span class="state state-pending ml-1">{unsure.length}</span>}
        </h2>
        <p class="mb-2 mt-1 text-sm text-ink-2">
          New links on official sites that the reader couldn't classify. Nothing is dropped silently: open each one, then choose what it is and
          press <strong>Read it</strong> (the next run reads it and sends a draft), or <strong>Not needed</strong>.
        </p>
        {unsure === null ? (
          <p class="text-ink-3">Loading…</p>
        ) : unsure.length === 0 ? (
          <p class="notice">Nothing waiting.</p>
        ) : (
          <ul class="card divide-y divide-line py-0">
            {unsure.map((l) => (
              <UnsureRow key={l.id} link={l} onDone={(id) => setUnsure((u) => (u ?? []).filter((x) => x.id !== id))} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 class="mb-2 text-lg font-semibold">Official sites</h2>
        <Sites sites={data.sites} />
      </section>
    </div>
  );
}
