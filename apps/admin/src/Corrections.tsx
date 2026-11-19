import { useEffect, useState } from "preact/hooks";
import { formatDateTime } from "@myavedan/schema/dates";
import { api, type Correction } from "./api";
import { toIst } from "./Queue";
import { SITE_URL } from "./format";

const FIELD: Record<string, string> = {
  dates: "Dates",
  eligibility: "Eligibility",
  vacancies: "Posts or vacancies",
  fees: "Fees",
  links: "Links or documents",
  other: "Something else",
};

export function Corrections() {
  const [status, setStatus] = useState("open");
  const [items, setItems] = useState<Correction[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = (s: string) => {
    setItems(null);
    api.corrections(s).then((r) => setItems(r.items)).catch((e) => setError(e.message));
  };
  useEffect(() => load(status), [status]);

  async function resolve(id: string, next: "confirmed" | "not_an_error" | "fixed") {
    try {
      await api.resolve(id, next);
      load(status);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <main class="mx-auto max-w-5xl px-4 py-8">
      <h1 class="text-3xl">Error reports</h1>
      <p class="mt-1 max-w-2xl text-ink-2">
        Reports from readers, oldest first. Check each one against the official notice. If the listing is wrong, fix it through a new review
        version, then mark the report fixed.
      </p>
      <div class="mt-5 flex flex-wrap gap-1">
        {[
          ["open", "Open"],
          ["confirmed", "Confirmed, fix pending"],
          ["fixed", "Fixed"],
          ["not_an_error", "Not an error"],
        ].map(([v, l]) => (
          <button key={v} type="button" class={`btn btn-sm ${status === v ? "btn-primary" : ""}`} onClick={() => setStatus(v!)}>
            {l}
          </button>
        ))}
      </div>
      {error && <p class="notice notice-warn mt-4">{error}</p>}
      {!items && !error && <p class="mt-6 text-ink-3">Loading…</p>}
      {items && items.length === 0 && <p class="notice mt-6">No reports here.</p>}
      <ul class="mt-6 grid gap-3">
        {items?.map((c) => (
          <li key={c.id} class="card">
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <p class="font-semibold">
                {FIELD[c.field_key] ?? c.field_key} ·{" "}
                <a href={`${SITE_URL}/opportunity/${c.opportunity_slug}/`} target="_blank" rel="noopener">
                  {c.opportunity_slug}
                </a>
              </p>
              <span class="num text-xs text-ink-3">{formatDateTime(toIst(c.created_at))}</span>
            </div>
            <p class="mt-2 whitespace-pre-wrap text-ink">{c.message}</p>
            {status !== "fixed" && status !== "not_an_error" && (
              <div class="mt-3 flex flex-wrap gap-2">
                {status === "open" && (
                  <button type="button" class="btn btn-sm" onClick={() => resolve(c.id, "confirmed")}>
                    Confirmed: listing is wrong
                  </button>
                )}
                <button type="button" class="btn btn-sm" onClick={() => resolve(c.id, "fixed")}>
                  Mark fixed
                </button>
                <button type="button" class="btn btn-sm" onClick={() => resolve(c.id, "not_an_error")}>
                  Not an error
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
