import { useEffect, useMemo, useState } from "preact/hooks";
import { formatDateTime } from "@myavedan/schema/dates";
import { api, ApiError, type FoundLink } from "./api";

const KIND: Record<FoundLink["kind"], string> = {
  apply_link: "Apply link",
  corrigendum: "Corrigendum",
  admit_card: "Admit card",
  answer_key: "Answer key",
  result: "Result",
  cutoff: "Cut-off",
};

type Opp = Awaited<ReturnType<typeof api.opportunities>>["items"][number];

function LinkCard({ link, opps, onDone }: { link: FoundLink; opps: Opp[]; onDone: () => void }) {
  const [choice, setChoice] = useState(link.suggestions[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState(link.link_text);
  const [date, setDate] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    return opps.filter((o) => `${o.title} ${o.advt_no ?? ""} ${o.organization ?? ""}`.toLowerCase().includes(q)).slice(0, 8);
  }, [search, opps]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li class="card grid gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <span class="state state-edited">{KIND[link.kind]}</span>
        <span class="text-sm text-ink-3">{link.organization ?? "Unknown source"}</span>
        <span class="num ml-auto text-xs text-ink-3">found {formatDateTime(link.found_at)}</span>
      </div>
      <div>
        <p class="font-medium">{link.link_text}</p>
        <a class="break-all text-sm" href={link.url} target="_blank" rel="noopener">
          {link.url} ↗
        </a>
        <p class="mt-1 text-xs text-ink-3">Open the link and check it really is what it says before attaching.</p>
      </div>

      <fieldset class="grid gap-1.5">
        <legend class="mb-1 text-sm text-ink-2">Which recruitment does it belong to?</legend>
        {link.suggestions.map((s) => (
          <label key={s.id} class="flex items-start gap-2 text-sm">
            <input type="radio" name={`opp-${link.id}`} checked={choice === s.id} onChange={() => setChoice(s.id)} />
            <span>
              {s.title} <span class="text-xs text-ink-3">({s.why})</span>
            </span>
          </label>
        ))}
        {link.suggestions.length === 0 && <p class="text-sm text-ink-3">No likely match. Search below.</p>}
        <input
          class="field mt-1 py-1.5 text-sm"
          placeholder="Search published recruitments by title or advt. no."
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          aria-label="Search recruitments"
        />
        {matches.map((o) => (
          <label key={o.id} class="flex items-start gap-2 text-sm">
            <input type="radio" name={`opp-${link.id}`} checked={choice === o.id} onChange={() => setChoice(o.id)} />
            <span>
              {o.title} <span class="text-xs text-ink-3">{o.advt_no ?? ""}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {link.kind !== "apply_link" && (
        <div class="grid gap-2 sm:grid-cols-[1fr_11rem]">
          <input class="field py-1.5 text-sm" value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} aria-label="Title shown to readers" />
          <input class="field py-1.5 text-sm" type="date" value={date} onInput={(e) => setDate((e.target as HTMLInputElement).value)} aria-label="Date of the update" title="Leave empty for today" />
        </div>
      )}

      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="btn btn-primary btn-sm"
          disabled={!choice || busy}
          onClick={() => run(() => api.attachLink(link.id, { opportunity_id: choice, ...(link.kind !== "apply_link" && title.trim().length >= 3 ? { title: title.trim() } : {}), ...(date ? { date } : {}) }))}
        >
          {link.kind === "apply_link" ? "Set as apply link" : "Attach to recruitment"}
        </button>
        <button type="button" class="btn btn-sm" disabled={busy} onClick={() => run(() => api.dismissLink(link.id))}>
          Not relevant
        </button>
      </div>
      {err && (
        <p class="text-sm text-bad" role="alert">
          {err}
        </p>
      )}
    </li>
  );
}

/** Official links found by the reader: attach each to its recruitment with one click. No AI involved. */
export function Links() {
  const [items, setItems] = useState<FoundLink[] | null>(null);
  const [opps, setOpps] = useState<Opp[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.links().then((r) => setItems(r.items)).catch((e) => setError(e.message));
  useEffect(() => {
    void load();
    api.opportunities().then((r) => setOpps(r.items)).catch(() => setOpps([]));
  }, []);

  return (
    <main class="mx-auto max-w-4xl px-4 py-8">
      <h1 class="text-3xl">Official links</h1>
      <p class="mt-1 max-w-2xl text-ink-2">
        Apply pages, admit cards, answer keys, results, cut-offs and corrigenda the reader found on official sites. Attach each one to its
        recruitment; it then appears on that notice's page and on the Admit cards and Results pages after the next publish.
      </p>
      {error && <p class="notice notice-warn mt-4">{error}</p>}
      {!items && !error && <p class="mt-6 text-ink-3">Loading…</p>}
      {items && items.length === 0 && <p class="notice mt-6">No new links waiting.</p>}
      <ul class="mt-6 grid gap-4">
        {items?.map((l) => (
          <LinkCard key={l.id} link={l} opps={opps} onDone={load} />
        ))}
      </ul>
    </main>
  );
}
