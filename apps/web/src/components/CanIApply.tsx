/**
 * "Can I apply?" island: one profile, checked against every open or upcoming recruitment.
 * Runs entirely in the browser with the same eligibility engine as each notice page.
 * Nothing is sent anywhere; the profile is kept on this device only if the visitor asks.
 */
import { useEffect, useMemo, useState } from "preact/hooks";
import type { Category, Post, QualificationLevel } from "@myavedan/schema/types";
import { evaluatePosts, type Applicant, type PostResult } from "@myavedan/eligibility";

export interface Listing {
  slug: string;
  title: string;
  organization: string;
  place: string;
  states: string[];
  central: boolean;
  lastDate: string | null;
  lastDateLabel: string;
  posts: Pick<Post, "id" | "name" | "rules">[];
}

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

const KEY = "myavedan:profile";
type Profile = Applicant & { state: string };
const EMPTY: Profile = { dob: "", category: null, pwbd: false, exServiceman: false, qualification: null, resultAwaited: false, state: "" };

function load(): Profile | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : null;
  } catch {
    return null;
  }
}

export default function CanIApply({ listings, states }: { listings: Listing[]; states: string[] }) {
  const [p, setP] = useState<Profile>(EMPTY);
  const [remember, setRemember] = useState(false);
  useEffect(() => {
    const saved = load();
    if (saved) {
      setP(saved);
      setRemember(true);
    }
  }, []);
  useEffect(() => {
    try {
      if (remember) localStorage.setItem(KEY, JSON.stringify(p));
      else localStorage.removeItem(KEY);
    } catch {
      /* storage blocked: nothing is kept */
    }
  }, [p, remember]);
  const set = (patch: Partial<Profile>) => setP((prev) => ({ ...prev, ...patch }));
  const ready = Boolean(p.dob && p.qualification);

  const results = useMemo(() => {
    if (!ready) return { yes: [], check: [] as { l: Listing; posts: PostResult[] }[] };
    const applicant: Applicant = { ...p, dob: p.dob || null };
    const yes: { l: Listing; posts: PostResult[] }[] = [];
    const check: { l: Listing; posts: PostResult[] }[] = [];
    for (const l of listings) {
      if (p.state && !l.central && !l.states.includes(p.state)) continue;
      const r = evaluatePosts(l.posts, applicant);
      const fit = r.filter((x) => x.verdict === "likely_eligible" || x.verdict === "potentially_eligible");
      if (fit.length) yes.push({ l, posts: fit });
      else {
        const unsure = r.filter((x) => x.verdict === "cannot_determine");
        if (unsure.length) check.push({ l, posts: unsure });
      }
    }
    return { yes, check };
  }, [p, ready, listings]);

  return (
    <div class="grid gap-8 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <form class="card grid content-start gap-4 lg:sticky lg:top-24" onSubmit={(e) => e.preventDefault()} aria-label="Your profile">
        <p class="text-sm text-ink-2">Your answers stay on this device. Nothing is sent.</p>
        <div>
          <label for="ca-dob" class="mb-1 block text-sm font-medium">Date of birth</label>
          <input id="ca-dob" type="date" class="field" min="1950-01-01" max="2015-12-31" value={p.dob ?? ""} onInput={(e) => set({ dob: (e.target as HTMLInputElement).value })} />
        </div>
        <div>
          <label for="ca-qual" class="mb-1 block text-sm font-medium">Highest qualification</label>
          <select id="ca-qual" class="field" value={p.qualification ?? ""} onChange={(e) => set({ qualification: ((e.target as HTMLSelectElement).value || null) as QualificationLevel | null })}>
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
          <label for="ca-cat" class="mb-1 block text-sm font-medium">Category</label>
          <select id="ca-cat" class="field" value={p.category ?? ""} onChange={(e) => set({ category: ((e.target as HTMLSelectElement).value || null) as Category | null })}>
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
          <label for="ca-state" class="mb-1 block text-sm font-medium">Where you want to work</label>
          <select id="ca-state" class="field" value={p.state} onChange={(e) => set({ state: (e.target as HTMLSelectElement).value })}>
            <option value="">Anywhere (central + all states)</option>
            {states.map((s) => (
              <option key={s} value={s}>
                Central + {s}
              </option>
            ))}
          </select>
        </div>
        <label class="flex items-center gap-2 border-t border-line pt-3 text-sm text-ink-2">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember((e.target as HTMLInputElement).checked)} /> Remember on this device
        </label>
      </form>

      <section aria-live="polite">
        {!ready ? (
          <p class="notice">Enter your date of birth and highest qualification to see every open recruitment you can apply for.</p>
        ) : (
          <>
            <h2 class="font-display text-xl font-bold">
              {results.yes.length ? `You can apply to ${results.yes.length} recruitment${results.yes.length === 1 ? "" : "s"}` : "No open recruitment matches yet"}
            </h2>
            <p class="mt-1 text-sm text-ink-3">Based on age and qualification. Always confirm in the official notice before applying.</p>
            <ul class="mt-4 grid gap-4">
              {results.yes.map(({ l, posts }) => (
                <li key={l.slug} class="card card-listing relative">
                  <div class="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <a href={`/opportunity/${l.slug}/#eligibility`} class="stretched card-title font-display text-lg font-bold text-ink no-underline">
                        {l.title}
                      </a>
                      <p class="text-sm text-ink-2">
                        {l.organization} · {l.place}
                      </p>
                    </div>
                    <span class="tag tag-saffron">Last date: {l.lastDateLabel}</span>
                  </div>
                  <ul class="mt-3 flex flex-wrap gap-2">
                    {posts.slice(0, 6).map((r) => (
                      <li key={r.postId} class={`tag ${r.verdict === "likely_eligible" ? "tag-teal" : ""}`}>
                        {r.verdict === "likely_eligible" ? "✓ " : "! "}
                        {r.postName}
                      </li>
                    ))}
                    {posts.length > 6 && <li class="tag">+{posts.length - 6} more posts</li>}
                  </ul>
                  {posts.some((r) => r.verdict === "potentially_eligible") && (
                    <p class="mt-2 text-xs text-ink-3">"!" means you meet the limits but must confirm a condition yourself (domicile, subject, result date…).</p>
                  )}
                </li>
              ))}
            </ul>
            {results.check.length > 0 && (
              <details class="mt-6">
                <summary class="cursor-pointer text-sm font-semibold text-ink-2">
                  {results.check.length} more where the notice is unclear: check these yourself
                </summary>
                <ul class="mt-2 grid gap-2">
                  {results.check.map(({ l }) => (
                    <li key={l.slug}>
                      <a href={`/opportunity/${l.slug}/#eligibility`}>{l.title}</a> <span class="text-sm text-ink-3">· {l.organization}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </section>
    </div>
  );
}
