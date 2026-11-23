/**
 * My profile: the details filled once (used to label every job card), the recruitments the visitor
 * applied to, and new official updates for them (admit card, answer key, result...).
 * Everything stays on this device.
 */
import { useEffect, useState } from "preact/hooks";
import type { Category, QualificationLevel } from "@myavedan/schema/types";
import { getApplied, getProfile, loadData, newUpdates, setApplied, setProfile, type DataItem, type Profile } from "../lib/device";

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "UR", label: "General (UR)" },
  { value: "EWS", label: "EWS" },
  { value: "OBC", label: "OBC (non-creamy layer)" },
  { value: "SC", label: "SC" },
  { value: "ST", label: "ST" },
];
const LEVELS: { value: QualificationLevel; label: string }[] = [
  { value: "10th", label: "10th pass" },
  { value: "12th", label: "12th pass" },
  { value: "iti", label: "ITI" },
  { value: "diploma", label: "Diploma" },
  { value: "graduate", label: "Bachelor's degree" },
  { value: "postgraduate", label: "Postgraduate degree" },
  { value: "doctorate", label: "Doctorate" },
];
const EMPTY: Profile = { dob: "", qualification: null, category: null, pwbd: false, exServiceman: false, resultAwaited: false, state: "" };

const fmt = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default function ProfilePage({ states }: { states: string[] }) {
  const [p, setP] = useState<Profile>(EMPTY);
  const [saved, setSaved] = useState(false);
  const [applied, setAppliedState] = useState<ReturnType<typeof getApplied>>({});
  const [data, setData] = useState<DataItem[]>([]);
  const [fresh, setFresh] = useState<Awaited<ReturnType<typeof newUpdates>>>([]);

  const refresh = () => {
    setAppliedState(getApplied());
    newUpdates().then(setFresh);
  };
  useEffect(() => {
    const existing = getProfile();
    if (existing) {
      setP(existing);
      setSaved(true);
    }
    loadData().then(setData);
    refresh();
  }, []);

  const set = (patch: Partial<Profile>) => {
    setP((prev) => ({ ...prev, ...patch }));
    setSaved(false);
  };
  const save = (e: Event) => {
    e.preventDefault();
    setProfile(p);
    setSaved(true);
  };
  const markSeen = () => {
    const a = getApplied();
    for (const { item, update } of fresh) a[item.slug]?.seen.push(update.id);
    setApplied(a);
    refresh();
  };
  const unapply = (slug: string) => {
    const a = getApplied();
    delete a[slug];
    setApplied(a);
    refresh();
  };

  const appliedItems = data.filter((d) => applied[d.slug]);

  return (
    <div class="grid gap-8 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <form class="card grid content-start gap-4" onSubmit={save} aria-label="Your details">
        <div>
          <h2 class="font-display text-lg font-bold">Your details</h2>
          <p class="text-sm text-ink-3">Fill this once. Every job card then shows whether you can apply. Kept on this device only.</p>
        </div>
        <div>
          <label for="pf-dob" class="mb-1 block text-sm font-medium">Date of birth</label>
          <input id="pf-dob" type="date" required class="field" min="1950-01-01" max="2015-12-31" value={p.dob} onInput={(e) => set({ dob: (e.target as HTMLInputElement).value })} />
        </div>
        <div>
          <label for="pf-qual" class="mb-1 block text-sm font-medium">Highest qualification</label>
          <select id="pf-qual" required class="field" value={p.qualification ?? ""} onChange={(e) => set({ qualification: ((e.target as HTMLSelectElement).value || null) as QualificationLevel | null })}>
            <option value="">Choose</option>
            {LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
          <label class="mt-2 flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={p.resultAwaited} onChange={(e) => set({ resultAwaited: (e.target as HTMLInputElement).checked })} /> Final-year result awaited
          </label>
        </div>
        <div>
          <label for="pf-cat" class="mb-1 block text-sm font-medium">Category</label>
          <select id="pf-cat" class="field" value={p.category ?? ""} onChange={(e) => set({ category: ((e.target as HTMLSelectElement).value || null) as Category | null })}>
            <option value="">Prefer not to say</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
            <label class="flex items-center gap-2">
              <input type="checkbox" checked={p.pwbd} onChange={(e) => set({ pwbd: (e.target as HTMLInputElement).checked })} /> PwBD
            </label>
            <label class="flex items-center gap-2">
              <input type="checkbox" checked={p.exServiceman} onChange={(e) => set({ exServiceman: (e.target as HTMLInputElement).checked })} /> Ex-serviceman
            </label>
          </div>
        </div>
        <div>
          <label for="pf-state" class="mb-1 block text-sm font-medium">State you live in</label>
          <select id="pf-state" class="field" value={p.state} onChange={(e) => set({ state: (e.target as HTMLSelectElement).value })}>
            <option value="">Not set</option>
            {states.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div class="flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <button type="submit" class="btn btn-primary">
            Save my details
          </button>
          {saved && <span class="text-sm text-ok">✓ Saved. Job cards now show if you can apply.</span>}
        </div>
        {saved && (
          <button
            type="button"
            class="justify-self-start text-xs text-ink-3 underline"
            onClick={() => {
              setProfile(null);
              setP(EMPTY);
              setSaved(false);
            }}
          >
            Remove my details from this device
          </button>
        )}
      </form>

      <div class="grid content-start gap-8">
        <section aria-labelledby="new-h">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 id="new-h" class="font-display text-lg font-bold">
              New updates {fresh.length > 0 && <span class="tag tag-saffron ml-1">{fresh.length}</span>}
            </h2>
            {fresh.length > 0 && (
              <button type="button" class="btn btn-sm" onClick={markSeen}>
                Mark all as seen
              </button>
            )}
          </div>
          {fresh.length === 0 ? (
            <p class="notice mt-3">
              {appliedItems.length
                ? "No new admit cards, answer keys or results for the recruitments you applied to."
                : "Tick “I've applied” on a recruitment's page and its admit card, answer key and result will show up here."}
            </p>
          ) : (
            <ul class="mt-3 grid gap-3">
              {fresh.map(({ item, update }) => (
                <li key={item.slug + update.id} class="card border-l-4 border-l-accent">
                  <p class="text-xs font-semibold text-ink-3">
                    {fmt(update.date)} · <span class="tag tag-teal">{update.label}</span>
                  </p>
                  <p class="mt-1 font-medium">{update.title}</p>
                  <p class="text-sm text-ink-2">
                    <a href={`/opportunity/${item.slug}/#timeline`}>{item.title}</a> · {item.organization}
                  </p>
                  <a class="btn btn-sm mt-2" href={update.link} target="_blank" rel="noopener">
                    Open on the official site ↗
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="applied-h">
          <h2 id="applied-h" class="font-display text-lg font-bold">Recruitments I applied to</h2>
          {appliedItems.length === 0 ? (
            <p class="notice mt-3">None yet.</p>
          ) : (
            <ul class="card mt-3 divide-y divide-line py-0">
              {appliedItems.map((d) => (
                <li key={d.slug} class="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div class="min-w-0">
                    <a class="font-medium" href={`/opportunity/${d.slug}/#timeline`}>
                      {d.title}
                    </a>
                    <p class="text-xs text-ink-3">
                      {d.organization} · applied {fmt(applied[d.slug]!.at)} · {d.updates.length} official update{d.updates.length === 1 ? "" : "s"} so far
                    </p>
                  </div>
                  <button type="button" class="text-xs text-ink-3 underline" onClick={() => unapply(d.slug)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
