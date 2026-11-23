import { useEffect, useMemo, useState } from "preact/hooks";
import { formatDateTime } from "@myavedan/schema/dates";
import { api, ApiError, type PublishedItem } from "./api";

const SITE = "https://myavedan.in";

function Row({ item, onRemoved }: { item: PublishedItem; onRemoved: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setErr(null);
    try {
      await api.withdraw(item.id, reason.trim());
      onRemoved(item.id);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not remove. Try again.");
      setBusy(false);
    }
  }

  return (
    <li class="grid gap-2 py-3">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="min-w-0">
          <a class="font-medium" href={`${SITE}/opportunity/${item.slug}/`} target="_blank" rel="noopener">
            {item.title} ↗
          </a>
          <p class="text-xs text-ink-3">
            {item.organization ?? "—"}
            {item.advt_no ? ` · Advt. ${item.advt_no}` : ""}
            {item.apply_end ? ` · last date ${formatDateTime(item.apply_end)}` : ""}
          </p>
        </div>
        {!open && (
          <button type="button" class="btn btn-sm" onClick={() => setOpen(true)}>
            Remove from site
          </button>
        )}
      </div>
      {open && (
        <div class="notice grid gap-2">
          <p class="text-sm text-ink">
            This takes the notice off myavedan.in straight away (the site rebuilds in a few minutes). Nothing is deleted: its versions and
            review history stay, and approving a new version publishes it again.
          </p>
          <input
            class="field py-1.5 text-sm"
            placeholder="Why? (kept in the history, e.g. cancelled by the board, wrong notice)"
            value={reason}
            onInput={(e) => setReason((e.target as HTMLInputElement).value)}
            aria-label="Reason for removing"
          />
          {err && <p class="text-xs text-bad">{err}</p>}
          <div class="flex gap-2">
            <button type="button" class="btn btn-primary btn-sm" disabled={busy || reason.trim().length < 3} onClick={remove}>
              Remove from site
            </button>
            <button type="button" class="btn btn-sm" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export function Published() {
  const [items, setItems] = useState<PublishedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    api.published().then((r) => setItems(r.items)).catch((e) => setError(e instanceof ApiError ? e.message : "Could not load."));
  }, []);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (items ?? []).filter((i) => !t || `${i.title} ${i.organization ?? ""} ${i.advt_no ?? ""}`.toLowerCase().includes(t));
  }, [items, q]);

  if (error) return <p class="notice text-bad">{error}</p>;
  if (!items) return <p class="text-ink-3">Loading…</p>;
  return (
    <section class="grid gap-4">
      <div>
        <h1 class="text-2xl font-semibold">Published notices</h1>
        <p class="mt-1 text-sm text-ink-2">Everything live on myavedan.in. Admins can remove a notice from the site here.</p>
      </div>
      <input class="field max-w-md" placeholder="Search title, organisation, advertisement" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Search" />
      {shown.length === 0 ? (
        <p class="notice">{items.length ? "Nothing matches." : "Nothing published yet."}</p>
      ) : (
        <ul class="card divide-y divide-line py-0">
          {shown.map((i) => (
            <Row key={i.id} item={i} onRemoved={(id) => setItems((x) => (x ?? []).filter((y) => y.id !== id))} />
          ))}
        </ul>
      )}
    </section>
  );
}
