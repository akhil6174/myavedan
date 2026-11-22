import { useEffect, useState } from "preact/hooks";
import { daysBetween, formatDate, formatDateTime, istDate } from "@myavedan/schema/dates";
import { api, type QueueItem } from "./api";
import { PublishPanel } from "./PublishPanel";

const KIND: Record<string, string> = {
  notice: "New notice",
  corrigendum: "Corrigendum",
  admit_card: "Admit card",
  answer_key: "Answer key",
  result: "Result",
  cutoff: "Cut-off",
  other: "Other document",
};

function deadline(item: QueueItem): { text: string; tone: string } {
  if (!item.apply_end) return { text: "No deadline in draft", tone: "text-ink-3" };
  const days = daysBetween(istDate(Date.now()), item.apply_end.slice(0, 10));
  if (days < 0) return { text: `Closed ${formatDate(item.apply_end)}`, tone: "text-ink-3" };
  if (days <= 7) return { text: `Closes in ${days} day${days === 1 ? "" : "s"}`, tone: "text-warn font-semibold" };
  return { text: `Closes ${formatDate(item.apply_end)}`, tone: "text-ink-2" };
}

export function Queue() {
  const [data, setData] = useState<{ items: QueueItem[]; open_corrections: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.queue().then(setData).catch((e) => setError(e.message));
  }, []);

  return (
    <main class="mx-auto max-w-6xl px-4 py-8">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-3xl">Review queue</h1>
          <p class="mt-1 text-ink-2">Soonest deadline first. Updates to live notices come before new ones with the same deadline.</p>
        </div>
        {data && data.open_corrections > 0 && (
          <a class="btn" href="#/corrections">
            {data.open_corrections} open error report{data.open_corrections === 1 ? "" : "s"}
          </a>
        )}
      </div>

      <PublishPanel />

      {error && <p class="notice notice-warn mt-6">{error}</p>}
      {!data && !error && <p class="mt-8 text-ink-3">Loading…</p>}
      {data && data.items.length === 0 && (
        <div class="notice mt-6">
          <p class="font-medium text-ink">Nothing waiting for review.</p>
          <p class="mt-1">New drafts appear here after each pipeline run.</p>
        </div>
      )}

      {data && data.items.length > 0 && (
        <div class="table-wrap mt-6">
          <table>
            <thead>
              <tr>
                <th>Notice</th>
                <th>Type</th>
                <th>Deadline</th>
                <th>Checks</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => {
                const d = deadline(item);
                return (
                  <tr key={item.id}>
                    <td>
                      <a href={`#/review/${item.id}`} class="font-semibold">
                        {item.title}
                      </a>
                      <div class="text-sm text-ink-3">{item.organization ?? "Unknown organisation"}</div>
                    </td>
                    <td class="whitespace-nowrap text-sm">
                      {KIND[item.document_kind] ?? item.document_kind}
                      {item.update && <span class="state state-edited ml-2">Update</span>}
                    </td>
                    <td class={`whitespace-nowrap text-sm ${d.tone}`}>{d.text}</td>
                    <td class="whitespace-nowrap text-sm">
                      {item.errors > 0 && <span class="state state-rejected mr-1">{item.errors} to check</span>}
                      {item.warnings > 0 && <span class="state state-edited">{item.warnings} for info</span>}
                      {item.errors === 0 && item.warnings === 0 && <span class="text-ink-3">Clean</span>}
                    </td>
                    <td class="num whitespace-nowrap text-sm text-ink-3">{formatDateTime(toIst(item.received_at))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

/** D1 timestamps are UTC ("…Z"); show them in IST. */
export function toIst(utc: string): string {
  const ms = Date.parse(utc.endsWith("Z") ? utc : `${utc}Z`);
  return new Date(ms + 330 * 60_000).toISOString().slice(0, 16) + "+05:30";
}
