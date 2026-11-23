/**
 * What a visitor keeps on their own device: their profile, saved and applied recruitments.
 * Nothing here is ever sent anywhere. If storage is blocked, everything still works for the visit.
 */
import type { Category, QualificationLevel } from "@myavedan/schema/types";

export interface Education {
  class12_stream?: string | null;
  diploma?: string | null;
  iti_trade?: string | null;
  bachelor?: string | null;
  bachelor_subject?: string | null;
  master?: string | null;
  master_subject?: string | null;
  phd_subject?: string | null;
}

export interface Profile {
  dob: string;
  education?: Education;
  qualification: QualificationLevel | null;
  category: Category | null;
  pwbd: boolean;
  exServiceman: boolean;
  resultAwaited: boolean;
  state: string;
}

/** Slug -> when it was marked applied and which updates the visitor has already seen. */
export type Applied = Record<string, { at: string; seen: string[] }>;

const PROFILE = "myavedan:profile";
const APPLIED = "myavedan:applied";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* not kept */
  }
}

export const getProfile = (): Profile | null => {
  const p = read<Partial<Profile> | null>(PROFILE, null);
  return p && p.dob && p.qualification ? ({ category: null, pwbd: false, exServiceman: false, resultAwaited: false, state: "", ...p } as Profile) : null;
};
export const setProfile = (p: Profile | null) => {
  write(PROFILE, p);
  push({ profile: p });
  document.dispatchEvent(new CustomEvent("myavedan:profile-changed"));
};
export const getApplied = (): Applied => read<Applied>(APPLIED, {});
export const setApplied = (a: Applied) => {
  write(APPLIED, a);
  push({ applied: a });
  document.dispatchEvent(new CustomEvent("myavedan:applied-changed"));
};

// ------------------------------------------------------------------ account (signed-in visitors)
//
// Signed-in visitors keep their profile, applied and saved recruitments in their account, so they
// follow them to any device. Everything also stays cached on the device; without sign-in, the device
// copy is all there is.

const API = ((import.meta.env.PUBLIC_API_BASE as string | undefined) ?? "").replace(/\/$/, "");
export const accountsEnabled = Boolean(API);

export interface Account {
  user: { name: string; email: string; image: string | null } | null;
}
let account: Promise<Account> | null = null;
let signedIn = false;

