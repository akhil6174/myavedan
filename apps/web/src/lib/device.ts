/**
 * What a visitor keeps on their own device: their profile, saved and applied recruitments.
 * Nothing here is ever sent anywhere. If storage is blocked, everything still works for the visit.
 */
import type { Category, QualificationLevel } from "@myavedan/schema/types";

export interface Profile {
  dob: string;
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
  document.dispatchEvent(new CustomEvent("myavedan:profile-changed"));
};
export const getApplied = (): Applied => read<Applied>(APPLIED, {});
export const setApplied = (a: Applied) => {
  write(APPLIED, a);
  document.dispatchEvent(new CustomEvent("myavedan:applied-changed"));
};

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
