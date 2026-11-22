/**
 * Eligibility checker island. Everything runs in the browser: inputs are never sent
 * or stored, which is why date of birth and category can be asked for at all.
 */
import { useMemo, useState } from "preact/hooks";
import type { Category, Post, QualificationLevel } from "@myavedan/schema/types";
import {
  VERDICT_HELP,
  VERDICT_LABEL,
  describeInputs,
  evaluatePosts,
  type Applicant,
  type ConditionResult,
  type Verdict,
} from "@myavedan/eligibility";

interface Props {
  posts: Pick<Post, "id" | "name" | "rules">[];
  pdf: string;
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

const VERDICT_STYLE: Record<Verdict, { box: string; icon: string; mark: string }> = {
  likely_eligible: { box: "bg-ok-soft text-ok", icon: "bg-ok", mark: "✓" },
  potentially_eligible: { box: "bg-warn-soft text-warn", icon: "bg-warn", mark: "!" },
  not_eligible: { box: "bg-bad-soft text-bad", icon: "bg-bad", mark: "✕" },
  cannot_determine: { box: "bg-sunk text-ink-2", icon: "bg-ink-2", mark: "?" },
};

function stateChip(c: ConditionResult): { label: string; cls: string } {
  if (c.state === "met") return { label: "✓ Met", cls: "bg-ok-soft text-ok" };
  if (c.state === "not_met") return { label: "✕ Not met", cls: "bg-bad-soft text-bad" };
  if (c.state === "info") return { label: "i For your information", cls: "bg-sunk text-ink-2" };
  if (c.reason === "check") return { label: "! Confirm yourself", cls: "bg-warn-soft text-warn" };
  if (c.reason === "rule") return { label: "? Notice unclear", cls: "bg-warn-soft text-warn" };
  return { label: "? Needs your input", cls: "bg-sunk text-ink-2" };
}

export default function EligibilityChecker({ posts, pdf }: Props) {
  const [a, setA] = useState<Applicant>({ dob: "", category: null, pwbd: false, exServiceman: false, qualification: null, resultAwaited: false });
  const set = (patch: Partial<Applicant>) => setA((prev) => ({ ...prev, ...patch }));
  const started = Boolean(a.dob || a.category || a.qualification);
  const results = useMemo(() => evaluatePosts(posts, { ...a, dob: a.dob || null }), [posts, a]);

  return (
    <div class="overflow-hidden rounded-2xl border border-line-2 bg-surface">
      <div class="border-b border-line bg-sunk px-4 py-3 text-sm text-ink-2">
        <strong class="text-ink">Check your eligibility.</strong> Your answers stay on this device. Nothing is sent or saved.
      </div>
      <div class="grid md:grid-cols-[18rem_minmax(0,1fr)]">
        <form class="grid content-start gap-3 border-b border-line p-4 md:border-r md:border-b-0" onSubmit={(e) => e.preventDefault()}>
          <div>
            <label for="el-dob" class="mb-1 block text-sm text-ink-2">Date of birth</label>
            <input
              id="el-dob"
              type="date"
              class="field"
              min="1950-01-01"
              max="2015-12-31"
              value={a.dob ?? ""}
              onInput={(e) => set({ dob: (e.target as HTMLInputElement).value })}
            />
          </div>
          <div>
            <label for="el-cat" class="mb-1 block text-sm text-ink-2">Category</label>
            <select
              id="el-cat"
              class="field"
              value={a.category ?? ""}
              onChange={(e) => set({ category: ((e.target as HTMLSelectElement).value || null) as Category | null })}
            >
              <option value="">Choose</option>
              {CATEGORIES.map((c) => (
                <option value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={a.pwbd} onChange={(e) => set({ pwbd: (e.target as HTMLInputElement).checked })} />
            Person with benchmark disability (PwBD)
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={a.exServiceman} onChange={(e) => set({ exServiceman: (e.target as HTMLInputElement).checked })} />
            Ex-serviceman
          </label>
          <div>
            <label for="el-qual" class="mb-1 block text-sm text-ink-2">Highest qualification</label>
            <select
              id="el-qual"
              class="field"
              value={a.qualification ?? ""}
              onChange={(e) => set({ qualification: ((e.target as HTMLSelectElement).value || null) as QualificationLevel | null })}
            >
              <option value="">Choose</option>
              {LEVELS.map((l) => (
                <option value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={a.resultAwaited} onChange={(e) => set({ resultAwaited: (e.target as HTMLInputElement).checked })} />
            Final year, result awaited
          </label>
          {started && (
            <button
              type="button"
              class="btn justify-center"
              onClick={() => setA({ dob: "", category: null, pwbd: false, exServiceman: false, qualification: null, resultAwaited: false })}
            >
              Clear my answers
            </button>
          )}
        </form>

        <div class="min-w-0 p-4" aria-live="polite">
          {!started ? (
            <p class="text-sm text-ink-2">
              Enter your date of birth, category and qualification. You will see a result for each post, with the rule from the notice behind every answer.
            </p>
          ) : (
            <div class="grid gap-5">
              {results.map((r) => {
                const style = VERDICT_STYLE[r.verdict];
                return (
                  <section key={r.postId} aria-label={`Result for ${r.postName}`}>
                    {posts.length > 1 && <h4 class="mb-2 text-base">{r.postName}</h4>}
                    <div class={`grid grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-3 rounded-xl px-3 py-2.5 ${style.box}`}>
                      <span class={`grid h-9 w-9 place-items-center rounded-full text-lg font-bold text-surface ${style.icon}`} aria-hidden="true">
                        {style.mark}
                      </span>
                      <div>
                        <p class="font-display text-lg font-bold leading-tight" style="font-stretch: 90%">
                          {VERDICT_LABEL[r.verdict]}
                        </p>
                        <p class="text-sm text-ink">{VERDICT_HELP[r.verdict]}</p>
                      </div>
                    </div>
                    <ul class="mt-2 divide-y divide-line">
                      {r.conditions.map((c) => {
                        const chip = stateChip(c);
                        return (
                          <li key={c.key} class="grid gap-x-3 gap-y-1 py-2.5 text-sm sm:grid-cols-[9.5rem_minmax(0,1fr)]">
                            <span class={`self-start justify-self-start rounded px-1.5 py-0.5 text-xs font-medium ${chip.cls}`}>{chip.label}</span>
                            <div>
                              <span class="font-semibold">{c.label}. </span>
                              {c.message}{" "}
                              {c.evidence.map((ev) => (
                                <a
                                  class="ev mr-1"
                                  href={`${pdf}#page=${ev.page}`}
                                  target="_blank"
                                  rel="noopener"
                                  title={`Notice says: “${ev.snippet}”`}
                                >
                                  Page {ev.page}
                                </a>
                              ))}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
              <p class="text-xs text-ink-3">
                Based on: {describeInputs({ ...a, dob: a.dob || null })}. This is guidance from the published rules. The recruiting authority’s
                interpretation is final.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
