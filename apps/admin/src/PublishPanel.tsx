import { useEffect, useState } from "preact/hooks";
import { formatDateTime } from "@myavedan/schema/dates";
import { api } from "./api";

type Status = Awaited<ReturnType<typeof api.publishStatus>>;

const toIst = (v: string) => (v.includes("+05:30") ? v : new Date(Date.parse(v) + 330 * 60_000).toISOString().slice(0, 16) + "+05:30");

/** Approved notices waiting to go live, the last few publishes, and a "Publish now" button. */
export function PublishPanel() {
  const [s, setS] = useState<Status | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.publishStatus().then(setS).catch(() => setS(null));
  useEffect(() => void load(), []);

  async function publishNow() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.publishNow();
      setMsg(r.dispatched ? `Rebuild started for ${r.versions} notice${r.versions === 1 ? "" : "s"}. The site updates in about 3 minutes.` : r.reason);
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!s) return null;
  const last = s.batches[0];
  const lastText = !last
    ? "No publishes yet."
    : last.deployed_at
      ? `Last publish live ${formatDateTime(toIst(last.deployed_at))} (${last.versions} notice${last.versions === 1 ? "" : "s"}).`
      : last.dispatched_at
        ? `Rebuild requested ${formatDateTime(toIst(last.dispatched_at))}, in progress.`
        : "Last request did not start.";

  return (
    <section class="card mt-6 flex flex-wrap items-center justify-between gap-3" aria-label="Publishing">
      <div class="text-sm">
        <p class="font-semibold">
          {s.waiting === 0 ? "Nothing waiting to publish." : `${s.waiting} approved notice${s.waiting === 1 ? "" : "s"} waiting to go live.`}
        </p>
        <p class="text-ink-3">
          {lastText} {s.configured ? "Approved notices publish automatically every 30 minutes; urgent ones straight away." : "Automatic publishing is not set up yet (GitHub token missing)."}
        </p>
        {msg && <p class="mt-1 text-ink">{msg}</p>}
      </div>
      {s.configured && s.waiting > 0 && (
        <button type="button" class="btn" disabled={busy} onClick={publishNow}>
          {busy ? "Starting…" : "Publish now"}
        </button>
      )}
    </section>
  );
}
