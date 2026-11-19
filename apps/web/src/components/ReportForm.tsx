/**
 * "Report an error" form. Sends no personal data: just which notice, which part, and what looks wrong.
 * Posts to the Worker API when PUBLIC_API_BASE is configured.
 */
import { useEffect, useState } from "preact/hooks";

interface Props {
  notices: { slug: string; title: string }[];
}

const FIELDS = [
  ["dates", "Dates"],
  ["eligibility", "Age, qualification or other eligibility rule"],
  ["vacancies", "Posts or vacancies"],
  ["fees", "Fees"],
  ["links", "Links or documents"],
  ["other", "Something else"],
] as const;

type State = "idle" | "sending" | "sent" | "error" | "offline";

export default function ReportForm({ notices }: Props) {
  const api = import.meta.env.PUBLIC_API_BASE as string | undefined;
  const [slug, setSlug] = useState("");
  const [field, setField] = useState("dates");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<State>(api ? "idle" : "offline");

  useEffect(() => {
    const report = new URLSearchParams(location.search).get("report");
    if (report && notices.some((n) => n.slug === report)) setSlug(report);
  }, []);

  async function submit(e: Event) {
    e.preventDefault();
    if (!api || !slug || message.trim().length < 10) return;
    setState("sending");
    try {
      const res = await fetch(`${api.replace(/\/$/, "")}/api/corrections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunity_slug: slug, field_key: field, message: message.trim() }),
      });
      setState(res.ok ? "sent" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <div class="notice" role="status">
        <p class="font-medium text-ink">Thank you. Your report is in the review queue.</p>
        <p class="mt-1">A reviewer will compare it with the official notice. If the listing was wrong, the page will show a correction note.</p>
      </div>
    );
  }

  return (
    <form class="card grid gap-3" onSubmit={submit}>
      <div>
        <label for="rp-notice" class="mb-1 block text-sm text-ink-2">Which notice?</label>
        <select id="rp-notice" class="field" required value={slug} onChange={(e) => setSlug((e.target as HTMLSelectElement).value)}>
          <option value="">Choose a notice</option>
          {notices.map((n) => (
            <option value={n.slug}>{n.title}</option>
          ))}
        </select>
      </div>
      <div>
        <label for="rp-field" class="mb-1 block text-sm text-ink-2">What part is wrong?</label>
        <select id="rp-field" class="field" value={field} onChange={(e) => setField((e.target as HTMLSelectElement).value)}>
          {FIELDS.map(([v, l]) => (
            <option value={v}>{l}</option>
          ))}
        </select>
      </div>
      <div>
        <label for="rp-msg" class="mb-1 block text-sm text-ink-2">What does the official notice say instead?</label>
        <textarea
          id="rp-msg"
          class="field min-h-28"
          required
          minLength={10}
          maxLength={1000}
          value={message}
          onInput={(e) => setMessage((e.target as HTMLTextAreaElement).value)}
          placeholder="For example: page 2 says the last date is 18 December, not 15 December."
        />
        <p class="mt-1 text-xs text-ink-3">Please don’t include your name, phone number or other personal details.</p>
      </div>
      {state === "offline" ? (
        <p class="notice notice-warn">Reporting opens when the site goes live. This preview is not connected to the review queue yet.</p>
      ) : (
        <button class="btn btn-primary justify-center" type="submit" disabled={state === "sending"}>
          {state === "sending" ? "Sending…" : "Send report"}
        </button>
      )}
      {state === "error" && (
        <p class="text-sm text-bad" role="alert">
          The report could not be sent. Check your connection and try again.
        </p>
      )}
    </form>
  );
}