async function api(path: string, init: RequestInit = {}) {
  return fetch(`${API}${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...init });
}

function push(patch: Record<string, unknown>) {
  if (!signedIn) return;
  api("/api/me", { method: "PUT", body: JSON.stringify(patch) }).catch(() => {
    /* kept on the device; synced next time */
  });
}

/** Who is signed in, and sync their account with this device (once per page). */
export function getAccount(): Promise<Account> {
  account ??= (async () => {
    if (!API) return { user: null };
    try {
      const res = await api("/api/me");
      const me = await res.json();
      if (!me.user) return { user: null };
      signedIn = true;
      // Merge: the account's profile wins; applied and saved are combined.
      const localProfile = read<Profile | null>(PROFILE, null);
      if (me.profile) write(PROFILE, me.profile);
      else if (localProfile?.dob) push({ profile: localProfile });
      const applied: Applied = { ...getApplied(), ...(me.applied ?? {}) };
      write(APPLIED, applied);
      const saved = [...new Set([...(me.saved ?? []), ...read<string[]>("myavedan:saved", [])])];
      write("myavedan:saved", saved);
      push({ applied, saved });
      document.dispatchEvent(new CustomEvent("myavedan:profile-changed"));
      document.dispatchEvent(new CustomEvent("myavedan:applied-changed"));
      return { user: me.user };
    } catch {
      return { user: null };
    }
  })();
  return account;
}

export async function signIn() {
  const res = await api("/api/auth/sign-in/social", {
    method: "POST",
    body: JSON.stringify({ provider: "google", callbackURL: location.href, errorCallbackURL: location.href }),
  });
  const data = await res.json().catch(() => ({}));
  if (data.url) location.href = data.url;
  else throw new Error(data.message ?? "Sign-in is not available right now.");
}

export async function signOut() {
  await api("/api/auth/sign-out", { method: "POST", body: "{}" }).catch(() => undefined);
  location.reload();
}

/** Keep the saved list in the account too (Saved buttons write the device list). */
export function syncSaved() {
  push({ saved: read<string[]>("myavedan:saved", []) });
}

// ------------------------------------------------------------------ education → what the engine needs

export const STREAMS: [string, string][] = [
  ["science_maths", "Science (Maths: PCM)"],
  ["science_bio", "Science (Biology: PCB)"],
  ["science_pcmb", "Science (Maths + Biology: PCMB)"],
  ["commerce", "Commerce"],
  ["arts", "Arts / Humanities"],
  ["vocational", "Vocational / other"],
];
export const BACHELORS = ["BA", "BSc", "BCom", "B.Tech / BE", "BBA", "BCA", "B.Ed", "LLB", "MBBS", "BDS", "B.Pharm", "B.Sc Nursing", "BAMS / BHMS / BUMS", "BFA", "B.Arch", "Other bachelor's"];
export const MASTERS = ["MA", "MSc", "MCom", "M.Tech / ME", "MBA", "MCA", "M.Ed", "LLM", "MD / MS", "M.Pharm", "M.Sc Nursing", "Other master's"];

const STREAM_WORDS: Record<string, string> = {
  science_maths: "Science Physics Chemistry Mathematics",
  science_bio: "Science Physics Chemistry Biology",
  science_pcmb: "Science Physics Chemistry Mathematics Biology",
  commerce: "Commerce Accountancy",
  arts: "Arts Humanities",
  vocational: "Vocational",
};

/** Highest level reached, from the education details (doctorate > postgraduate > ... > 10th). */
export function highestLevel(e: Education | undefined, has12th: boolean): Profile["qualification"] {
  if (!e) return has12th ? "12th" : "10th";
  if (e.phd_subject?.trim()) return "doctorate";
  if (e.master) return "postgraduate";
  if (e.bachelor) return "graduate";
  if (e.diploma?.trim()) return "diploma";
  if (e.class12_stream) return "12th";
  if (e.iti_trade?.trim()) return "iti";
  return "10th";
}

/** Everything studied, as words the eligibility engine can match against a notice's subjects. */
export function studied(p: Profile): string[] {
  const e = p.education ?? {};
  return [
    e.class12_stream ? STREAM_WORDS[e.class12_stream] ?? "" : "",
    e.diploma ? `Diploma ${e.diploma}` : "",
    e.iti_trade ? `ITI ${e.iti_trade}` : "",
    e.bachelor ?? "",
    e.bachelor_subject ?? "",
    e.bachelor && e.bachelor_subject ? `${e.bachelor} ${e.bachelor_subject}` : "",
    e.master ?? "",
    e.master_subject ?? "",
    e.master && e.master_subject ? `${e.master} ${e.master_subject}` : "",
    e.phd_subject ? `PhD ${e.phd_subject}` : "",
  ].filter(Boolean);
}

export interface DataItem {
  slug: string;
  title: string;
  organization: string;
  status: unknown;
  posts: { id: string; name: string; rules: any[] }[];
  updates: { id: string; kind: string; label: string; date: string; title: string; link: string }[];
}
let cache: Promise<DataItem[]> | null = null;
export function loadData(): Promise<DataItem[]> {
  cache ??= fetch("/data/opportunities.json")
    .then((r) => (r.ok ? r.json() : { items: [] }))
    .then((d) => d.items as DataItem[])
    .catch(() => []);
  return cache;
}

/** Updates the visitor hasn't seen yet, for recruitments they applied to, newest first. */
export async function newUpdates(): Promise<{ item: DataItem; update: DataItem["updates"][number] }[]> {
  const applied = getApplied();
  if (!Object.keys(applied).length) return [];
  const data = await loadData();
  const out: { item: DataItem; update: DataItem["updates"][number] }[] = [];
  for (const item of data) {
    const a = applied[item.slug];
    if (!a) continue;
    for (const u of item.updates) if (!a.seen.includes(u.id)) out.push({ item, update: u });
  }
  return out.sort((x, y) => y.update.date.localeCompare(x.update.date));
}
